# Persistent read-only Bitget connection

Stage 1 of real account data. The verified workspace owner can save a read-only Bitget API key. The workspace then shows live balances and positions from Bitget's official API, and the owner can re-verify on demand. Nothing in this path can place orders, follow traders, transfer, deposit or withdraw.

## How it works

| Route (owner only) | What it does |
| --- | --- |
| `GET /api/connections/bitget` | Returns the saved status and last snapshot. No Bitget call and no credential material. |
| `POST /api/connections/bitget` | Checks that `/api/v3/account/info` reports a read-only key with `uta_mgt` and none of `uta_trade`, `withdraw`, `copy_futures_position`, `copy_futures_order`. Then reads balances and positions, encrypts the key, secret and passphrase, and stores them server-side. Rejected keys are never stored. |
| `POST /api/connections/bitget/refresh` | Decrypts the key and re-runs the permission check before any other read. If the key is no longer read-only, it is deleted and the connection is marked `ERROR`. |
| `DELETE /api/connections/bitget` | Deletes the encrypted credential and marks the connection `DISCONNECTED`. Past balance observations are kept. |
| `POST /api/connections/bitget/verify` | One-time check without saving (unchanged behavior). It now uses the same GET-only client. |

- **Bitget client.** `lib/bitget-read-client.ts` can only send `GET` requests to three paths: `account/info`, `account/assets` and `position/current-position`. It only talks to `https://api.bitget.com` and refuses redirects. A test fails if any trading, copy, transfer or withdrawal path appears in the connection code.
- **Encryption.** `lib/connection-secrets.ts` uses AES-256-GCM with a random IV on every encryption. Each stored value is bound to the owner, connection and venue, so it cannot be opened if copied to another account or row.
- **Storage.** `lib/connection-store.ts` writes with the server-only service-role key. Every query is filtered by the verified owner id.
- **Browser.** Credential fields are cleared after every attempt. They are never written to `localStorage`, `sessionStorage` or the cloud workspace, and tests enforce this.
- **Performance history.** Each successful read also records an `official_api` USD equity observation. Saved account evidence and Performance pick it up automatically.

### Positions and the `uta_mgt`-only rule

Bitget may refuse position reads for a key whose only permission is `uta_mgt`; the Sentinel notes position reads need `uta_trade` read access. That permission is deliberately forbidden here. When Bitget refuses, positions show as **unavailable, with the reason**, never as zero. Balances still load.

## Server configuration (Vercel; never in the repository or browser)

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Already set. Must point at the dedicated `gem-copy-center` project after the cutover. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role or secret key of that project. Server-only: never use a `NEXT_PUBLIC_` name. |
| `CONNECTION_SECRETS_KEY` | 32 random bytes, base64. Generate locally with `openssl rand -base64 32` and paste it straight into Vercel. Do not commit it or share it in chat. |
| `CONNECTION_SECRETS_KEY_VERSION` | Optional; defaults to `1`. |
| `CONNECTION_SECRETS_PREVIOUS_KEY` / `_VERSION` | Only during key rotation (see below). |

Until these variables are set, the routes return `503 connection_storage_not_configured`, listing the missing variable names only. The workspace then says that no balances are shown.

**Key rotation:**
1. Move the current key and version into `CONNECTION_SECRETS_PREVIOUS_KEY` and `CONNECTION_SECRETS_PREVIOUS_KEY_VERSION`.
2. Set a new `CONNECTION_SECRETS_KEY` and a higher `CONNECTION_SECRETS_KEY_VERSION`.
3. Each refresh re-encrypts the stored credential with the new key.
4. Remove the previous key once every connection has been refreshed.

**Losing the key** makes stored credentials unreadable. The connection then reports `credentials_unreadable`, and the owner must save the Bitget key again.

## Database

Migration: `supabase/migrations/20261110_gem_copy_connection_secrets.sql`. It requires `20261107_gem_copy_sentinel_ledger.sql`.

What it creates:
- **`gem_copy_connection_secrets`:** RLS is enabled and forced, with no policies. `anon` and `authenticated` have no privileges; only `service_role` has access. A format check accepts only sealed `gcs1.` values. The table references `gem_copy_connections(user_id, id)` with `on delete cascade`.
- **`gem_copy_connections`:** gains `last_snapshot` (an owner-readable object, max 200 KB) and `last_error_code`. Updates set `updated_at` on the server. There is a unique index per owner, venue and account reference.

Local acceptance (disposable PostgreSQL 16, no network listener, no hosted database): `bash scripts/test-connection-secrets-migration.sh`. It checks that:
- both migrations apply, and the new one can be applied twice;
- plaintext secrets are rejected;
- one owner's secret cannot point at another owner's connection;
- the owner can read their own snapshot but not any sealed secret, and cannot write;
- `anon` has no access.

**Hosted apply (after the Vercel keys are in place, see `AGENT_SERVER_KEYS_SETUP.md`):** `20261024`, `20261025` and `20261107` are already applied to `gem-copy-center` (see `CHATGPT_WORKSPACE_HANDOFF.md`). Apply only `20261110` there, to no other project. Then confirm read-only that RLS is on for both tables and that `gem_copy_connection_secrets` has no `anon` or `authenticated` grants.
