# BTCC Live Trading Manager

A mobile-first live execution control room for BTCC futures. The current build prepares, signs, confirms, and submits real futures positions through BTCC's documented TradeOpenAPI shape. It also reads live positions, enforces limits, supports a browser-scoped emergency stop, and records a local audit trail.

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

## Activation order

1. Obtain a current BTCC TradeOpenAPI base URL and a trade-enabled key from the authenticated API Management area/support.
2. Confirm the account owner authorizes automated futures execution.
3. Add encrypted environment variables and redeploy.
4. Open Connection and confirm every item shows READY.
5. Sync positions before creating an order.
6. Prepare a very small instruction, review the exchange symbol and calculated notional, type `EXECUTE LIVE ORDER`, and submit.

No code change is required after the live variables are configured unless BTCC's current contract differs from the April 2025 guide.
