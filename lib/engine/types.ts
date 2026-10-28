// Core types for the GEM Copy Trading Intelligence Engine.
// Everything here is plain data so it can live in the per-user workspace (browser storage,
// JSON backups, and the RLS-protected Supabase workspace row) and be unit-tested without a framework.

export const PROVIDER_STATUSES = [
  "DISCOVERED",
  "ACCOUNT_LINKED",
  "ACCOUNT_VERIFIED",
  "TRADER_SELECTED",
  "COPY_ACTIVATION_PENDING",
  "COPY_ACTIVE",
  "PAUSED",
  "DISCONNECTED",
  "DATA_STALE",
  "ERROR",
  "NOT_SUPPORTED",
] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

/** How GEM talks to a provider, in the priority order of the integration policy. */
export type IntegrationMethod = "official_copy_api" | "official_integration" | "guided_native" | "manual";

export const CAPABILITIES = ["research_profiles", "read_account", "read_copy_status", "activate_copy", "pause_copy", "place_orders"] as const;
export type Capability = (typeof CAPABILITIES)[number];
/** supported = implemented and verified; not_implemented = provider may offer it, GEM does not; not_available = provider offers no documented interface. */
export type CapabilityState = "supported" | "not_implemented" | "not_available";

export type PlatformType = "crypto_exchange" | "mt5_broker" | "strategy_marketplace" | "other";

export type ProviderDefinition = {
  id: string;
  name: string;
  url: string;
  copyUrl: string;
  platformType: PlatformType;
  markets: string[];
  integration: IntegrationMethod;
  capabilities: Record<Capability, CapabilityState>;
  /** Minimum copy amount in USD when reliably known; null means "unknown — read it from the provider". */
  defaultMinAllocationUsd: number | null;
  feeNotes: string;
  limitations: string[];
  activationSteps: string[];
  pauseSteps: string[];
  builtIn: boolean;
};

/** Who or what established a fact. Only `official_api` counts as independently verified. */
export type Evidence = "user_attested" | "official_api" | "system";

export type StatusChange = { status: ProviderStatus; at: string; evidence: Evidence; note: string };

export type ProviderAccount = {
  providerId: string;
  status: ProviderStatus;
  history: StatusChange[];
  /** Capital the user reports as available on this platform. */
  availableCapital: { amount: number; currency: string; observedAt: string; evidence: Evidence } | null;
  /** Amount the user reports as currently allocated to copy trading here (USD equivalent). */
  allocatedUsd: number;
  minAllocationUsd: number | null;
  /** Estimated fixed cost to fund/withdraw an allocation here (USD), e.g. network or transfer fees. */
  fixedCostUsd: number;
  selectedStrategyId: string | null;
  lastSyncAt: string | null;
  notes: string;
};

export type DataSource = "official_api" | "provider_profile" | "imported_csv" | "user_entered" | "simulated";

export type Observation = {
  id: string;
  strategyId: string;
  source: DataSource;
  method: string;
  collectedAt: string;
  /** 0..1, the collector's confidence that the values are accurate and complete. */
  confidence: number;
  verified: boolean;
  sourceUrl: string | null;
  values: {
    roiPct?: number;
    maxDrawdownPct?: number;
    winRatePct?: number;
    trades?: number;
    periodDays?: number;
    followers?: number;
    aumUsd?: number;
  };
};

/** Periodic returns as decimals (0.01 = +1%) on ISO dates. Parallel arrays keep the stored payload small. */
export type ReturnSeries = {
  frequency: "daily" | "weekly";
  dates: string[];
  returns: number[];
  basis: "gross" | "net";
  source: DataSource;
  collectedAt: string;
  verified: boolean;
};

export type Strategy = {
  id: string;
  providerId: string;
  name: string;
  externalId: string;
  profileUrl: string | null;
  assets: string[];
  style: string;
  maxLeverage: number | null;
  profitSharePct: number | null;
  minCopyUsd: number | null;
  series: ReturnSeries | null;
  observations: Observation[];
  createdAt: string;
};

export type RiskPolicy = {
  maxPerProviderPct: number;
  maxPerStrategyPct: number;
  maxClusterPct: number;
  maxAssetPct: number;
  maxStrategyDrawdownPct: number;
  maxPortfolioDrawdownPct: number;
  maxLeverage: number;
  minHistoryPoints: number;
  minConfidence: number;
  maxProfitSharePct: number;
  maxCostPct: number;
  staleAfterHours: number;
  correlationThreshold: number;
  minScore: number;
};

export type AllocationMethod = "equal" | "risk_adjusted" | "score_weighted";

export type PlannerSettings = {
  totalCapitalUsd: number;
  reservePct: number;
  maxPerProviderUsd: number;
  method: AllocationMethod;
  allowUnknownMinimum: boolean;
};

export type AlertSeverity = "info" | "warning" | "critical";
export type Alert = {
  key: string;
  severity: AlertSeverity;
  kind: string;
  subject: string;
  message: string;
  recommendation: string;
  createdAt: string;
  acknowledgedAt: string | null;
  /** Set by the monitor when the condition no longer holds. */
  resolvedAt: string | null;
};

export type AuditEvent = { id: string; at: string; actor: "user" | "engine"; action: string; detail: string };

export type ScoreSnapshot = { at: string; strategyId: string; score: number; eligible: boolean };

export type PaperPortfolio = {
  id: string;
  name: string;
  createdAt: string;
  startDate: string;
  method: AllocationMethod;
  positions: { strategyId: string; amountUsd: number }[];
  cashUsd: number;
};

export type ScoringWeights = {
  netReturn: number;
  drawdown: number;
  riskAdjusted: number;
  consistency: number;
  history: number;
  dataQuality: number;
};

export type EngineState = {
  version: 1;
  weights: ScoringWeights;
  providers: ProviderAccount[];
  customProviders: ProviderDefinition[];
  strategies: Strategy[];
  policy: RiskPolicy;
  planner: PlannerSettings;
  alerts: Alert[];
  audit: AuditEvent[];
  scoreHistory: ScoreSnapshot[];
  paperPortfolios: PaperPortfolio[];
  monitor: { intervalHours: number; lastRunAt: string | null; lastRunSummary: string | null };
};
