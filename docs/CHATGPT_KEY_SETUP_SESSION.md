# ChatGPT work session: finish read-only connection setup (gem-copy-center)

Paste this whole document into a ChatGPT agent session that has a browser and is signed in to **Supabase** (support371 organization) and **Vercel** (team `admin-25521151s-projects`). It is self-contained.

---

## Your task

Finish the server setup for PR #93 of `btcc-copy-manager` (read-only exchange connections). Do exactly three things:

1. Run one database migration on Supabase project **gem-copy-center** (`najhqvsxwbpvadoueced`).
2. Copy that project's **secret** API key into Vercel as `SUPABASE_SERVICE_ROLE_KEY`, with scope **Preview, branch `claude/copy-center-real-accounts-1jsir9` only**.
3. Create a random encryption key in Vercel as `CONNECTION_SECRETS_KEY`, with the same scope.

Then report back, using only the report format at the end.

## Rules you must follow

- **Never reveal a secret.**
  - Do not print, type into chat, summarise, screenshot or save any key value.
  - Do not reveal or "show" a key in Vercel after saving it.
  - If a value appears on screen, do not repeat it.
- **Never use a `NEXT_PUBLIC_` name** for these variables.
- **Do not change Production.** Production still uses another database (`crypto-signal-bot`, `pxcahgcoeewvkhsdvylu`). Do not touch that project.
- **Do not change** any other Vercel variable, branch or project. Do not touch any exchange, trading, payment, deposit or withdrawal setting.
- **Do not create, rotate, reset or revoke** Supabase keys.
- **Stop and report instead of improvising** if a screen, project ID or result differs from this document, if anything asks for payment, or if an error appears.

## Step 1: Run the database migration

1. Go to https://supabase.com/dashboard, choose organization **support371**, then project **gem-copy-center**.
2. **Check:** the URL must contain `najhqvsxwbpvadoueced`. If it contains anything else, stop.
3. In the left sidebar, open **SQL Editor** → **New query**.
4. Paste the SQL below exactly, from `begin;` to `commit;`, and click **Run**.
   - Expected result: *Success. No rows returned.*
   - The migration is safe to run twice. It deletes no data.
   - If you get an error, stop and report the error text. Nothing is partially applied, because the migration is one transaction.

```sql
-- GEM Copy Center: persistent read-only exchange connections.
-- Apply after 20261107_gem_copy_sentinel_ledger.sql. Non-destructive and idempotent.
--
-- 1. gem_copy_connection_secrets holds AES-256-GCM sealed credentials produced by
--    the server (lib/connection-secrets.ts). The encryption key lives only in the
--    server environment. The database never sees plaintext, and the format check
--    rejects anything that is not a sealed value (e.g. raw JSON or an API key).
--    Browser roles (anon, authenticated) have no privileges and no policies, so
--    even a signed-in owner cannot read the ciphertext through PostgREST.
-- 2. gem_copy_connections gains the last read-only snapshot (balances/positions)
--    and a short error code, readable by the owner through the existing RLS policy.
-- 3. Disconnecting deletes the sealed secret and marks the connection
--    DISCONNECTED; saved snapshot history is preserved.

begin;

alter table public.gem_copy_connections
  add column if not exists last_snapshot jsonb,
  add column if not exists last_error_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gem_copy_connection_snapshot_shape'
                 and conrelid = 'public.gem_copy_connections'::regclass) then
    alter table public.gem_copy_connections add constraint gem_copy_connection_snapshot_shape
      check (last_snapshot is null or (jsonb_typeof(last_snapshot) = 'object' and octet_length(last_snapshot::text) <= 200000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gem_copy_connection_error_code'
                 and conrelid = 'public.gem_copy_connections'::regclass) then
    alter table public.gem_copy_connections add constraint gem_copy_connection_error_code
      check (last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{0,63}$');
  end if;
end $$;

-- One connection row per owner, venue and external account reference.
create unique index if not exists gem_copy_connections_owner_venue_account_idx
  on public.gem_copy_connections(user_id, venue, coalesce(external_account_ref, ''));

create table if not exists public.gem_copy_connection_secrets (
  connection_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  venue text not null check (venue in ('bitget','btcc','gate','mt5','other')),
  key_version integer not null check (key_version between 1 and 1000),
  sealed_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gem_copy_connection_secret_sealed check (
    length(sealed_secret) between 40 and 8192
    and sealed_secret ~ '^gcs1\.[0-9]{1,4}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$'
  ),
  foreign key (user_id, connection_id)
    references public.gem_copy_connections(user_id, id) on delete cascade
);

create or replace function public.gem_copy_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.gem_copy_set_updated_at() from public, anon, authenticated;

drop trigger if exists gem_copy_connections_set_updated_at on public.gem_copy_connections;
create trigger gem_copy_connections_set_updated_at
  before update on public.gem_copy_connections
  for each row execute function public.gem_copy_set_updated_at();

drop trigger if exists gem_copy_connection_secrets_set_updated_at on public.gem_copy_connection_secrets;
create trigger gem_copy_connection_secrets_set_updated_at
  before update on public.gem_copy_connection_secrets
  for each row execute function public.gem_copy_set_updated_at();

alter table public.gem_copy_connection_secrets enable row level security;
alter table public.gem_copy_connection_secrets force row level security;
revoke all on public.gem_copy_connection_secrets from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.gem_copy_connection_secrets to service_role;
-- Intentionally no policies: browser roles cannot reach sealed credentials.

-- Re-assert the owner-read-only posture of the connections table.
revoke insert, update, delete, truncate on public.gem_copy_connections from anon, authenticated;

commit;
```

