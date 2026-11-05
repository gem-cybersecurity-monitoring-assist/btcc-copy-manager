# GEM Copy Center integration

The Copy Center is available at `/copy-center` alongside the existing BTCC execution control room. It is a separate planning and connection workspace; it does not activate live copy trading.

## Current connection scope

- BTCC: official copy-trading website link only; no unsupported API automation is assumed.
- Bitget: optional one-time account-assets verification, with the API key restricted to the exact read-only UTA permission. Credentials are held only for the request and are not stored.
- Phantom and MetaMask: public wallet-address visibility only. No signatures, approvals, transactions, seed phrases, or private keys.
- Base: network/address check through the connected EVM wallet.
- Farcaster and MetaTrader 5: listed as future integrations, not connected capabilities.

All balances and provider states must be treated as unverified unless the UI explicitly reports a successful verification. Sample and manually entered data are not live account data.

## Local setup

Set `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public anon/publishable key only), and `COPY_CENTER_SITE_URL` in the server environment if cloud accounts and sync are required. Without these values, the page still supports browser-local planning and wallet-address checks; cloud account features report setup required.

Never configure a Supabase service-role key for this feature. The server uses the signed-in user's access token and database row-level security.

## Supabase database

If cloud sync is enabled, apply these migrations in order using the approved Supabase SQL Editor:

1. `supabase/migrations/20261024_copy_center_workspaces.sql`
2. `supabase/migrations/20261025_copy_center_workspace_hardening.sql`

The migrations create one JSON workspace per authenticated user, enforce owner-only row-level security, limit grants to SELECT/INSERT/UPDATE, set the update timestamp server-side, and impose a payload-size constraint. Applying migrations is a separate owner-approved operation; deployment does not run them automatically.

## Safety boundary

- No live order, follow/unfollow, funding transfer, withdrawal, or wallet transaction is exposed by the Copy Center page.
- The existing BTCC live-order tools remain separate and retain their own confirmation and limits.
- Bitget account verification is read-only and does not configure copy-trading permissions.
- Cloud sync stores planning preferences, activity, and public wallet addresses only. It does not store API credentials or wallet secrets.
- A connected wallet address is not proof of asset ownership or permission to transact.
