# Copy-Trading Control Center — Build Scope

## Product boundary

This project is a **copy-trading companion and portfolio control center**. It is separate from the Crypto Signal Bot and does not depend on a BTCC order-execution API endpoint.

Users sign in to BTCC, Bitget, or other supported venues through each venue's own official interface and create, edit, or stop native copy-trading relationships there. This application must not collect exchange passwords, 2FA codes, API secrets, seed phrases, or private keys.

## Initial release: useful without exchange APIs

1. Exchange launchpad with official login/copy-trading links and a status for each integration.
2. Portfolio ledger that can accept user-entered snapshots or imported CSVs, clearly labelled with source and timestamp.
3. Copy-trader comparison table with observed return, observation period, max drawdown, win rate, trade count, exposure/leverage, fees/profit share, and data confidence.
4. Allocation planner with per-trader and total exposure caps; calculations are advisory and never submit trades.
5. Review log recording why a trader was selected, settings the user chose in the exchange, and periodic performance checks.
6. Paper-trading / shadow-evaluation mode before any reliance on real capital.
7. Mobile-first dashboard with stale-data warnings and a prominent pause/checklist workflow.

## Exchange workflow

- **BTCC:** Open the official website/app, then use Copy > Futures Copy Trading. Review the trader profile and history. Choose fixed or proportional margin, set per-trade size and maximum copy amount, review ongoing-position/auto-update options, and configure available copy stop-loss and per-order exits before confirming on BTCC.
- **Bitget:** Link to the official website/app and native copy-trading page. All enrollment and copy settings remain on Bitget unless a future supported integration is separately validated.
- Never simulate a successful login, pretend a copy relationship is active, or claim account balances are live when the user has not connected or supplied a timestamped data source.

## Risk and evaluation rules

- Rank traders using multi-period, fee-adjusted performance and risk—not raw ROI or win rate alone.
- Track maximum drawdown, loss streaks, volatility, leverage, position concentration, funding/fees, profit sharing, slippage, history length, and consistency across market regimes.
- Flag short histories, sudden ROI spikes, unusually high leverage, missing data, and incompatible copy settings.
- Show gross PnL and estimated net PnL separately. Label estimates and missing costs.
- Allocation limits are advisory in v1. Exchange-native limits and stop-loss settings must be confirmed directly in the exchange UI.
- No guaranteed earnings claims. No autonomous execution in this project’s initial release.

## Integration maturity labels

Use only these labels: **Manual link**, **User-imported**, **Read-only connected**, **Tested in sandbox**, **Live verified**. Promote a connector only after evidence and tests support it. A browser login alone is not proof that the app can safely read private account data.

## Definition of done for v1

- Responsive dashboard renders on mobile and desktop.
- BTCC and Bitget launch links are labelled as external actions.
- Demo data is clearly marked as demo and can never be mistaken for the user's live account.
- Trader scoring is deterministic, documented, and tested against missing/invalid inputs.
- Import/manual-entry paths validate currency, timestamp, and source.
- No exchange credentials, withdrawal/transfer functions, or trade execution.
- Unit tests cover scoring, drawdown, stale data, allocation caps, and invalid inputs.
- Deployment and real account connectivity are reported only after direct verification.

## Official workflow reference

BTCC's help guide describes selecting a lead trader from the Copy / Futures Copy Trading area, reviewing trader metrics, choosing fixed or proportional margin, setting maximum copy amount, and configuring optional risk controls. The app should guide the user to complete these actions inside BTCC rather than inventing an undocumented enrollment endpoint.
