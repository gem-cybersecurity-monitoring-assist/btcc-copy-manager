export type CapabilityState = "VERIFIED" | "UNKNOWN" | "RESTRICTED" | "FORBIDDEN";

export type CopyPlan = {
  id: string;
  name: string;
  leader: string;
  symbol: string;
  allocatedUsdt: number;
  marginPerTradeUsdt: number;
  leverage: number;
  maxOpenTrades: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  leaderDrawdownPercent: number;
  state: "REVIEW" | "LIVE_READY" | "FROZEN" | "ENDED";
  updatedAt: string;
};

export type RiskResult = {
  score: number;
  grade: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  worstCaseMarginUsdt: number;
  notionalPerTradeUsdt: number;
  portfolioExposureUsdt: number;
  estimatedStopLossUsdt: number;
  flags: string[];
  recommendations: string[];
};

export type AuditEvent = {
  id: string;
  at: string;
  action: string;
  detail: string;
  outcome: "INFO" | "PASS" | "BLOCK";
};
