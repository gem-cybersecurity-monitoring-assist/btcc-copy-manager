import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261110_gem_copy_connection_secrets.sql"), "utf8");

test("sealed credentials table is server-only: RLS forced, no browser grants or policies", () => {
  assert.match(migration, /create table if not exists public\.gem_copy_connection_secrets/);
  assert.match(migration, /alter table public\.gem_copy_connection_secrets enable row level security/);
  assert.match(migration, /alter table public\.gem_copy_connection_secrets force row level security/);
  assert.match(migration, /revoke all on public\.gem_copy_connection_secrets from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select, insert, update, delete on public\.gem_copy_connection_secrets to service_role/);
  assert.doesNotMatch(migration, /create policy[^;]*gem_copy_connection_secrets/i);
  assert.doesNotMatch(migration, /grant[^;]*gem_copy_connection_secrets[^;]*to[^;]*(anon|authenticated)/i);
});

test("only sealed values can be stored and secrets follow the owner's connection", () => {
  assert.match(migration, /gem_copy_connection_secret_sealed/);
  assert.match(migration, /\^gcs1\\\./);
  assert.match(migration, /references public\.gem_copy_connections\(user_id, id\) on delete cascade/);
});

test("connections remain owner read-only and snapshots are bounded", () => {
  assert.match(migration, /revoke insert, update, delete, truncate on public\.gem_copy_connections from anon, authenticated/);
  assert.match(migration, /octet_length\(last_snapshot::text\) <= 200000/);
  assert.doesNotMatch(migration, /\bdrop table\b/i);
});
