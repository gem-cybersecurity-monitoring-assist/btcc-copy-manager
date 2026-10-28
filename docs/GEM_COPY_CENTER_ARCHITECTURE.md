# GEM Copy Center — architecture and validation

## Product direction

The active Next.js routing directory is the repository-root `app/` folder; the legacy `src/app/` folder is not used for routing because the root `app/` directory takes precedence. The default page is the phone-first multi-provider workspace. The existing copy-trading engine remains available at `/copy-trading`, and advanced BTCC tools remain at `/advanced-btcc`.

## Current UI capabilities

- Provider inventory: BTCC and Bitget exchanges; Phantom and MetaMask wallets; Base network; Farcaster identity; MetaTrader 5 terminal.
- Phantom and MetaMask wallet account access, plus Base mainnet selection and account verification. Only public addresses are read. No signature, token approval, transaction, or withdrawal is requested.
- Bitget one-time read-only account-assets verification through `POST /api/connections/bitget/verify`. The user must be signed in. API key, secret, and passphrase are held in request memory only, are not logged or persisted, and are cleared from the UI after the request. This does not provide recurring account sync.
- BTCC remains a guided native workflow. This repository does not claim a verified read-only BTCC API adapter; copy activation stays in BTCC's own interface.
- Local allocation and loss planning, browser activity history, provider status labels, responsive navigation, and an explicit reset confirmation.
- Authenticated Supabase sign-up, sign-in, resend-confirmation, session refresh, and logout through server routes. The browser receives HttpOnly session cookies rather than access/refresh tokens in JSON.
- Explicit Save to cloud and Restore cloud data actions. Only the validated `copyCenter` planning preferences and activity list are synced by this UI; wallet session addresses and exchange credentials are not uploaded.

## Cloud data and authorization

The cloud workspace uses `public.copy_center_workspaces`. The table has RLS enabled, with authenticated owner-only SELECT, INSERT, and UPDATE policies that compare `user_id` with `auth.uid()`. The server verifies the Supabase session, derives the row owner from the verified user ID, and validates the entire workspace payload before saving. No service-role key is used by the cloud service.

The `Workspace` model accepts an optional validated `copyCenter` object for the new UI's budget, loss threshold, and up to 50 activity records. Saving merges this object into the existing cloud payload, preserving trader records, portfolio snapshots, and engine state.

A live authenticated save/restore test still requires the owner to sign into the deployed app with an account they control. Automated tests cover session guards, owner scoping, malformed payload rejection, and RLS denial handling.

## Security boundaries

- The friendly workspace does not initiate trades.
- The Bitget endpoint only calls the read-only account-assets endpoint. It never calls order, transfer, or withdrawal endpoints.
- Bitget keys must be read-only, with no trade or withdrawal permissions. Recurring sync is intentionally unavailable until a separate, reviewed encrypted credential-storage design exists.
- No BTCC credential adapter is enabled until BTCC confirms a supported read-only API is available.
- Wallet addresses are public data, but still treated as user data. Wallet connections are re-verified against the currently injected wallet session after reload.
- Do not store passwords, exchange secrets, passphrases, seed phrases, or private keys in localStorage, cloud workspace JSON, logs, or support messages.
- The existing `/advanced-btcc` route contains live futures order controls and must remain separately reviewed. Do not enable live execution based on this UI rebuild.

## Validation record

- GitHub Actions `pnpm check` passed on commit `b39de7e643ad0571db4cfed61a35eb6fe1cf6c84`: TypeScript, 99 tests, and production build.
- Manual Vercel preview build completed successfully and emitted the home, copy-trading, advanced BTCC, workspace, auth, agent, and Bitget verification routes.
- Preview HTTP checks returned 200 for `/`, `/copy-trading`, and `/advanced-btcc`; an unknown route returned 404. `/api/auth/session` reported `configured: true` and `authenticated: false` for the unsigned test request. GET requests to POST-only auth/verification endpoints returned 405.
- Production deployment for the same commit reached READY and Vercel assigned `btcc-copy-manager.vercel.app` as an alias.
- The automatic Vercel Git checks remain blocked by the `github-private-org-to-hobby` integration restriction; the manual deployment completed.
- Supabase's security advisor reports that platform-level leaked-password protection is disabled. The app enforces a 12-character minimum, but enabling HaveIBeenPwned protection is a project-plan/configuration decision and was not changed here.

## Remaining owner-side checks

1. Sign in to production with an owner-controlled account and perform Save to cloud, refresh, then Restore cloud data.
2. If desired, verify Bitget with a user-owned read-only API key. Do not use a trading-enabled key; no key was supplied during automated testing.
3. Confirm current BTCC API availability with BTCC before implementing any credential-based adapter.
4. Consider enabling Supabase leaked-password protection if the project's plan supports it.
5. Keep all live-money execution and withdrawal permissions disabled until separately approved and tested.
