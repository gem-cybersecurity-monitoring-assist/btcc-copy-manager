import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { LiveConfigurationStatus, LiveOrderIntent, PreparedLiveOrder } from "./live-types";

type BtccResponse = { code: number; msg?: string; [key: string]: unknown };

function allowedSymbols() {
  return (process.env.ALLOWED_SYMBOLS || "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

function numericEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getLiveConfigurationStatus(): LiveConfigurationStatus {
  const required = ["BTCC_API_BASE_URL", "BTCC_API_KEY", "BTCC_SECRET_KEY", "BTCC_USERNAME", "BTCC_PASSWORD", "BTCC_ACCOUNT_ID", "LIVE_CONFIRMATION_SECRET"];
  const missing = required.filter((name) => !process.env[name]);
  const executionEnabled = process.env.BTCC_LIVE_EXECUTION === "true";
  const blockers = [...missing.map((name) => `${name} is not configured.`)];
  if (!executionEnabled) blockers.push("BTCC_LIVE_EXECUTION is not enabled.");
  return {
    ready: missing.length === 0 && executionEnabled,
    executionEnabled,
    adapterMode: missing.length === 0 ? "btcc-live" : "disabled",
    missing,
    blockers,
    policy: {
      maxLeverage: numericEnv("MAX_LEVERAGE", numericEnv("BTCC_MAX_LEVERAGE", 5)),
      maxOrderNotionalUsdt: numericEnv("MAX_ORDER_NOTIONAL_USDT", numericEnv("BTCC_MAX_ORDER_NOTIONAL_USDT", 10)),
      stopLossRequired: true,
      withdrawals: false
    }
  };
}

function encode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function signBtccParameters(parameters: Record<string, string | number>, secret: string) {
  const entries = [...Object.entries(parameters), ["secret_key", secret] as [string, string]]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const source = entries.map(([key, value]) => `${encode(key)}=${encode(String(value))}`).join("&");
  return createHash("md5").update(source, "utf8").digest("hex");
}

function confirmationSecret() {
  const secret = process.env.LIVE_CONFIRMATION_SECRET;
  if (!secret) throw new Error("LIVE_CONFIRMATION_SECRET is not configured.");
  return secret;
}

function tokenPayload(intent: LiveOrderIntent, expiresAt: string) {
  return Buffer.from(JSON.stringify({ intent, expiresAt })).toString("base64url");
}

export function prepareLiveOrder(intent: LiveOrderIntent): PreparedLiveOrder {
  const status = getLiveConfigurationStatus();
  const problems: string[] = [];
  if (!intent.idempotencyKey || intent.idempotencyKey.length < 8) problems.push("A valid idempotency key is required.");
  const symbol = intent.symbol.trim().toUpperCase();
  if (!symbol) problems.push("The exact BTCC API symbol is required.");
  const symbols = allowedSymbols();
  if (symbols.length > 0 && !symbols.includes(symbol)) problems.push("Symbol is not in the configured ALLOWED_SYMBOLS list.");
  if (intent.direction !== "LONG" && intent.direction !== "SHORT") problems.push("Direction must be LONG or SHORT.");
  for (const [name, value] of Object.entries({ volume: intent.volume, referencePrice: intent.referencePrice, leverage: intent.leverage, stopLoss: intent.stopLoss, takeProfit: intent.takeProfit })) {
    if (!Number.isFinite(value) || value <= 0) problems.push(`${name} must be greater than zero.`);
  }
  const notionalUsdt = intent.volume * intent.referencePrice;
  const estimatedMarginUsdt = intent.leverage > 0 ? notionalUsdt / intent.leverage : notionalUsdt;
  const estimatedStopLossUsdt = intent.direction === "LONG"
    ? Math.max(0, intent.referencePrice - intent.stopLoss) * intent.volume
    : Math.max(0, intent.stopLoss - intent.referencePrice) * intent.volume;
  const maxQuantity = numericEnv("MAX_ORDER_QUANTITY", Number.POSITIVE_INFINITY);
  if (intent.volume > maxQuantity) problems.push(`Order quantity exceeds the configured ${maxQuantity} maximum.`);
  if (intent.leverage > status.policy.maxLeverage) problems.push(`Leverage exceeds the configured ${status.policy.maxLeverage}× maximum.`);
  if (notionalUsdt > status.policy.maxOrderNotionalUsdt) problems.push(`Order notional exceeds the configured ${status.policy.maxOrderNotionalUsdt} USDT maximum.`);
  if (intent.direction === "LONG" && intent.stopLoss >= intent.referencePrice) problems.push("A long stop loss must be below the reference price.");
  if (intent.direction === "SHORT" && intent.stopLoss <= intent.referencePrice) problems.push("A short stop loss must be above the reference price.");
  if (intent.direction === "LONG" && intent.takeProfit <= intent.referencePrice) problems.push("A long take profit must be above the reference price.");
  if (intent.direction === "SHORT" && intent.takeProfit >= intent.referencePrice) problems.push("A short take profit must be below the reference price.");
  if (!status.ready) problems.push(...status.blockers);
  if (problems.length) throw new Error(problems.join(" "));
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  const payload = tokenPayload(intent, expiresAt);
  const signature = createHmac("sha256", confirmationSecret()).update(payload).digest("base64url");
  return { intent, notionalUsdt, estimatedMarginUsdt, estimatedStopLossUsdt, expiresAt, confirmationToken: `${payload}.${signature}`, confirmationPhrase: "EXECUTE LIVE ORDER" };
}

export function verifyConfirmationToken(token: string): { intent: LiveOrderIntent; expiresAt: string } {
  const [payload, supplied] = token.split(".");
  if (!payload || !supplied) throw new Error("Invalid confirmation token.");
  const expected = createHmac("sha256", confirmationSecret()).update(payload).digest("base64url");
  const left = Buffer.from(supplied); const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error("Invalid confirmation signature.");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { intent: LiveOrderIntent; expiresAt: string };
  if (Date.parse(decoded.expiresAt) <= Date.now()) throw new Error("Confirmation expired; prepare the order again.");
  return decoded;
}

class BtccLiveClient {
  private readonly baseUrl = process.env.BTCC_API_BASE_URL!;
  private token = "";
  private accountId = process.env.BTCC_ACCOUNT_ID!;

  private async request(path: string, method: "GET" | "POST", parameters: Record<string, string | number>): Promise<BtccResponse> {
    const secret = process.env.BTCC_SECRET_KEY!;
    const sign = signBtccParameters(parameters, secret);
    const fields = new URLSearchParams({ ...Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, String(value)])), sign });
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}${method === "GET" ? `?${fields}` : ""}`;
    const response = await fetch(url, {
      method,
      cache: "no-store",
      headers: method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
      body: method === "POST" ? fields : undefined,
      signal: AbortSignal.timeout(10_000)
    });
    const data = await response.json() as BtccResponse;
    if (!response.ok || data.code !== 0) throw new Error(`BTCC ${path} failed: ${data.msg || response.statusText}`);
    return data;
  }

  async login() {
    const result = await this.request("/v1/user/login", "POST", {
      user_name: process.env.BTCC_USERNAME!, password: process.env.BTCC_PASSWORD!, company_id: 1, api_key: process.env.BTCC_API_KEY!
    });
    this.token = String(result.token || "");
    const account = result.account as { id?: string | number } | undefined;
    if (account?.id) this.accountId = String(account.id);
    if (!this.token) throw new Error("BTCC login returned no session token.");
  }

  async positions() {
    await this.login();
    return this.request("/v1/account/positionlist", "GET", { token: this.token, accountid: this.accountId, pageNo: 1, pageSize: 100 });
  }

  async openPosition(intent: LiveOrderIntent) {
    await this.login();
    return this.request("/v1/account/openposition", "POST", {
      token: this.token,
      accountid: this.accountId,
      direction: intent.direction === "LONG" ? 1 : 2,
      symbol: intent.symbol,
      request_volume: intent.volume,
      request_price: intent.referencePrice,
      refid: intent.idempotencyKey.replace(/\D/g, "").slice(-15) || Date.now(),
      stop_loss: intent.stopLoss,
      take_profit: intent.takeProfit,
      multiple: intent.leverage
    });
  }
}

export async function executeLiveOrder(intent: LiveOrderIntent) {
  const status = getLiveConfigurationStatus();
  if (!status.ready) throw new Error(status.blockers.join(" "));
  return new BtccLiveClient().openPosition(intent);
}

export async function getLivePositions() {
  const status = getLiveConfigurationStatus();
  if (!status.ready) throw new Error(status.blockers.join(" "));
  return new BtccLiveClient().positions();
}
