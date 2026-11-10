#!/usr/bin/env bash
# Isolated acceptance for the connection-secrets migration on a disposable
# PostgreSQL 16 cluster. No hosted database, credentials, or TCP listener.
# Uses local PostgreSQL binaries (PG_BIN, default /usr/lib/postgresql/16/bin).
# When run as root, the cluster runs as the "postgres" OS user.
set -euo pipefail
root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
pg_bin="${PG_BIN:-/usr/lib/postgresql/16/bin}"
work="$(mktemp -d)"
chmod 755 "$work"
run() { if [[ "$(id -u)" == 0 ]]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
if [[ "$(id -u)" == 0 ]]; then chown postgres "$work"; fi
cleanup() { run "'$pg_bin/pg_ctl' -D '$work/data' -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
run "'$pg_bin/initdb' -D '$work/data' -A trust -U postgres" >/dev/null
run "'$pg_bin/pg_ctl' -D '$work/data' -o \"-c listen_addresses='' -k '$work'\" -l '$work/log' -w start" >/dev/null
psql_run() { psql -h "$work" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_run <<'SQL'
create extension if not exists pgcrypto;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
SQL
for migration in 20261107_gem_copy_sentinel_ledger.sql 20261110_gem_copy_connection_secrets.sql; do
  psql_run -f "$root/supabase/migrations/$migration"
done
# Idempotency: applying the new migration twice must succeed.
psql_run -f "$root/supabase/migrations/20261110_gem_copy_connection_secrets.sql"
psql_run -f "$root/supabase/tests/connection-secrets.sql"
