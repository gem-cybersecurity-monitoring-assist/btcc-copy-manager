export type LiveDirection = "LONG" | "SHORT";

export type LiveOrderIntent = {
  idempotencyKey: string;
  symbol: string;
  direction: LiveDirection;
  volume: number;
  referencePrice: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
};

export type LiveConfigurationStatus = {
  ready: boolean;
  executionEnabled: boolean;
  adapterMode: "disabled" | "btcc-live";
  missing: string[];
  blockers: string[];
  policy: { maxLeverage: number; maxOrderNotionalUsdt: number; stopLossRequired: true; withdrawals: false };
};

export type PreparedLiveOrder = {
  intent: LiveOrderIntent;
  notionalUsdt: number;
  estimatedMarginUsdt: number;
  estimatedStopLossUsdt: number;
  expiresAt: string;
  confirmationToken: string;
  confirmationPhrase: "EXECUTE LIVE ORDER";
};
