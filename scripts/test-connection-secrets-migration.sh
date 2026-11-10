#!/usr/bin/env bash
# Isolated acceptance for the connection-secrets migration on a disposable
# PostgreSQL cluster. No hosted database, credentials, or published ports.
#
# Server selection, in order:
#   1. PG_BIN, if set (directory containing initdb/pg_ctl).
#   2. The newest local /usr/lib/postgresql/<version>/bin with initdb, or `pg_config --bindir`.
#   3. Docker, using the same pinned postgres:16 image as test-sentinel-ledger.sh
#      (with --network none).
# When run as root with local binaries, the cluster runs as the "postgres" OS user.
set -euo pipefail
root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
image="postgres:16-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139"

find_pg_bin() {
  if [[ -n "${PG_BIN:-}" && -x "$PG_BIN/initdb" ]]; then echo "$PG_BIN"; return; fi
  local candidate
  candidate="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
  if [[ -n "$candidate" && -x "$candidate/initdb" ]]; then echo "$candidate"; return; fi
  if command -v pg_config >/dev/null 2>&1; then
    candidate="$(pg_config --bindir 2>/dev/null || true)"
    if [[ -n "$candidate" && -x "$candidate/initdb" ]]; then echo "$candidate"; return; fi
  fi
  echo ""
}

bootstrap_sql() {
  cat <<'SQL'
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
}

run_suite() {
  # $1 is a command prefix that runs psql against the disposable server.
  local psql_cmd="$1"
  bootstrap_sql | $psql_cmd
  for migration in 20261107_gem_copy_sentinel_ledger.sql 20261110_gem_copy_connection_secrets.sql; do
    $psql_cmd < "$root/supabase/migrations/$migration"
  done
  # Idempotency: applying the new migration twice must succeed.
  $psql_cmd < "$root/supabase/migrations/20261110_gem_copy_connection_secrets.sql"
  $psql_cmd < "$root/supabase/tests/connection-secrets.sql"
}

pg_bin="$(find_pg_bin)"
if [[ -n "$pg_bin" ]]; then
  echo "Using local PostgreSQL binaries: $pg_bin"
  work="$(mktemp -d)"
  chmod 755 "$work"
  run() { if [[ "$(id -u)" == 0 ]]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
  if [[ "$(id -u)" == 0 ]]; then chown postgres "$work"; fi
  cleanup() { run "'$pg_bin/pg_ctl' -D '$work/data' -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$work"; }
  trap cleanup EXIT
  run "'$pg_bin/initdb' -D '$work/data' -A trust -U postgres" >/dev/null
  run "'$pg_bin/pg_ctl' -D '$work/data' -o \"-c listen_addresses='' -k '$work'\" -l '$work/log' -w start" >/dev/null
  psql_bin="$pg_bin/psql"; [[ -x "$psql_bin" ]] || psql_bin="psql"
  run_suite "$psql_bin -h $work -U postgres -v ON_ERROR_STOP=1 -q"
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "No local PostgreSQL binaries; using Docker image $image"
  container_id="$(docker run -d --rm --network none -e POSTGRES_HOST_AUTH_METHOD=trust "$image")"
  trap 'docker rm -f "$container_id" >/dev/null 2>&1 || true' EXIT
  ready=false
  for attempt in {1..30}; do
    if docker exec "$container_id" pg_isready -h 127.0.0.1 -U postgres -q; then ready=true; break; fi
    sleep 1
  done
  if [[ "$ready" != true ]]; then echo "Disposable PostgreSQL did not become ready." >&2; exit 1; fi
  run_suite "docker exec -i $container_id psql -U postgres -v ON_ERROR_STOP=1 -q"
else
  echo "No PostgreSQL binaries and no usable Docker daemon found; set PG_BIN." >&2
  exit 1
fi
