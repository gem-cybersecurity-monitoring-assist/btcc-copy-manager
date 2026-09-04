import { getPurchaseConfigurationStatus, switchereSignature, type PreparedFinitePurchase, type PurchaseChildInstruction } from "./finite-purchase.ts";

export type SwitchereLifecycle =
  | "not_created"
  | "awaiting_payment"
  | "awaiting_auth"
  | "awaiting_verification"
  | "processing"
  | "finished"
  | "terminal_failure"
  | "unknown";

export interface SwitchereOrderResult {
  sequence: number;
  partnerOrderId: string;
  clientOrderId?: string;
  status: string;
  subStatus?: string;
  lifecycle: SwitchereLifecycle;
  redirect?: string;
  payinAmount?: string;
  payoutAmount?: string;
  payoutTxid?: string;
  reused: boolean;
}

export interface FinitePurchaseExecutionResult {
  planId: string;
  status: "created" | "partial";
  totalAuthorized: number;
  quoteCurrency: string;
  executionCount: number;
  orders: SwitchereOrderResult[];
  provider: "switchere";
  destination: "BTCC_BTC_DEPOSIT";
  noRecurrence: true;
}

export interface FinitePurchaseReconciliationResult {
  planId: string;
  batchStatus: "awaiting_action" | "processing" | "finished" | "partial_failure";
  executionCount: number;
  orders: SwitchereOrderResult[];
  provider: "switchere";
  destination: "BTCC_BTC_DEPOSIT";
}

function apiBase() {
  return (process.env.SWITCHERE_API_BASE_URL || "https://switchere.com").replace(/\/$/, "");
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readSubStatus(data: Record<string, unknown>) {
  return asString(data.sub_status) || asString(data.substatus) || asString(data.order_sub_status) || asString(data.orderSubStatus);
}

export function classifySwitchereLifecycle(statusInput: string | undefined, subStatusInput?: string): SwitchereLifecycle {
  const status = (statusInput || "").trim().toLowerCase();
  const subStatus = (subStatusInput || "").trim().toLowerCase();

  if (!status) return "unknown";
  if (status === "finished") return "finished";
  if (["canceled", "error", "expired", "refunded"].includes(status)) return "terminal_failure";
  if (status === "confirmation_pending") return "awaiting_auth";
  if (["auth_success", "processing", "processing_payout"].includes(status)) return "processing";

  if (["email_pending", "verify_pending", "understanding_pending", "proof_pending", "address_pending", "video_pending", "identity_pending", "partner_approve_pending"].includes(subStatus)) {
    return "awaiting_verification";
  }

  if (["payin_pending", "pending"].includes(status) || ["card_pending", "card_manual_pending"].includes(subStatus)) {
    return "awaiting_payment";
  }

  return "unknown";
}

async function switchereRequest(path: string, options: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {}) {
  const apiKey = process.env.SWITCHERE_PARTNER_API_KEY || "";
  const secret = process.env.SWITCHERE_PARTNER_API_SECRET || "";
  const method = options.method || "GET";
  const content = options.body ? JSON.stringify(options.body) : "";
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      "API-Key": apiKey,
      "API-Signature": switchereSignature(path, content, secret),
      ...(content ? { "content-type": "application/json" } : {})
    },
    body: content || undefined,
    cache: "no-store"
  });
  const text = await response.text();
  let data: unknown = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { response, data };
}

async function existingOrder(child: PurchaseChildInstruction) {
  const path = `/api/v2/partner/order/${encodeURIComponent(child.partnerOrderId)}`;
  const { response, data } = await switchereRequest(path);
  if (response.status === 404) return null;
  if (!response.ok) {
    const serialized = JSON.stringify(data).toLowerCase();
    if (serialized.includes("not found") || serialized.includes("does not exist")) return null;
    throw new Error(`Switchere order lookup failed (${response.status}).`);
  }
  return data as Record<string, unknown>;
}