5. Open another **New query**, run this read-only check, and note the row:

```sql
select
  (select relrowsecurity and relforcerowsecurity from pg_class
     where oid = 'public.gem_copy_connection_secrets'::regclass)            as secrets_rls_forced,
  (select count(*) from pg_policies
     where tablename = 'gem_copy_connection_secrets')                      as secrets_policies,
  (select count(*) from information_schema.role_table_grants
     where table_name = 'gem_copy_connection_secrets'
       and grantee in ('anon','authenticated'))                            as browser_grants,
  (select count(*) from information_schema.columns
     where table_name = 'gem_copy_connections'
       and column_name in ('last_snapshot','last_error_code'))             as new_columns;
```

Expected: `secrets_rls_forced = true`, `secrets_policies = 0`, `browser_grants = 0`, `new_columns = 2`.

## Step 2: Copy the Supabase secret key into Vercel

1. In the same Supabase project (`najhqvsxwbpvadoueced`), go to **Project Settings → API Keys**.
2. Copy the **secret** key, using the copy button.
   - Use the `sb_secret_…` key if it exists; otherwise use the legacy **service_role** key.
   - Never use the publishable/anon key for this step.
   - Do not reveal the key in chat.
3. Go to https://vercel.com → team **admin-25521151s-projects** → project **btcc-copy-manager** → **Settings → Environment Variables** → **Add**.
4. Fill in the form:
   - **Key:** `SUPABASE_SERVICE_ROLE_KEY`
   - **Value:** paste the copied secret key
   - **Environments:** tick **Preview only**. Untick Production and Development.
   - **Git branch:** `claude/copy-center-real-accounts-1jsir9`
   - **Sensitive:** on
5. Click **Save**.

## Step 3: Create the encryption key in Vercel

The key must be 32 random bytes in base64. Generate it so it never appears on screen:

1. In a browser tab, open the developer console (F12 or Ctrl+Shift+J, then the **Console** tab).
2. Run this. It copies a new random key to the clipboard without displaying it:
   ```js
   copy(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))
   ```
   If `copy` is unavailable, stop and ask the owner to generate the key with `openssl rand -base64 32` on their own computer and paste it into Vercel themselves.
3. In Vercel **Environment Variables**, click **Add** and fill in:
   - **Key:** `CONNECTION_SECRETS_KEY`
   - **Value:** paste from the clipboard
   - **Environments:** **Preview only**
   - **Git branch:** `claude/copy-center-real-accounts-1jsir9`
   - **Sensitive:** on
4. Click **Save**, then clear the clipboard by copying some harmless text.
5. Do **not** add `CONNECTION_SECRETS_KEY_VERSION`.

## Step 4: Redeploy and confirm (names only)

1. Vercel → **btcc-copy-manager** → **Deployments**. Open the newest deployment of branch `claude/copy-center-real-accounts-1jsir9` → **⋯ → Redeploy**. Do not change any options.
2. Wait until the status shows **Ready**.
3. In **Settings → Environment Variables**, filter to **Preview** and branch `claude/copy-center-real-accounts-1jsir9`. Confirm by **name only** that these exist:
   - `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `COPY_CENTER_OWNER_USER_ID`, `TRADING_MODE`, `BTCC_LIVE_EXECUTION` (already added earlier)
   - `SUPABASE_SERVICE_ROLE_KEY` and `CONNECTION_SECRETS_KEY` (added by you)
4. Confirm the **Production** variables were not changed.

## Report back (copy this format; no secret values)

```
Migration 20261110 on najhqvsxwbpvadoueced: SUCCESS / ERROR (<error text>)
Check row: secrets_rls_forced=<…> secrets_policies=<…> browser_grants=<…> new_columns=<…>
Vercel Preview · claude/copy-center-real-accounts-1jsir9:
  SUPABASE_SERVICE_ROLE_KEY added (Sensitive): yes/no
  CONNECTION_SECRETS_KEY added (Sensitive): yes/no
Redeploy: <deployment id or URL> — Ready / Error
Production variables changed: no
Secret values displayed or stored anywhere else: no
Anything unexpected: <none / details>
```

The owner gives this report to the coding agent (Claude Code, PR #93). The coding agent then verifies the preview end to end.
