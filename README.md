# BTCC Live Trading Manager

A mobile-first live execution control room for BTCC futures. The current build prepares, signs, confirms, and submits real futures positions through BTCC's documented TradeOpenAPI shape. It also reads live positions, enforces limits, supports a browser-scoped emergency stop, records a local audit trail, and can forward authenticated read-only BTCC observations into BTCC Sentinel.

## Supported live operations

- Trade-enabled BTCC connection readiness.
- Signed login using the documented API key/secret scheme.
- Live position list from `GET /v1/account/positionlist`.
- Live futures opening from `POST /v1/account/openposition`.
- Exact symbol, direction, volume, reference price, leverage, stop loss, and take profit.
- Maximum leverage and maximum order-notional enforcement.
- Two-minute HMAC confirmation tokens and an exact execution phrase.
- Idempotency reference on submitted instructions.
- Emergency pause for new submissions from the current browser.

The application intentionally contains no withdrawal, transfer, address-management, or deposit API route.

## BTCC Sentinel bridge

The app can forward normalized, read-only account/trader snapshots to BTCC Sentinel v0.3 without exposing BTCC authentication material.

Set:

```env
SENTINEL_URL=http://127.0.0.1:8421
```

Then verify the connection while both services are running:

```bash
curl http://127.0.0.1:3000/api/v1/sentinel/health
```

Browser/XHR collectors should POST normalized batches to:

```text
POST /api/v1/sentinel/collector
```

The manager forwards them to Sentinel `/collector/batch`. A recursive credential guard rejects payloads containing fields that look like passwords, cookies, API keys, tokens, sessions, authorization headers, OTPs or 2FA values. Authentication remains inside the BTCC session/client and must never be included in collector payloads.

## Authenticated read-only browser worker

`scripts/btcc-browser-worker.mjs` attaches to a dedicated Chrome/Chromium instance through the local Chrome DevTools Protocol. You log into BTCC manually in that browser. The worker then reads visible DOM text and safe links, discovers trader/profile pages, extracts account/trader/trade observations, and forwards normalized snapshots through the Sentinel collector bridge.

The worker does **not** read cookies, local/session storage, passwords, API keys, request authorization headers, OTP/2FA values, or form values. It does **not** click buttons, fill forms, transfer assets, start/stop copy trading, place orders, or withdraw funds. Navigation is limited to `btcc.com` pages.

Launch a **dedicated** Chrome profile with local remote debugging enabled. Close that dedicated Chrome window when you want to stop browser access.

macOS example:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.btcc-sentinel-chrome"
```

Linux example:

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.btcc-sentinel-chrome"
```

