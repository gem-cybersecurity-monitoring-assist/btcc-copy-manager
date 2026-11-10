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
