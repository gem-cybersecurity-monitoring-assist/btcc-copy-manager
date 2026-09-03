import { getPurchaseConfigurationStatus, switchereSignature, type PreparedFinitePurchase, type PurchaseChildInstruction } from "./finite-purchase.ts";

export interface SwitchereOrderResult {
  sequence: number;
  partnerOrderId: string;
  clientOrderId?: string;
  status: string;
  redirect?: string;
  payinAmount?: string;
  payoutAmount?: string;
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

function apiBase() {
  return (process.env.SWITCHERE_API_BASE_URL || "https://switchere.com").replace(/\/$/, "");
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
  return {
    sequence: child.sequence,
    partnerOrderId: child.partnerOrderId,
    clientOrderId: typeof data.client_order_id === "string" ? data.client_order_id : undefined,
    status: typeof data.status === "string" ? data.status : "created",
    redirect: typeof data.redirect === "string" ? data.redirect : undefined,
    payinAmount: data.payin_amount == null ? undefined : String(data.payin_amount),
    payoutAmount: data.payout_amount == null ? undefined : String(data.payout_amount),
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
