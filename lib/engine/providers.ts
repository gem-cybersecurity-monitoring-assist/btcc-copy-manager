// Provider registry, capability model, and the account status state machine.
// Built-in providers are guided/manual: none exposes a documented copy-trading enrollment API that
// this project has implemented and verified, so GEM never claims to activate or pause copying itself.

import type { Capability, CapabilityState, Evidence, ProviderAccount, ProviderDefinition, ProviderStatus } from "./types.ts";

const MANUAL_CAPABILITIES: Record<Capability, CapabilityState> = {
  research_profiles: "not_implemented",
  read_account: "not_implemented",
  read_copy_status: "not_implemented",
  activate_copy: "not_available",
  pause_copy: "not_available",
  place_orders: "not_implemented",
};

export const BUILT_IN_PROVIDERS: ProviderDefinition[] = [
  {
    id: "btcc",
    name: "BTCC",
    url: "https://www.btcc.com/",
    copyUrl: "https://www.btcc.com/",
    platformType: "crypto_exchange",
    markets: ["crypto perpetual futures"],
    integration: "guided_native",
    capabilities: { ...MANUAL_CAPABILITIES },
    defaultMinAllocationUsd: null,
    feeNotes: "Lead-trader profit share plus futures trading fees and funding. Read the exact terms on the trader's BTCC profile.",
    limitations: [
      "BTCC's public API material documents futures orders, not copy-trading enrollment. GEM does not use order endpoints as a substitute.",
      "Account, balance, and copy status are entered by you; GEM cannot read them from BTCC.",
    ],
    activationSteps: [
      "Sign in on the official BTCC website or app.",
      "Open Copy → Futures Copy Trading and find the selected lead trader.",
      "Review the profile, history, and profit share.",
      "Choose fixed or proportional margin, per-trade size, and maximum copy amount (use GEM's proposed amount as the cap).",
      "Set the copy stop-loss / take-profit options, then confirm on BTCC.",
      "Return to GEM and record the activation with what you saw.",
    ],
    pauseSteps: [
      "On BTCC, open Copy → My copy trading and choose Stop copying for the trader.",
      "Stopping copy may leave already-copied positions open. Close them separately in the futures positions view if you want to exit.",
    ],
    builtIn: true,
  },
  {
    id: "bitget",
    name: "Bitget",
    url: "https://www.bitget.com/",
    copyUrl: "https://www.bitget.com/copy-trading",
    platformType: "crypto_exchange",
    markets: ["crypto perpetual futures", "crypto spot"],
    integration: "guided_native",
    capabilities: { ...MANUAL_CAPABILITIES, activate_copy: "not_implemented", pause_copy: "not_implemented", read_copy_status: "not_implemented" },
    defaultMinAllocationUsd: null,
    feeNotes: "Elite-trader profit share plus trading fees and funding. Minimums and terms are shown on each trader's Bitget copy page.",
    limitations: [
      "Bitget publishes an API with copy-trading sections. GEM has not implemented or verified it, so all actions are manual.",
      "An integration would require a read-only API key stored server-side and separate testing before any status is reported as verified.",
    ],
    activationSteps: [
      "Sign in on the official Bitget website or app.",
      "Open Copy trading, find the selected trader, and review their history and terms.",
      "Set the copy amount (GEM's proposal as the maximum) and any stop-loss / take-profit settings.",
      "Confirm on Bitget, then record the activation in GEM.",
    ],
    pauseSteps: [
      "In Bitget Copy trading → My traders, choose Unfollow / stop copying.",
      "Unfollowing may not close open copied positions. Close them separately if you want to exit.",
    ],
    builtIn: true,
  },
  {
    id: "mt5",
    name: "MetaTrader 5 (broker + MQL5 Signals)",
    url: "https://www.metatrader5.com/",
    copyUrl: "https://www.mql5.com/en/signals",
    platformType: "mt5_broker",
    markets: ["FX", "indices", "commodities", "broker CFDs"],
    integration: "guided_native",
    capabilities: { ...MANUAL_CAPABILITIES },
    defaultMinAllocationUsd: null,
    feeNotes: "MQL5 signal subscription fee (often monthly) plus broker spreads/commissions. A fixed monthly fee can make small allocations uneconomic.",
    limitations: [
      "Signal subscription happens inside your broker's MT5 terminal. GEM has no connection to the terminal or broker.",
      "Broker minimum deposits and lot-size limits may prevent small allocations from copying accurately.",
    ],
    activationSteps: [
      "Open your broker's MT5 terminal and sign in to your trading account.",
      "Open the Signals tab, select the signal, and review its statistics and subscription fee.",
      "Configure the deposit-load and copy settings, then subscribe.",
      "Record the activation in GEM with the subscription fee as a cost.",
    ],
    pauseSteps: [
      "In MT5 Signals, unsubscribe from the signal (or disable signal copying in the terminal options).",
      "Unsubscribing does not close positions already opened; close them manually in the terminal if needed.",
    ],
    builtIn: true,
  },
];

