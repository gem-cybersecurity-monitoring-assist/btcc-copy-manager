#!/usr/bin/env bash
# Isolated schema acceptance. No hosted database, credentials, or published ports.
set -euo pipefail
root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
migration="$root/supabase/migrations/20261107_gem_copy_sentinel_ledger.sql"
if [[ $# -gt 0 ]]; then migration="$1"; fi
image="postgres:16-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139"
container_id="$(docker run -d --rm --network none -e POSTGRES_HOST_AUTH_METHOD=trust "$image")"
trap 'docker rm -f "$container_id" >/dev/null 2>&1 || true' EXIT
ready=false
for attempt in {1..30}; do
  # The entrypoint temporarily serves a Unix socket during init, then stops it.
  # Wait for the final TCP listener to avoid accepting that transient server.
  if docker exec "$container_id" pg_isready -h 127.0.0.1 -U postgres -q; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo "Disposable PostgreSQL did not become ready." >&2; exit 1; fi
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
-- Reproduce Supabase-like permissive defaults to test the explicit privilege reset.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
SQL
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 -q < "$migration"
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 -q < "$migration"
docker exec -i "$container_id" psql -U postgres -v ON_ERROR_STOP=1 -q < "$root/supabase/tests/sentinel-ledger.sql"
