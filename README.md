# GEM Copy Center

A copy-trading **planning, intelligence, and record-keeping** dashboard. It helps you compare copy traders, keep review notes and bookmarks, record manual portfolio snapshots, back up those records, and (optionally) sync them to a private cloud workspace. Its **intelligence engine** scores strategies across providers (BTCC, Bitget, MT5, and any you add), proposes small allocations within explicit risk limits, monitors portfolio-level risk, and runs walk-forward backtests — see [docs/INTELLIGENCE_ENGINE.md](docs/INTELLIGENCE_ENGINE.md).

**What it does not do:** it does not place trades, enroll you in copy trading, mirror positions, or read exchange balances. Copy-trading enrollment and every trade happen on the exchange's own website or app (for example BTCC → Copy → Futures Copy Trading). The dashboard never asks for exchange passwords, 2FA codes, API keys or secrets, seed phrases, or private keys.

- Production: https://btcc-copy-manager.vercel.app (`/` is the Copy Center workspace; the full engine is at `/copy-trading`)
- Cloud setup, Supabase and email configuration: [CLOUD_SETUP.md](CLOUD_SETUP.md)
- In-app agent (★ Agent tab) setup: [AGENT_SETUP.md](AGENT_SETUP.md)
- Product scope: [docs/COPY_TRADING_CONTROL_CENTER_SCOPE.md](docs/COPY_TRADING_CONTROL_CENTER_SCOPE.md)

## Features

| Area | Behaviour |
| --- | --- |
| Exchange access | External links to BTCC, Bitget and MT5 with instructions for each venue's native copy-trading flow. |
| Intelligence engine | Provider registry with capability/status tracking, strategy research records and CSV history import, transparent scoring, correlation clusters, small-capital allocation planner, risk center with alerts, monitoring reviews with audit trail, walk-forward backtests and paper portfolios, optional read-only wallet connections. All provider actions remain on the provider. |
| ★ Agent | Chat assistant (Claude) that can run the dashboard's jobs for you: review the workspace, explain risk, propose plans, run backtests, and draft changes (add a trader, change plan or risk limits, record a provider update, run a review). Every change is shown first and saved only when you click Approve; approved changes go to the audit trail. Requires `ANTHROPIC_API_KEY` and a signed-in cloud account. It cannot move money or touch exchange accounts. |
| Trader comparison | Demo rows (clearly labelled, hideable) plus your own records. Create, edit, delete (with confirmation), search, filter by venue, and a transparent screening score. |
| Review bookmarks | "Save review" toggle per trader. |
| Portfolio ledger | Timestamped manual snapshots (equity, available, unrealized P&L). Validation: non-negative values, available ≤ equity, no future timestamps. Delete with confirmation. |
| Allocation planner | Advisory per-trader cap calculator. Moves no funds. |
| Backup | Export a JSON backup; import with validation (size, JSON, schema, every record) and confirmation before replacing existing records. CSV export for traders and snapshots. |
| Cloud account | Email/password sign-up, email confirmation, sign-in, sign-out, session restore via Supabase Auth. |
| Cloud workspace | Manual **Upload** (replaces the cloud copy after confirmation) and **Restore** (validates the cloud copy, asks for confirmation, downloads a backup of the current browser records, then replaces them). |

## Requirements

- Node.js 24+ (CI uses 24) and pnpm 10.28 (`corepack enable`).
- For cloud features: a Supabase project (see CLOUD_SETUP.md).

## Local development

```bash
pnpm install
cp .env.example .env.local   # fill in SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or leave empty for local-only mode
pnpm dev                     # http://localhost:3000/copy-trading
```

Without Supabase variables the dashboard works in browser-local mode and the cloud panel shows "Setup required".

## Environment variables

Configure in Vercel → Project → Settings → Environment Variables (Production and Preview). Never commit values.

