# Bitget read-only evidence boundary

`BitgetCopyAdapter.account_evidence()` collects bounded, signed GET-only observations using injected transports in tests. It requires an overall read-only key with `uta_mgt`, optionally `uta_trade`; it rejects write, withdrawal, copy-trading and unknown scopes. Assets-only keys do not trigger trade endpoints. The web assets verifier's existing permission contract is unchanged.

USD aggregates (`accountEquity`, `effEquity`, `imr`, `positionValue`) remain explicitly USD. USDT equity and available USDT stay separate. Missing availability is unknown, never zero. Positions are counted from actual nonzero rows across all three futures categories; unavailable or invalid categories produce an incomplete result and unknown overall count.

Fill observations cover today's USDT futures window in the chosen timezone, with 1–10 pages per call, exchange-ID deduplication and repeated-cursor rejection. Fees remain separated by their actual coin. `fill_pnl_usdt` is closed-fill PnL only, available only for complete pagination; `net_pnl_today_usdt` is always unavailable because funding, cash flows and fee-currency reconciliation are not implemented. Local receipt times and available exchange envelope clocks are separate. A recent local fetch does not prove fresh exchange records.

The legacy `account_snapshot()` now fails closed without making HTTP calls: its execution-risk model cannot safely express missing USDT margin capacity and unreconciled daily PnL. Existing Sentinel consumers therefore remain blocked until those inputs are justified. This deliberately tightens the earlier incorrect mixed-unit/partial-PnL behavior; it does not enable any execution. The new evidence DTO is not yet wired to the production UI or persistent collector.

Official contracts verified 7 November 2026:

- Account scopes and identity: https://www.bitget.com/docs/catalog/account/account-settings
- Assets and financial records: https://www.bitget.com/docs/catalog/account/assets-balance
- Position categories and margin currencies: https://www.bitget.com/docs/catalog/trading/position-management
- Fills and bounded cursor pagination: https://www.bitget.com/docs/catalog/trading/order-management
- Read-only scope meaning: https://www.bitget.com/docs/uta/quick-start

This is a bounded collector method, not a persistent scheduler or rate-limit coordinator. Callers must share the UID request budget, back off on provider errors, and persist only owner-verified observations. No real credentials, authenticated provider calls, financial operations or production deployment were used for validation.