function normalizeOrder(child: PurchaseChildInstruction, data: Record<string, unknown>, reused: boolean): SwitchereOrderResult {
  const status = asString(data.status) || "created";
  const subStatus = readSubStatus(data);
  return {
    sequence: child.sequence,
    partnerOrderId: child.partnerOrderId,
    clientOrderId: asString(data.client_order_id),
    status,
    subStatus,
    lifecycle: classifySwitchereLifecycle(status, subStatus),
    redirect: asString(data.redirect),
    payinAmount: data.payin_amount == null ? undefined : String(data.payin_amount),
    payoutAmount: data.payout_amount == null ? undefined : String(data.payout_amount),
    payoutTxid: asString(data.payout_txid),
    reused
  };
}

async function ensureSwitchereOrder(plan: PreparedFinitePurchase, child: PurchaseChildInstruction) {
  const existing = await existingOrder(child);
  if (existing) return normalizeOrder(child, existing, true);

  const address = process.env.BTCC_BTC_DEPOSIT_ADDRESS || "";
  if (!address) throw new Error("BTCC_BTC_DEPOSIT_ADDRESS is not configured.");
  const body: Record<string, unknown> = {
    partner_order_id: child.partnerOrderId,
    payin_currency: child.quoteCurrency,
    payin_amount: child.amount,
    payin_group: plan.payinGroup,
    payout_currency: "BTC",
    payout_group: "crypto",
    dst_address: address,
    client_ip: plan.clientIp,
    remote_country: plan.remoteCountry
  };
  if (plan.clientEmail) body.client_email = plan.clientEmail;

  const path = "/api/v2/partner/order/create";
  const { response, data } = await switchereRequest(path, { method: "POST", body });
  if (!response.ok) {
    throw new Error(`Switchere order ${child.sequence} creation failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return normalizeOrder(child, data as Record<string, unknown>, false);
}

function batchStatus(orders: SwitchereOrderResult[]): FinitePurchaseReconciliationResult["batchStatus"] {
  if (orders.some((order) => order.lifecycle === "terminal_failure")) return "partial_failure";
  if (orders.length > 0 && orders.every((order) => order.lifecycle === "finished")) return "finished";
  if (orders.some((order) => ["awaiting_auth", "awaiting_payment", "awaiting_verification", "not_created"].includes(order.lifecycle))) return "awaiting_action";
  return "processing";
}

export async function reconcileFinitePurchasePlan(plan: PreparedFinitePurchase): Promise<FinitePurchaseReconciliationResult> {
  if (!process.env.SWITCHERE_PARTNER_API_KEY || !process.env.SWITCHERE_PARTNER_API_SECRET) {
    throw new Error("Switchere partner credentials are required for purchase reconciliation.");
  }

  const orders: SwitchereOrderResult[] = [];
  for (const child of plan.children) {
    const existing = await existingOrder(child);
    orders.push(existing
      ? normalizeOrder(child, existing, true)
      : {
          sequence: child.sequence,
          partnerOrderId: child.partnerOrderId,
          status: "not_created",
          lifecycle: "not_created",
          reused: false
        });
  }

  return {
    planId: plan.planId,
    batchStatus: batchStatus(orders),
    executionCount: plan.executionCount,
    orders,
    provider: "switchere",
    destination: "BTCC_BTC_DEPOSIT"
  };
}

export async function executeFinitePurchasePlan(plan: PreparedFinitePurchase): Promise<FinitePurchaseExecutionResult> {
  const status = getPurchaseConfigurationStatus();
  if (!status.ready) throw new Error(`Purchase connector is not ready: ${status.blockers.join(" ")}`);

  const orders: SwitchereOrderResult[] = [];
  for (const child of plan.children) {
    try {
      orders.push(await ensureSwitchereOrder(plan, child));
    } catch (error) {
      if (orders.length === 0) throw error;
      return {
        planId: plan.planId,
        status: "partial",
        totalAuthorized: plan.totalAuthorized,
        quoteCurrency: plan.quoteCurrency,
        executionCount: plan.executionCount,
        orders,
        provider: "switchere",
        destination: "BTCC_BTC_DEPOSIT",
        noRecurrence: true
      };
    }
  }

  return {
    planId: plan.planId,
    status: "created",
    totalAuthorized: plan.totalAuthorized,
    quoteCurrency: plan.quoteCurrency,
    executionCount: plan.executionCount,
    orders,
    provider: "switchere",
    destination: "BTCC_BTC_DEPOSIT",
    noRecurrence: true
  };
}