export function allProviders(custom: ProviderDefinition[]): ProviderDefinition[] {
  return [...BUILT_IN_PROVIDERS, ...custom.filter((c) => !BUILT_IN_PROVIDERS.some((b) => b.id === c.id))];
}

export function findProvider(id: string, custom: ProviderDefinition[]) {
  return allProviders(custom).find((p) => p.id === id) ?? null;
}

/** A user-defined provider is always manual until a real adapter is implemented and verified. */
export function createCustomProvider(input: { name: string; url: string; markets: string[]; minAllocationUsd: number | null; feeNotes: string }): ProviderDefinition {
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "provider";
  return {
    id: "custom-" + slug,
    name: input.name.trim().slice(0, 80),
    url: input.url,
    copyUrl: input.url,
    platformType: "other",
    markets: input.markets,
    integration: "manual",
    capabilities: { ...MANUAL_CAPABILITIES, activate_copy: "not_implemented", pause_copy: "not_implemented" },
    defaultMinAllocationUsd: input.minAllocationUsd,
    feeNotes: input.feeNotes,
    limitations: ["User-added provider. GEM has no integration; every status and figure is entered by you."],
    activationSteps: ["Follow the provider's own copy-trading instructions on its official site.", "Record each step in GEM as you complete it."],
    pauseSteps: ["Use the provider's own stop/unfollow control. Check whether open positions remain and close them there if needed."],
    builtIn: false,
  };
}

// ---- Status state machine ---------------------------------------------------

/** Forward path plus the explicit side states. DATA_STALE is derived from sync age and never set by hand. */
const TRANSITIONS: Record<ProviderStatus, ProviderStatus[]> = {
  DISCOVERED: ["ACCOUNT_LINKED", "NOT_SUPPORTED"],
  ACCOUNT_LINKED: ["ACCOUNT_VERIFIED", "DISCOVERED", "DISCONNECTED", "ERROR"],
  ACCOUNT_VERIFIED: ["TRADER_SELECTED", "ACCOUNT_LINKED", "DISCONNECTED", "ERROR"],
  TRADER_SELECTED: ["COPY_ACTIVATION_PENDING", "ACCOUNT_VERIFIED", "DISCONNECTED", "ERROR"],
  COPY_ACTIVATION_PENDING: ["COPY_ACTIVE", "TRADER_SELECTED", "DISCONNECTED", "ERROR"],
  COPY_ACTIVE: ["PAUSED", "DISCONNECTED", "ERROR"],
  PAUSED: ["COPY_ACTIVATION_PENDING", "TRADER_SELECTED", "DISCONNECTED", "ERROR"],
  DISCONNECTED: ["ACCOUNT_LINKED", "DISCOVERED"],
  DATA_STALE: [],
  ERROR: ["ACCOUNT_LINKED", "DISCONNECTED", "DISCOVERED"],
  NOT_SUPPORTED: ["DISCOVERED"],
};

export function allowedTransitions(from: ProviderStatus): ProviderStatus[] {
  return TRANSITIONS[from];
}

export const STATUS_LABELS: Record<ProviderStatus, string> = {
  DISCOVERED: "Discovered",
  ACCOUNT_LINKED: "Account linked",
  ACCOUNT_VERIFIED: "Account verified",
  TRADER_SELECTED: "Trader selected",
  COPY_ACTIVATION_PENDING: "Copy activation pending",
  COPY_ACTIVE: "Copy active",
  PAUSED: "Paused",
  DISCONNECTED: "Disconnected",
  DATA_STALE: "Data stale",
  ERROR: "Error",
  NOT_SUPPORTED: "Not supported",
};

