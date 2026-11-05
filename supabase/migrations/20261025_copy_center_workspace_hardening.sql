-- GEM Copy Center: workspace hardening (non-destructive, idempotent).
-- Apply after 20261024_copy_center_workspaces.sql. Does not drop data, tables, or policies.
--
-- 1. Database-level payload size cap, so the 750 KB limit holds even if a client bypasses the API route
--    and talks to PostgREST directly with a user JWT and the public anon key.
-- 2. Server-assigned updated_at, so the timestamp shown during restore cannot be forged by the client.
-- 3. Re-asserts the least-privilege grants from the base migration (no DELETE, no anon access).

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'copy_center_workspace_payload_size'
      and conrelid = 'public.copy_center_workspaces'::regclass
  ) then
    alter table public.copy_center_workspaces
      add constraint copy_center_workspace_payload_size
      check (octet_length(payload::text) <= 1000000) not valid;
  end if;
end $$;

-- Validation only reads existing rows; it fails (without changing anything) if an existing row is too large.
alter table public.copy_center_workspaces validate constraint copy_center_workspace_payload_size;

create or replace function public.copy_center_workspaces_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.copy_center_workspaces_set_updated_at() from public, anon, authenticated;

drop trigger if exists copy_center_workspaces_set_updated_at on public.copy_center_workspaces;
create trigger copy_center_workspaces_set_updated_at
  before insert or update on public.copy_center_workspaces
  for each row execute function public.copy_center_workspaces_set_updated_at();

revoke all privileges on table public.copy_center_workspaces from anon, public;
revoke delete, truncate, references, trigger on table public.copy_center_workspaces from authenticated;
grant select, insert, update on table public.copy_center_workspaces to authenticated;

-- Verification queries (read-only) to run after applying:
--   select relrowsecurity from pg_class where oid = 'public.copy_center_workspaces'::regclass;          -- expect true
--   select policyname, cmd from pg_policies where tablename = 'copy_center_workspaces';                -- expect select/insert/update own-row policies
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name = 'copy_center_workspaces' and grantee in ('anon', 'authenticated');             -- expect authenticated: SELECT, INSERT, UPDATE only