| Name | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | for cloud | Supabase project URL (`https://<ref>.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for cloud | Supabase anon/publishable key. Public by design; access is enforced by row-level security. Only read on the server. |
| `ANTHROPIC_API_KEY` | for ★ Agent | Server-only key for the in-app agent (see AGENT_SETUP.md). Without it the Agent tab shows a "not switched on" notice and everything else works. |
| `COPY_CENTER_SITE_URL` | optional | Base URL for confirmation-email links (default: the request's own origin). Set to `https://btcc-copy-manager.vercel.app` so preview deployments don't generate preview links. |

**Never** set a Supabase service-role key for this app. Other variables in `.env.example` belong to the legacy code (see below) and are not used by the Copy Center.

## Data storage

Browser-local (per browser and device; cleared if you clear site data):

| Key | Contents |
| --- | --- |
| `gem-copy-center-traders-v1` | Array of trader records |
| `gem-copy-center-saved-v1` | Array of bookmarked trader names |
| `gem-copy-center-snapshots-v1` | Array of portfolio snapshots |
| `gem-copy-center-engine-v1` | Intelligence engine state (providers, strategies, policy, alerts, audit, score history, paper portfolios) |

Every load is validated; unreadable records are skipped (with a notice) instead of crashing the page. Storage failures (full or disabled storage) are reported.

Cloud: one row per user in `public.copy_center_workspaces` (`payload` = `{ traders, savedReviews, portfolioSnapshots, engine? }`). Validation rules and limits (750 KB, 1000 traders, 1000 bookmarks, 5000 snapshots) live in `lib/workspace.ts` and are shared by the browser and the server.

## Backup and restore

- **Export backup** downloads `gem-copy-center-backup-<timestamp>.json` (schema `gem-copy-center-backup-v2`; v1 files still import).
- **Import backup** rejects files over 750 KB, invalid JSON, unknown schemas, or any invalid record; nothing is partially applied. If the browser already has records you are asked before they are replaced.
- **Upload local records** replaces the cloud copy after confirmation (with an extra warning when uploading an empty workspace).
- **Restore from cloud** validates the cloud copy, shows both record counts, and on confirmation first downloads `gem-copy-center-backup-before-cloud-restore-*.json`, then replaces the browser records.

## API

| Route | Notes |
| --- | --- |
| `GET /api/auth/session` | `{ configured, authenticated, user }`. Refreshes or clears session cookies. |
| `POST /api/auth/signup` | Requests an account. Reports that a confirmation email was *requested*, never that it was delivered. |
| `POST /api/auth/login` | Sets HttpOnly session cookies. |
| `POST /api/auth/resend` | Requests a new confirmation email (does not reveal whether an address is registered). |
| `POST /api/auth/logout` | Revokes the session at Supabase (best effort) and clears cookies. |
| `GET /api/workspace` | Signed-in user's workspace (`401` if signed out). |
| `PUT /api/workspace` | Saves the signed-in user's workspace (validated; owner id taken from the verified session). |
| `GET /api/agent` | `{ configured, signedIn }` — whether the agent key is set and the caller is signed in. Never reveals the key. |
| `POST /api/agent` | One agent step for a signed-in user (`401` otherwise, `503` if not configured). Body: the conversation transcript (validated: user/assistant only, no system role, ≤ 400 KB). The server adds the fixed system prompt and tool list; tools run in the browser, writes only after approval. |

All state-changing routes require same-origin requests and `Content-Type: application/json`, and are rate-limited per client (best effort, in-memory per serverless instance; Supabase applies its own limits). Error responses are fixed, safe messages with a `code`; upstream error text, tokens, and passwords are never returned or logged.

Session cookies `gem_cc_access` (≤ 1 day) and `gem_cc_refresh` (30 days) are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.

## Testing

```bash
pnpm typecheck   # TypeScript
pnpm test        # node --test: workspace validation, auth/workspace service with mocked Supabase, plus legacy unit tests
pnpm build       # production build
pnpm check       # all three (what CI runs)
```

### Browser end-to-end check (optional)

Runs the real production build against a local mock of Supabase (no real accounts or email):

```bash
pnpm build
node scripts/e2e/mock-supabase.mjs &                                                   # port 54321
SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-test-key pnpm start -p 3100 &
node scripts/e2e/copy-center-flow.cjs                                                    # needs Playwright + Chromium installed
node scripts/e2e/engine-flow.cjs                                                         # intelligence engine flows (no Supabase needed)
```

It covers empty states, create/edit/delete, persistence across reload, CSV/backup export, rejected imports, import/restore confirmation, sign-up messaging, unconfirmed and wrong-password sign-in, the confirmation-link landing, session cookies, upload/restore, sign-out, API rejection after sign-out, and mobile layout. The email endpoints are limited to 3 requests per 15 minutes per client, so restart the server between repeated runs.

## Deployment

Vercel builds from GitHub. Production currently deploys from the `feature/copy-trading-control-center` branch. Before promoting a change: CI green (`pnpm check`), verify on the preview deployment, apply any new SQL migration in Supabase (see CLOUD_SETUP.md), then merge.

## Repository layout

```
app/                  Deployed Next.js App Router app (GEM Copy Center)
  copy-trading/       Dashboard page, cloud panel, browser storage helpers, styles
  api/auth/*          Auth routes (thin adapters)
  api/workspace       Workspace route (thin adapter)
lib/workspace.ts      Shared data model + validation (browser and server)
lib/engine/           Intelligence engine: providers, quality, metrics, scoring, allocation, risk, monitoring, backtest
app/copy-trading/engine/  Engine dashboard tabs (A–H)
lib/cloud-core.ts     Framework-free Supabase auth/workspace logic (unit-tested)
lib/cloud-auth.ts     Next.js adapter: cookies, origin/content-type guards, rate limits
supabase/migrations/  SQL migrations (apply in order)
tests/                node --test unit tests
scripts/e2e/          Optional browser end-to-end check
src/, sentinel/, scripts/btcc-*   Legacy code — NOT deployed (see below)
```

**Important:** Next.js uses the root `app/` directory and ignores `src/app` when both exist. The legacy live-execution, purchase, Steel, and Sentinel code under `src/` is therefore not built or deployed; its unit tests still run. It is documented in [docs/LEGACY_LIVE_EXECUTION.md](docs/LEGACY_LIVE_EXECUTION.md). Do not move it into `app/` without a deliberate decision and security review.

## Known limitations

- Trader statistics and balances are typed in by you; they are not verified against the exchange. No provider has a live data integration yet, so the engine works from what you record.
- Monitoring reviews run in the browser when the dashboard is open; no background server job is deployed.
- Scores, proposals, backtests, and paper portfolios are analytical aids, not predictions or guaranteed returns.
- Cloud sync is manual, whole-workspace replacement (no merge). Last upload wins.
- Rate limiting is per serverless instance, not global.
- Cloud users cannot delete their cloud row from the UI (no DELETE grant by design); upload an empty workspace to clear it, or delete the account in Supabase.
- Email delivery depends on the Supabase project's email configuration (see CLOUD_SETUP.md).

## Troubleshooting

| Symptom | Likely cause / action |
| --- | --- |
| Cloud panel says "Setup required" | `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` missing or not `https://`; redeploy after setting them. |
| "Sign-up request accepted" but no email | See CLOUD_SETUP.md → Email confirmation. Default Supabase email only delivers to project team members and is heavily rate-limited. |
| "This email address has not been confirmed yet" | Open the newest confirmation link, or use **Resend confirmation email**. |
| Confirmation link says expired | Links are single-use and expire; request a new one. Check the Site URL / redirect allow-list. |
| "Too many requests" | App or Supabase rate limit; wait 15 minutes. |
| "Cross-site requests are not allowed" | Request came from another origin (expected protection). |
| Upload/restore "could not be read/saved" | Supabase unreachable, migration not applied, or RLS denied; check CLOUD_SETUP.md verification queries. |
| "unreadable browser record(s) were skipped" | Corrupt local storage; valid records loaded. Export a backup to keep a clean copy. |
