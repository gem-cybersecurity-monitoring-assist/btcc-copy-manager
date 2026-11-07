-- GEM Copy Center private Sentinel ledger: schema only.
-- This migration is intentionally NOT applied to any connected Supabase project.
-- Apply only after a new GEM-specific destination and its owner are verified.
-- The authenticated client may read only its own records; all writes use a
-- trusted server with a verified owner identity. Never store raw exchange keys.

begin;

create table if not exists public.gem_copy_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venue text not null check (venue in ('bitget','btcc','gate','mt5','other')),
  external_account_ref text,
  connection_status text not null default 'DISCONNECTED'
    check (connection_status in ('DISCONNECTED','READ_ONLY','VERIFIED','PAUSED','ERROR')),
  credential_vault_ref text check (credential_vault_ref is null or credential_vault_ref ~ '^vault:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gem_copy_connection_ref_length check (
    length(coalesce(external_account_ref,'')) <= 160
    and length(coalesce(credential_vault_ref,'')) <= 160
  ),
  unique (user_id, id)
);
create index if not exists gem_copy_connections_owner_idx
  on public.gem_copy_connections(user_id, venue);

create table if not exists public.gem_copy_account_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null,
  captured_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  source_kind text not null check (source_kind in ('official_api','manual_attestation')),
  equity_quote numeric(28,8),
  available_quote numeric(28,8),
  realized_pnl_quote numeric(28,8),
  unrealized_pnl_quote numeric(28,8),
  quote_currency text not null check (quote_currency in ('USDT','USD','USDC','EUR')),
  native_snapshot_id text,
  snapshot_hash text not null check (length(snapshot_hash)=64),
  constraint gem_copy_snapshot_finite check (
    (equity_quote is null or (equity_quote >= 0 and equity_quote <> 'NaN'::numeric))
    and (available_quote is null or (available_quote >= 0 and available_quote <> 'NaN'::numeric))
    and (realized_pnl_quote is null or realized_pnl_quote <> 'NaN'::numeric)
    and (unrealized_pnl_quote is null or unrealized_pnl_quote <> 'NaN'::numeric)
  ),
  foreign key (user_id, connection_id)
    references public.gem_copy_connections(user_id, id) on delete cascade,
  unique (user_id, connection_id, snapshot_hash)
);
create index if not exists gem_copy_snapshot_owner_time_idx
  on public.gem_copy_account_snapshots(user_id, captured_at desc);

create table if not exists public.gem_copy_trader_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venue text not null check (venue in ('bitget','btcc','gate','mt5','other')),
  source_kind text not null check (source_kind in ('third_party','official_exchange')),
  aggregator_trader_id text,
  exchange_project_id text,
  native_id_verified boolean not null default false,
  observed_at timestamptz not null,
  metrics jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metrics)='object' and octet_length(metrics::text) <= 16000),
  constraint gem_copy_native_verification check (
    native_id_verified = false or
    (source_kind='official_exchange' and exchange_project_id is not null)
  ),
  constraint gem_copy_observation_id_lengths check (
    length(coalesce(aggregator_trader_id,'')) <= 160 and
    length(coalesce(exchange_project_id,'')) <= 160
  )
);
create index if not exists gem_copy_trader_owner_time_idx
  on public.gem_copy_trader_observations(user_id, observed_at desc);

create table if not exists public.gem_copy_monitor_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_key text not null check (length(run_key) between 1 and 160),
  observed_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'STARTED'
    check (status in ('STARTED','COMPLETED','NO_FRESH_DATA','FAILED')),
  data_age_seconds integer check (data_age_seconds is null or data_age_seconds >= 0),
  critical_alert_count integer not null default 0 check (critical_alert_count >= 0),
  report jsonb not null default '{}'::jsonb
    check (jsonb_typeof(report)='object' and octet_length(report::text) <= 60000),
  unique (user_id, run_key)
);
create index if not exists gem_copy_monitor_owner_time_idx
  on public.gem_copy_monitor_runs(user_id, observed_at desc);

create table if not exists public.gem_copy_execution_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid,
  action_kind text not null
    check (action_kind in ('FOLLOW','UNFOLLOW','MODIFY','CLOSE_POSITION','PAUSE')),
  action_status text not null default 'PROPOSED'
    check (action_status in ('PROPOSED','AWAITING_APPROVAL','APPROVED','EXECUTED','REJECTED','EXPIRED','FAILED')),
  idempotency_key text not null check (length(idempotency_key) between 12 and 200),
  action_payload_hash text not null check (length(action_payload_hash) = 64),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  expires_at timestamptz,
  executed_at timestamptz,
  native_confirmation_ref text,
  failure_code text,
  constraint gem_copy_action_approval_order check (
    approved_at is null or approved_at >= created_at
  ),
  constraint gem_copy_action_no_unapproved_execution check (
    action_status <> 'EXECUTED' or
    (approved_at is not null and executed_at is not null)
  ),
  foreign key (user_id, connection_id)
    references public.gem_copy_connections(user_id, id),
  unique (user_id, idempotency_key)
);
create index if not exists gem_copy_actions_owner_time_idx
  on public.gem_copy_execution_actions(user_id, created_at desc);

create table if not exists public.gem_copy_audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null check (length(event_key) between 8 and 200),
  event_kind text not null check (length(event_kind) between 1 and 100),
  occurred_at timestamptz not null default now(),
  correlation_id uuid,
  safe_detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(safe_detail)='object' and octet_length(safe_detail::text) <= 16000),
  unique (user_id, event_key)
);
create index if not exists gem_copy_audit_owner_time_idx
  on public.gem_copy_audit_events(user_id, occurred_at desc);

-- Every table is private by default. Only the service backend writes financial
-- observations, approvals, execution state, audit records and monitor outcomes.
-- A user session is allowed to SELECT only rows tied to auth.uid().
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'gem_copy_connections', 'gem_copy_account_snapshots',
    'gem_copy_trader_observations', 'gem_copy_monitor_runs',
    'gem_copy_execution_actions', 'gem_copy_audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_owner_read', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name || '_owner_read', table_name
    );
  end loop;
end $$;

-- An append-only audit trail must never offer general mutation privileges.
revoke update, delete on public.gem_copy_audit_events from service_role;

commit;
