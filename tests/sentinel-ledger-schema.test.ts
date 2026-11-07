import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration=readFileSync(
  join(process.cwd(),"supabase/migrations/20261107_gem_copy_sentinel_ledger.sql"),"utf8"
);
const tables=[
  "gem_copy_connections",
  "gem_copy_account_snapshots",
  "gem_copy_trader_observations",
  "gem_copy_monitor_runs",
  "gem_copy_execution_actions",
  "gem_copy_audit_events",
];

test("dedicated Sentinel storage has six owner-scoped tables and explicit RLS",()=>{
  for (const name of tables) {
    assert.ok(migration.includes("create table if not exists public."+name),name);
    assert.ok(migration.includes("'"+name+"'"),name+" must be included in RLS loop");
  }
  assert.match(migration,/enable row level security/);
  assert.match(migration,/for select to authenticated using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(migration,/revoke all on public\.%I from public, anon, authenticated/);
  assert.match(migration,/grant select on public\.%I to authenticated/);
  assert.doesNotMatch(migration,/grant\s+(insert|update|delete|all)\s+on\s+.*to\s+authenticated/i);
});

test("financial actions are deduplicated and require explicit stored approval",()=>{
  assert.match(migration,/unique \(user_id, idempotency_key\)/);
  assert.match(migration,/gem_copy_action_no_unapproved_execution/);
  assert.match(migration,/approved_at is not null and executed_at is not null/);
  assert.match(migration,/gem_copy_native_verification/);
  assert.match(migration,/source_kind='official_exchange'/);
});

test("audit events cannot be updated or deleted by service or browser",()=>{
  assert.match(migration,/revoke update, delete on public\.gem_copy_audit_events from service_role/);
  assert.match(migration,/unique \(user_id, event_key\)/);
});

test("credentials are Vault references instead of arbitrary stored API secrets",()=>{
  assert.match(migration,/credential_vault_ref text check/);
  assert.doesNotMatch(migration,/\b(api_secret|raw_api_key|plaintext_password|private_key)\s+text\b/i);
});
