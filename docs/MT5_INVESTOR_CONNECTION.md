# MT5 investor (read-only) connection

Stage 1 builds the MT5 adapter and UI now and leaves them **not connected** until a bridge is chosen. No paid or third-party service is used. MT5 has no public web API, so reading an account needs a running MT5 terminal or a bridge service. The default bridge refuses every read and nothing is simulated.

## Saving the investor login

Accounts → MetaTrader 5 asks for three things:
- **Login:** digits only.
- **Server:** for example `Bitget-MT5-LIVE1`.
- **Investor password:** the read-only password, never the master password.

Where each one is kept:
- The **password** is encrypted with AES-256-GCM using `CONNECTION_SECRETS_KEY` and stored in the server-only `gem_copy_connection_secrets` table. It is never returned to the browser.
- **Login and server** are stored as the connection's account reference, `mt5:<login>@<server>`. They are entered in the UI and are deliberately not in the repository.
- While no bridge exists, the connection status is `PAUSED` with `last_error_code = bridge_not_configured`. The UI shows **"Saved · not connected"** and no figures.

## Routes (owner only)

- `GET /api/connections/mt5`: returns the saved login, the server, whether a password is stored, and the bridge status.
- `POST /api/connections/mt5`: saves or replaces the login. The body is `{ login, server, investorPassword }`.
- `POST /api/connections/mt5/refresh`: without a bridge, returns `503 bridge_not_configured`.
- `DELETE /api/connections/mt5`: deletes the encrypted password and marks the connection `DISCONNECTED`.

## Bridge contract (`lib/mt5-adapter.ts`)

A bridge implements three read methods and nothing else:
- `readAccount`: balance, equity, margin, free margin, profit, currency, leverage, and `tradeAllowed`.
- `readPositions`
- `readHistory`: the last 30 days.

The contract has no order, close, deposit or withdrawal method.

**Investor-only safeguard:** a login is accepted only if the bridge reports `tradeAllowed: false`, which is what MT5 reports for an investor login. If a login can trade (meaning the master password was entered), the adapter rejects it, deletes the stored password and marks the connection `ERROR` with `not_investor_login`. Nothing else is read.

**Adding a bridge later:** implement `Mt5Bridge` and return it from `mt5BridgeFromEnv`. Free options include:
- a small self-hosted service on a Windows host running the official `MetaTrader5` Python package, logged in with the investor password;
- the MT5 terminal's own export.

The adapter, routes and UI need no other change.
