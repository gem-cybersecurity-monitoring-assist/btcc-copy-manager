import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type PurchasePayinGroup = "card" | "balance";
export type PurchaseQuoteCurrency = "USD" | "EUR";

export interface FinitePurchaseIntent {
  amountPerExecution: number;
  executionCount: number;
  quoteCurrency: PurchaseQuoteCurrency;
  payinGroup: PurchasePayinGroup;
  clientEmail?: string;
  clientIp: string;
  remoteCountry: string;
  ownerAcknowledgedTotal: boolean;
}

export interface PurchaseChildInstruction {
  sequence: number;
  partnerOrderId: string;
  amount: number;
  quoteCurrency: PurchaseQuoteCurrency;
  asset: "BTC";
}

export interface PreparedFinitePurchase {
  planId: string;
  asset: "BTC";
  amountPerExecution: number;
  executionCount: number;
  totalAuthorized: number;
  quoteCurrency: PurchaseQuoteCurrency;
  payinGroup: PurchasePayinGroup;
  clientEmail?: string;
  clientIp: string;
  remoteCountry: string;
  destination: "BTCC_BTC_DEPOSIT";
  destinationFingerprint: string;
  children: PurchaseChildInstruction[];
  confirmationPhrase: string;
  confirmationToken: string;
  preparedAt: string;
  expiresAt: string;
}

export interface PurchaseConfigurationStatus {
  ready: boolean;
  liveExecutionEnabled: boolean;
  adapterMode: "switchere-to-btcc";
  missing: string[];
  blockers: string[];
  policy: {
    maxExecutions: number;
    maxTotalFiat: number | null;
    payoutAsset: "BTC";
    destination: "BTCC BTC deposit";
    destinationFingerprint: string | null;
    otpStorage: false;
    recurring: false;
  };
}

const DEFAULT_MAX_EXECUTIONS = 10;
const DEFAULT_TTL_SECONDS = 5 * 60;
const DEFAULT_RECONCILE_MAX_AGE_SECONDS = 24 * 60 * 60;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalPositiveNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function confirmationSecret() {
  return process.env.PURCHASE_CONFIRMATION_SECRET || process.env.LIVE_CONFIRMATION_SECRET || "";
}

function base64url(input: string | Buffer) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buffer.toString("base64url");
}

function signPayload(payload: string) {
  const secret = confirmationSecret();
  if (secret.length < 24) throw new Error("PURCHASE_CONFIRMATION_SECRET (or LIVE_CONFIRMATION_SECRET) must be at least 24 characters.");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function parseToken(token: string) {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) throw new Error("Invalid purchase confirmation token.");
  const expected = signPayload(encoded);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error("Purchase confirmation token signature is invalid.");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PreparedFinitePurchase;
}

function validatePlanIntegrity(plan: PreparedFinitePurchase) {
  const expectedTotal = roundMoney(plan.amountPerExecution * plan.executionCount);
  if (expectedTotal !== plan.totalAuthorized) throw new Error("Purchase plan total is inconsistent.");
  if (plan.children.length !== plan.executionCount) throw new Error("Purchase plan child count is inconsistent.");
  const uniqueIds = new Set(plan.children.map((child) => child.partnerOrderId));
  if (uniqueIds.size !== plan.children.length) throw new Error("Purchase plan contains duplicate child order IDs.");
  return plan;
}

