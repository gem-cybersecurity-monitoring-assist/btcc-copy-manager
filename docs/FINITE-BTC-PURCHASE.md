# Finite BTC Purchase Controller

This workspace adds a finite purchase path at `/purchase` for buying Bitcoin in an exact, bounded number of child purchases and then stopping.

## Behavior

A plan is defined by:

- `amountPerExecution`: chosen at runtime; there is no hard-coded `$300` amount.
- `executionCount`: a positive whole number up to `PURCHASE_MAX_EXECUTIONS`.
- `totalAuthorized = amountPerExecution × executionCount`.
- `quoteCurrency`: USD or EUR.
- `payinGroup`: Switchere `card` or `balance`.
- destination: one server-configured `BTCC_BTC_DEPOSIT_ADDRESS`.

The owner-facing disclosure must acknowledge the full finite total before the plan can be prepared. A signed short-lived plan then locks the amount, count, total, destination and deterministic child order IDs. Execution creates exactly those Switchere partner orders and does not create a cron job or recurring schedule.

The system does not store, replay, reuse or submit an OTP/2FA value. Provider/card authentication remains inside Switchere or the issuer. Card-funded child orders may therefore still require provider authentication individually. A funded Switchere balance can be selected when the account and partner setup support it.

## Idempotency

Every child gets a stable unique `partner_order_id` derived from the signed plan. Before creating a child, the adapter checks Switchere for that order. Retrying the same plan reuses an existing child rather than intentionally adding another purchase.

If one child succeeds and a later child fails, the API returns `partial`. Retrying the same signed plan is the recovery path; do not prepare a new plan unless the intended authorization itself changes.

## Switchere contract used

The adapter targets Switchere Partner API v2:

- `GET /api/v2/partner/order/{partner_order_id}` for idempotent lookup.
- `POST /api/v2/partner/order/create` for each BTC purchase child.
- `API-Key` and `API-Signature` request headers.
- signature: `HMAC-SHA512(SHA256(path + body), partner_secret)`, base64 encoded.

Each order is created with the selected fiat amount, payout currency `BTC`, payout group `crypto`, and the fixed BTCC BTC deposit address.

## Required deployment configuration

```env
SWITCHERE_API_BASE_URL=https://switchere.com
SWITCHERE_PARTNER_API_KEY=<partner key>
SWITCHERE_PARTNER_API_SECRET=<partner secret>
BTCC_BTC_DEPOSIT_ADDRESS=<BTCC BTC deposit address for the intended account/network>
PURCHASE_CONTROL_SECRET=<16+ character operator control secret>
PURCHASE_CONFIRMATION_SECRET=<24+ character HMAC secret; optional if LIVE_CONFIRMATION_SECRET already exists>
PURCHASE_MAX_TOTAL_FIAT=<maximum total authorized by one finite plan>
PURCHASE_MAX_EXECUTIONS=10
PURCHASE_PLAN_TTL_SECONDS=300
PURCHASE_LIVE_EXECUTION=true
```

Keep all real values in encrypted deployment environment settings. Never commit or paste them into source control.

## API

- `GET /api/v1/purchase/status` — readiness and policy; does not return secrets or the full BTCC deposit address.
- `POST /api/v1/purchase/prepare` — validates the finite plan and returns the signed confirmation token and exact child IDs.
- `POST /api/v1/purchase/execute` — requires the exact confirmation phrase plus `x-purchase-control-secret`; creates or safely reuses the finite Switchere child orders.

## Activation rule

Keep `PURCHASE_LIVE_EXECUTION=false` until the Switchere partner credentials, exact BTCC BTC deposit address/network, maximum finite total, control secret and confirmation secret have all been verified in the deployment environment. The status route fails closed while any of those items are missing.
