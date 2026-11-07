-- Disposable PostgreSQL test only. No exchange or hosted Supabase calls.
create schema test_support;
grant usage on schema test_support to anon, authenticated, service_role;
create function test_support.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end $$;
create function test_support.rejects(statement text, expected_state text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE % but statement succeeded: %', expected_state, statement;
end $$;
grant execute on all functions in schema test_support to anon, authenticated, service_role;
insert into auth.users(id) values
('11111111-1111-4111-8111-111111111111'),
('22222222-2222-4222-8222-222222222222');
set role service_role;
insert into public.gem_copy_connections(id,user_id,venue,credential_vault_ref) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','bitget','vault:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','gate',null);
insert into public.gem_copy_account_snapshots(user_id,connection_id,captured_at,source_kind,equity_quote,quote_currency,snapshot_hash)
select user_id,id,now(),'official_api',10,'USDT',repeat('a',64) from public.gem_copy_connections;
insert into public.gem_copy_trader_observations(user_id,venue,source_kind,observed_at)
select user_id,venue,'third_party',now() from public.gem_copy_connections;
insert into public.gem_copy_monitor_runs(user_id,run_key)
select user_id,'test-run-001' from public.gem_copy_connections;
insert into public.gem_copy_execution_actions(user_id,connection_id,action_kind,idempotency_key,action_payload_hash)
select user_id,id,'PAUSE','test-action-00001',repeat('a',64) from public.gem_copy_connections;
insert into public.gem_copy_audit_events(user_id,event_key,event_kind)
select user_id,'test-event-00001','test' from public.gem_copy_connections;
select test_support.rejects($q$insert into public.gem_copy_connections(user_id,venue,credential_vault_ref)
values ('11111111-1111-4111-8111-111111111111','bitget','not-a-vault-reference')$q$, '23514');
select test_support.rejects($q$insert into public.gem_copy_account_snapshots(user_id,connection_id,captured_at,source_kind,quote_currency,snapshot_hash)
values ('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),'official_api','USDT',repeat('b',64))$q$, '23503');
select test_support.rejects($q$insert into public.gem_copy_account_snapshots(user_id,connection_id,captured_at,source_kind,quote_currency,snapshot_hash)
values ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),'official_api','USDT',repeat('a',64))$q$, '23505');
select test_support.rejects($q$update public.gem_copy_account_snapshots set equity_quote='NaN'::numeric$q$, '23514');
select test_support.rejects($q$update public.gem_copy_account_snapshots set realized_pnl_quote='NaN'::numeric$q$, '23514');
select test_support.rejects($q$update public.gem_copy_trader_observations set native_id_verified=true$q$, '23514');
select test_support.rejects($q$update public.gem_copy_execution_actions set action_status='EXECUTED',executed_at=now()$q$, '23514');
select test_support.rejects($q$insert into public.gem_copy_execution_actions(user_id,action_kind,idempotency_key,action_payload_hash)
values ('11111111-1111-4111-8111-111111111111','PAUSE','test-action-00001',repeat('b',64))$q$, '23505');
select test_support.rejects($q$insert into public.gem_copy_monitor_runs(user_id,run_key)
values ('11111111-1111-4111-8111-111111111111','test-run-001')$q$, '23505');
select test_support.rejects('update public.gem_copy_audit_events set event_kind=''changed''', '42501');
select test_support.rejects('delete from public.gem_copy_audit_events', '42501');
select test_support.rejects('truncate public.gem_copy_audit_events', '42501');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$
declare t text; own_count integer; other_count integer;
begin
  foreach t in array array['gem_copy_connections','gem_copy_account_snapshots','gem_copy_trader_observations','gem_copy_monitor_runs','gem_copy_execution_actions','gem_copy_audit_events'] loop
    execute format('select count(*) from public.%I', t) into own_count;
    execute format('select count(*) from public.%I where user_id <> auth.uid()', t) into other_count;
    perform test_support.assert_true(own_count=1 and other_count=0, t || ': owner A isolation');
    perform test_support.rejects(format('delete from public.%I',t), '42501');
    perform test_support.rejects(format('update public.%I set user_id=''22222222-2222-4222-8222-222222222222''',t), '42501');
    perform test_support.rejects(format('insert into public.%I default values',t), '42501');
  end loop;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$
declare t text; own_count integer; other_count integer;
begin
  foreach t in array array['gem_copy_connections','gem_copy_account_snapshots','gem_copy_trader_observations','gem_copy_monitor_runs','gem_copy_execution_actions','gem_copy_audit_events'] loop
    execute format('select count(*) from public.%I',t) into own_count;
    execute format('select count(*) from public.%I where user_id <> auth.uid()',t) into other_count;
    perform test_support.assert_true(own_count=1 and other_count=0, t || ': owner B isolation');
  end loop;
end $$;
reset role;
set role anon;
do $$
declare t text;
begin
  foreach t in array array['gem_copy_connections','gem_copy_account_snapshots','gem_copy_trader_observations','gem_copy_monitor_runs','gem_copy_execution_actions','gem_copy_audit_events'] loop
    perform test_support.rejects(format('select * from public.%I',t),'42501');
  end loop;
end $$;
reset role;
select 'PASS: migration, RLS, both owners, anonymous rejection, client write denial, audit immutability, deduplication, approval and data constraints';