/** What the user must state as evidence for a user-attested transition. */
export const STATUS_EVIDENCE_PROMPT: Partial<Record<ProviderStatus, string>> = {
  ACCOUNT_LINKED: "You have an account on this platform (you signed in on the official site).",
  ACCOUNT_VERIFIED: "The platform shows your account as verified/KYC-complete and able to copy trade.",
  TRADER_SELECTED: "You chose the trader/strategy below after reviewing it.",
  COPY_ACTIVATION_PENDING: "You started the copy setup on the platform but have not seen it confirmed.",
  COPY_ACTIVE: "The platform's own 'my copy trading' page lists this trader as actively copied.",
  PAUSED: "You stopped/paused copying on the platform.",
};

export type TransitionResult = { ok: true; account: ProviderAccount } | { ok: false; error: string };

export function transitionStatus(account: ProviderAccount, to: ProviderStatus, options: { at: string; evidence: Evidence; note: string; strategyId?: string | null }): TransitionResult {
  const from = account.status;
  if (to === "DATA_STALE") return { ok: false, error: "Data stale is set automatically from the last sync time." };
  if (!TRANSITIONS[from].includes(to)) return { ok: false, error: `Cannot move from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}.` };
  if (STATUS_EVIDENCE_PROMPT[to] && options.evidence === "user_attested" && options.note.trim().length < 3) {
    return { ok: false, error: "Describe what you saw on the platform to record this status." };
  }
  const selectedStrategyId = to === "TRADER_SELECTED" ? options.strategyId ?? null : account.selectedStrategyId;
  if (to === "TRADER_SELECTED" && !selectedStrategyId) return { ok: false, error: "Choose the trader or strategy you selected." };
  const clearSelection = to === "DISCOVERED" || to === "DISCONNECTED" || to === "ACCOUNT_LINKED" || to === "ACCOUNT_VERIFIED";
  return {
    ok: true,
    account: {
      ...account,
      status: to,
      selectedStrategyId: clearSelection ? null : selectedStrategyId,
      allocatedUsd: to === "DISCONNECTED" || to === "DISCOVERED" ? 0 : account.allocatedUsd,
      history: [...account.history, { status: to, at: options.at, evidence: options.evidence, note: options.note.trim().slice(0, 500) }].slice(-100),
    },
  };
}

export function newProviderAccount(def: ProviderDefinition, at: string): ProviderAccount {
  return {
    providerId: def.id,
    status: "DISCOVERED",
    history: [{ status: "DISCOVERED", at, evidence: "system", note: "Added to the provider registry." }],
    availableCapital: null,
    allocatedUsd: 0,
    minAllocationUsd: def.defaultMinAllocationUsd,
    fixedCostUsd: 0,
    selectedStrategyId: null,
    lastSyncAt: null,
    notes: "",
  };
}

/** Effective status: a provider that should be reporting data but has not synced recently is DATA_STALE. */
export function effectiveStatus(account: ProviderAccount, now: Date, staleAfterHours: number): ProviderStatus {
  const tracking = ["ACCOUNT_VERIFIED", "TRADER_SELECTED", "COPY_ACTIVATION_PENDING", "COPY_ACTIVE"].includes(account.status);
  if (!tracking) return account.status;
  if (!account.lastSyncAt) return account.status === "COPY_ACTIVE" ? "DATA_STALE" : account.status;
  const ageHours = (now.getTime() - Date.parse(account.lastSyncAt)) / 3_600_000;
  return ageHours > staleAfterHours ? "DATA_STALE" : account.status;
}

/** Honest one-line description of how a status is known. */
export function statusProvenance(account: ProviderAccount): string {
  const last = account.history[account.history.length - 1];
  if (!last) return "No history.";
  if (last.evidence === "official_api") return "Verified through the provider's official API.";
  if (last.evidence === "system") return "Set by GEM.";
  return "Confirmed by you on the platform; not independently verified by GEM.";
}
