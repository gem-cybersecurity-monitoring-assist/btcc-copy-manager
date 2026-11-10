// MetaTrader 5 read-only adapter: investor (read-only) login only.
//
// MT5 has no public web API, so reading an account needs a bridge: either a
// running MT5 terminal or a third-party service. No bridge has been chosen, so
// the default bridge reports "bridge_not_configured" and the UI shows the
// account as not connected. Nothing is ever simulated.
//
// The Mt5Bridge contract has read methods only (account, positions, history).
// There is deliberately no order, close, deposit or withdrawal method. A bridge
// must report `tradeAllowed`; the adapter accepts only `false` (what MT5
// reports for an investor login) and otherwise refuses the credentials.

export type Mt5Credentials = { login: string; server: string; investorPassword: string };

export type Mt5Account = {
  login: string; server: string; currency: string | null; leverage: number | null;
  balance: number | null; equity: number | null; margin: number | null; freeMargin: number | null;
  profit: number | null; tradeAllowed: boolean;
};
export type Mt5Position = {
  ticket: string; symbol: string; side: "buy" | "sell"; volume: number | null; openPrice: number | null;
  currentPrice: number | null; profit: number | null; openedAt: string | null;
};
export type Mt5Deal = { ticket: string; symbol: string; side: string | null; volume: number | null; price: number | null; profit: number | null; time: string };

/** Read-only bridge contract. Implementations must not expose trading. */
export interface Mt5Bridge {
  readonly name: string;
  readonly configured: boolean;
  readAccount(credentials: Mt5Credentials): Promise<Mt5Account>;
  readPositions(credentials: Mt5Credentials): Promise<Mt5Position[]>;
  readHistory(credentials: Mt5Credentials, sinceIso: string): Promise<Mt5Deal[]>;
}

export class Mt5BridgeError extends Error {
  readonly code: "bridge_not_configured" | "bridge_rejected" | "bridge_unreachable" | "bridge_invalid" | "not_investor_login";
  constructor(code: Mt5BridgeError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export const MT5_NOT_CONFIGURED_REASON =
  "No MT5 bridge is configured. MT5 has no public web API; reading this account needs an MT5 terminal or bridge service, which has not been chosen yet. Saved credentials stay encrypted and unused until then.";

/** Default bridge: refuses every read. No network access, no simulated data. */
export const unconfiguredBridge: Mt5Bridge = {
  name: "none",
  configured: false,
  async readAccount() { throw new Mt5BridgeError("bridge_not_configured", MT5_NOT_CONFIGURED_REASON); },
  async readPositions() { throw new Mt5BridgeError("bridge_not_configured", MT5_NOT_CONFIGURED_REASON); },
  async readHistory() { throw new Mt5BridgeError("bridge_not_configured", MT5_NOT_CONFIGURED_REASON); },
};

/**
 * Selects the bridge from server configuration. No bridge is implemented yet,
 * so this always returns the unconfigured bridge; a chosen bridge is added here.
 */
export function mt5BridgeFromEnv(_env: Record<string, string | undefined>): Mt5Bridge {
  return unconfiguredBridge;
}

export function parseMt5Credentials(input: unknown): Mt5Credentials | null {
  const body = input as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return null;
  const login = typeof body.login === "string" ? body.login.trim() : typeof body.login === "number" ? String(body.login) : "";
  const server = typeof body.server === "string" ? body.server.trim() : "";
  const password = body.investorPassword;
  if (!/^\d{4,12}$/.test(login)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(server)) return null;
  if (typeof password !== "string" || !password.length || password.length > 128) return null;
  return { login, server, investorPassword: password };
}

export const mt5AccountRef = (c: Pick<Mt5Credentials, "login" | "server">) => `mt5:${c.login}@${c.server}`;

export type Mt5Snapshot = {
  source: "mt5_investor_readonly";
  bridge: string;
  capturedAt: string;
  account: Omit<Mt5Account, "tradeAllowed">;
  positions: Mt5Position[];
  history: { since: string; deals: Mt5Deal[] };
};

/** Reads through the bridge and enforces investor (no-trade) access first. */
export async function readMt5Snapshot(bridge: Mt5Bridge, credentials: Mt5Credentials, now: Date = new Date()): Promise<Mt5Snapshot> {
  if (!bridge.configured) throw new Mt5BridgeError("bridge_not_configured", MT5_NOT_CONFIGURED_REASON);
  const account = await bridge.readAccount(credentials);
  if (account.tradeAllowed !== false)
    throw new Mt5BridgeError("not_investor_login", "This login can trade. Use the MT5 investor (read-only) password, not the master password.");
  if (account.login !== credentials.login) throw new Mt5BridgeError("bridge_invalid", "The bridge returned a different account.");
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [positions, deals] = await Promise.all([bridge.readPositions(credentials), bridge.readHistory(credentials, since)]);
  const { tradeAllowed: _ignored, ...safeAccount } = account;
  return {
    source: "mt5_investor_readonly", bridge: bridge.name, capturedAt: now.toISOString(),
    account: safeAccount, positions: positions.slice(0, 500), history: { since, deals: deals.slice(0, 1000) },
  };
}