Windows PowerShell example:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:USERPROFILE\.btcc-sentinel-chrome"
```

In that dedicated Chrome window:

1. Open BTCC.
2. Log in yourself and complete any 2FA yourself.
3. Navigate to the BTCC page you want scanned, preferably Assets or Copy Trading / Recommended traders.
4. Leave the BTCC tab open.

Then run a dry read first:

```bash
pnpm browser:scan:dry
```

This prints the normalized snapshot locally and does not send it to Sentinel. If the values look correct, run one real push:

```bash
pnpm browser:scan:once
```

Then check:

```bash
curl http://127.0.0.1:8421/state/latest
curl http://127.0.0.1:8421/alerts
curl http://127.0.0.1:8421/scan
```

For continuous scanning:

```bash
pnpm browser:scan
```

Defaults can be changed without code changes:

```env
BTCC_CDP_HTTP=http://127.0.0.1:9222
BTCC_MANAGER_URL=http://127.0.0.1:3000
BTCC_SCAN_INTERVAL_MS=60000
BTCC_MAX_TRADER_PAGES=25
BTCC_NAVIGATION_DELAY_MS=1800
```

Important: the worker can only extract data actually rendered in the authenticated BTCC web UI. When BTCC changes its labels/layout, the parser may lower confidence or miss a field rather than inventing a value. Low-confidence observations should remain informational until verified.

A minimal collector payload is:

```json
{
  "account": {
    "total_usdt": 54.74,
    "futures_free_usdt": 1.34,
    "wallet_usdt": 53.40,
    "open_margin_usdt": 0,
    "active_positions": 0,
    "provenance": { "source": "dom", "confidence": 0.99 }
  },
  "traders": [],
  "collector_id": "btcc-browser-adapter"
}
```

This bridge is read-only. It does not create an undocumented BTCC copy-trading enrollment endpoint and does not bypass Sentinel's approval/risk workflow.

## Important BTCC distinction

BTCC publishes a native futures copy-trading product. The available TradeOpenAPI material documents ordinary futures positions and identifies copy-follower positions in returned data, but it does not document an endpoint to follow or unfollow a lead trader. Native lead-trader enrollment therefore remains in BTCC. This service manages live API futures execution and position visibility; it does not invent an undocumented copy-enrollment endpoint.

## Required live configuration

Add all values in the deployment provider's encrypted environment settings. Never commit them or paste them into chat.

```env
BTCC_API_BASE_URL=<current base URL supplied by BTCC>
BTCC_API_KEY=<trade-enabled access key>
BTCC_SECRET_KEY=<signing secret>
BTCC_USERNAME=<account login identifier>
BTCC_PASSWORD=<account password required by BTCC's documented login endpoint>
BTCC_ACCOUNT_ID=<authorized futures account id>
LIVE_CONFIRMATION_SECRET=<independent random 32+ byte secret>
BTCC_MAX_LEVERAGE=5
BTCC_MAX_ORDER_NOTIONAL_USDT=10
BTCC_LIVE_EXECUTION=true
SENTINEL_URL=http://127.0.0.1:8421
```

The user's previously described read-only API key cannot execute real orders. BTCC must issue/allow a trade-enabled key. The base URL must come from current authenticated BTCC documentation or support because the public support page no longer exposes it clearly.

## Run and verify

Requires Node.js 24+ and pnpm 10+.

```bash
pnpm install
pnpm check
pnpm dev
```

## API routes

- `GET /api/v1/live/status` — activation and limits, never secret values.
- `POST /api/v1/live/prepare` — validate and sign a two-minute confirmation instruction.
- `POST /api/v1/live/execute` — submit the confirmed real order.
- `GET /api/v1/live/positions` — retrieve live positions.
- `POST /api/v1/live/kill-switch` — pause/re-arm submissions for the current browser.
- `GET /api/v1/capabilities` — evidence-based capability registry.
- `GET /api/v1/sentinel/health` — verify the Sentinel service is reachable.
- `POST /api/v1/sentinel/collector` — forward normalized read-only snapshots to Sentinel.

## Activation order

1. Start BTCC Sentinel and verify `http://127.0.0.1:8421/health`.
2. Start this manager with `SENTINEL_URL=http://127.0.0.1:8421` and verify `/api/v1/sentinel/health`.
3. Launch the dedicated remote-debugging Chrome profile, log into BTCC manually, and leave a BTCC page open.
4. Run `pnpm browser:scan:dry` and confirm the extracted values are correct.
5. Run `pnpm browser:scan:once` and confirm Sentinel `/state/latest`, `/alerts`, and `/scan` reflect the same account snapshot.
6. Run `pnpm browser:scan` for continuous read-only monitoring.
7. Only after the read pipeline is trustworthy, enable paper actions and later bounded live execution.

For direct live futures execution, separately obtain a current BTCC TradeOpenAPI base URL and a trade-enabled key from the authenticated API Management area/support, confirm the account owner authorizes automated futures execution, add encrypted environment variables and redeploy, sync positions, prepare a very small instruction, review the exchange symbol and calculated notional, type `EXECUTE LIVE ORDER`, and submit.

No code change is required after the live variables are configured unless BTCC's current contract differs from the April 2025 guide.
