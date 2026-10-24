# GEM Copy Center

A copy-trading **planning and record-keeping** dashboard. It helps you compare copy traders, keep review notes and bookmarks, record manual portfolio snapshots, back up those records, and (optionally) sync them to a private cloud workspace.

**What it does not do:** it does not place trades, enroll you in copy trading, mirror positions, or read exchange balances. Copy-trading enrollment and every trade happen on the exchange's own website or app (for example BTCC → Copy → Futures Copy Trading). The dashboard never asks for exchange passwords, 2FA codes, API keys or secrets, seed phrases, or private keys.

- Production: https://btcc-copy-manager.vercel.app/copy-trading (`/` redirects there)
- Cloud setup, Supabase and email configuration: [CLOUD_SETUP.md](CLOUD_SETUP.md)
- Product scope: [docs/COPY_TRADING_CONTROL_CENTER_SCOPE.md](docs/COPY_TRADING_CONTROL_CENTER_SCOPE.md)

## Features

| Area | Behaviour |
| --- | --- |
| Exchange access | External links to BTCC, Bitget and MT5 with instructions for each venue's native copy-trading flow. |
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
| `COPY_CENTER_SITE_URL` | optional | Base URL for confirmation-email links (default: the request's own origin). Set to `https://btcc-copy-manager.vercel.app` so preview deployments don't generate preview links. |

**Never** set a Supabase service-role key for this app. Other variables in `.env.example` belong to the legacy code (see below) and are not used by the Copy Center.

## Data storage

Browser-local (per browser and device; cleared if you clear site data):

| Key | Contents |
| --- | --- |
| `gem-copy-center-traders-v1` | Array of trader records |
| `gem-copy-center-saved-v1` | Array of bookmarked trader names |
| `gem-copy-center-snapshots-v1` | Array of portfolio snapshots |

Every load is validated; unreadable records are skipped (with a notice) instead of crashing the page. Storage failures (full or disabled storage) are reported.

Cloud: one row per user in `public.copy_center_workspaces` (`payload` = `{ traders, savedReviews, portfolioSnapshots }`). Validation rules and limits (750 KB, 1000 traders, 1000 bookmarks, 5000 snapshots) live in `lib/workspace.ts` and are shared by the browser and the server.

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
lib/cloud-core.ts     Framework-free Supabase auth/workspace logic (unit-tested)
lib/cloud-auth.ts     Next.js adapter: cookies, origin/content-type guards, rate limits
supabase/migrations/  SQL migrations (apply in order)
tests/                node --test unit tests
scripts/e2e/          Optional browser end-to-end check
src/, sentinel/, scripts/btcc-*   Legacy code — NOT deployed (see below)
```

**Important:** Next.js uses the root `app/` directory and ignores `src/app` when both exist. The legacy live-execution, purchase, Steel, and Sentinel code under `src/` is therefore not built or deployed; its unit tests still run. It is documented in [docs/LEGACY_LIVE_EXECUTION.md](docs/LEGACY_LIVE_EXECUTION.md). Do not move it into `app/` without a deliberate decision and security review.

## Known limitations

- Trader statistics and balances are typed in by you; they are not verified against the exchange.
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