export function destinationFingerprint(address = process.env.BTCC_BTC_DEPOSIT_ADDRESS || "") {
  if (!address) return "";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

export function getPurchaseConfigurationStatus(): PurchaseConfigurationStatus {
  const maxExecutions = positiveInteger(process.env.PURCHASE_MAX_EXECUTIONS, DEFAULT_MAX_EXECUTIONS);
  const maxTotalFiat = optionalPositiveNumber(process.env.PURCHASE_MAX_TOTAL_FIAT);
  const liveExecutionEnabled = process.env.PURCHASE_LIVE_EXECUTION === "true";
  const address = process.env.BTCC_BTC_DEPOSIT_ADDRESS || "";
  const required: Array<[string, string]> = [
    ["SWITCHERE_PARTNER_API_KEY", process.env.SWITCHERE_PARTNER_API_KEY || ""],
    ["SWITCHERE_PARTNER_API_SECRET", process.env.SWITCHERE_PARTNER_API_SECRET || ""],
    ["PURCHASE_CONTROL_SECRET", process.env.PURCHASE_CONTROL_SECRET || ""],
    ["PURCHASE_CONFIRMATION_SECRET or LIVE_CONFIRMATION_SECRET", confirmationSecret()],
    ["BTCC_BTC_DEPOSIT_ADDRESS", address],
    ["PURCHASE_MAX_TOTAL_FIAT", process.env.PURCHASE_MAX_TOTAL_FIAT || ""]
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  const blockers = [...missing.map((name) => `${name} is not configured.`)];
  if (!liveExecutionEnabled) blockers.push("PURCHASE_LIVE_EXECUTION is not enabled.");
  if (confirmationSecret() && confirmationSecret().length < 24) blockers.push("Purchase confirmation secret must be at least 24 characters.");
  if (process.env.PURCHASE_CONTROL_SECRET && process.env.PURCHASE_CONTROL_SECRET.length < 16) blockers.push("PURCHASE_CONTROL_SECRET must be at least 16 characters.");
  if (process.env.PURCHASE_MAX_TOTAL_FIAT && maxTotalFiat === null) blockers.push("PURCHASE_MAX_TOTAL_FIAT must be a positive number.");

  return {
    ready: blockers.length === 0,
    liveExecutionEnabled,
    adapterMode: "switchere-to-btcc",
    missing,
    blockers,
    policy: {
      maxExecutions,
      maxTotalFiat,
      payoutAsset: "BTC",
      destination: "BTCC BTC deposit",
      destinationFingerprint: address ? destinationFingerprint(address) : null,
      otpStorage: false,
      recurring: false
    }
  };
}

export function prepareFinitePurchase(intent: FinitePurchaseIntent): PreparedFinitePurchase {
  if (!Number.isFinite(intent.amountPerExecution) || intent.amountPerExecution <= 0) throw new Error("Purchase amount must be greater than zero.");
  if (!Number.isInteger(intent.executionCount) || intent.executionCount < 1) throw new Error("Execution count must be a positive whole number.");
  if (!intent.ownerAcknowledgedTotal) throw new Error("The owner must acknowledge the full finite purchase total before preparation.");
  if (!/^[A-Z]{2}$/.test(intent.remoteCountry)) throw new Error("Remote country must be a two-letter country code.");
  if (!intent.clientIp.trim()) throw new Error("Client IP is required for the purchase provider.");
  if (intent.clientEmail && !/^\S+@\S+\.\S+$/.test(intent.clientEmail)) throw new Error("Client email is invalid.");

  const status = getPurchaseConfigurationStatus();
  if (intent.executionCount > status.policy.maxExecutions) throw new Error(`Execution count exceeds the configured maximum of ${status.policy.maxExecutions}.`);

  const amountPerExecution = roundMoney(intent.amountPerExecution);
  const totalAuthorized = roundMoney(amountPerExecution * intent.executionCount);
  if (status.policy.maxTotalFiat !== null && totalAuthorized > status.policy.maxTotalFiat) {
    throw new Error(`Authorized total exceeds PURCHASE_MAX_TOTAL_FIAT (${status.policy.maxTotalFiat}).`);
  }

  const address = process.env.BTCC_BTC_DEPOSIT_ADDRESS || "";
  const planId = randomUUID();
  const preparedAt = new Date();
  const ttlSeconds = positiveInteger(process.env.PURCHASE_PLAN_TTL_SECONDS, DEFAULT_TTL_SECONDS);
  const expiresAt = new Date(preparedAt.getTime() + ttlSeconds * 1000);
  const children: PurchaseChildInstruction[] = Array.from({ length: intent.executionCount }, (_, index) => ({
    sequence: index + 1,
    partnerOrderId: `gem-${planId.replaceAll("-", "")}-${String(index + 1).padStart(2, "0")}`,
    amount: amountPerExecution,
    quoteCurrency: intent.quoteCurrency,
    asset: "BTC"
  }));
  const confirmationPhrase = `AUTHORIZE ${intent.executionCount} BTC PURCHASE${intent.executionCount === 1 ? "" : "S"} TOTAL ${totalAuthorized.toFixed(2)} ${intent.quoteCurrency}`;

  const unsigned: PreparedFinitePurchase = {
    planId,
    asset: "BTC",
    amountPerExecution,
    executionCount: intent.executionCount,
    totalAuthorized,
    quoteCurrency: intent.quoteCurrency,
    payinGroup: intent.payinGroup,
    clientEmail: intent.clientEmail,
    clientIp: intent.clientIp,
    remoteCountry: intent.remoteCountry,
    destination: "BTCC_BTC_DEPOSIT",
    destinationFingerprint: address ? destinationFingerprint(address) : "NOT_CONFIGURED",
    children,
    confirmationPhrase,
    confirmationToken: "",
    preparedAt: preparedAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
  const encoded = base64url(JSON.stringify(unsigned));
  return { ...unsigned, confirmationToken: `${encoded}.${signPayload(encoded)}` };
}

export function verifyFinitePurchaseToken(token: string) {
  const plan = validatePlanIntegrity(parseToken(token));
  if (Date.parse(plan.expiresAt) <= Date.now()) throw new Error("Purchase confirmation token has expired.");
  return plan;
}

export function verifyFinitePurchaseTokenForReconciliation(token: string) {
  const plan = validatePlanIntegrity(parseToken(token));
  const preparedAt = Date.parse(plan.preparedAt);
  if (!Number.isFinite(preparedAt)) throw new Error("Purchase plan preparation time is invalid.");
  const maxAgeSeconds = positiveInteger(process.env.PURCHASE_RECONCILE_MAX_AGE_SECONDS, DEFAULT_RECONCILE_MAX_AGE_SECONDS);
  if (preparedAt + maxAgeSeconds * 1000 <= Date.now()) throw new Error("Purchase plan reconciliation window has expired.");
  return plan;
}

export function verifyPurchaseControlSecret(candidate: string) {
  const expected = process.env.PURCHASE_CONTROL_SECRET || "";
  if (expected.length < 16 || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

export function switchereSignature(path: string, content: string, secret: string) {
  const digest = createHash("sha256").update(path + content, "utf8").digest();
  return createHmac("sha512", secret).update(digest).digest("base64");
}
