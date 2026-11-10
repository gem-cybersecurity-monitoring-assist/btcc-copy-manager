-- Disposable PostgreSQL test only. No exchange or hosted Supabase calls.
-- Run after 20261107 and 20261110 (see scripts/test-connection-secrets-migration.sh).
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
insert into public.gem_copy_connections(id,user_id,venue,connection_status,external_account_ref,last_snapshot) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','bitget','READ_ONLY','bitget-uta:1','{"balances":{"accountEquityUsd":10}}'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','bitget','READ_ONLY','bitget-uta:2',null);
insert into public.gem_copy_connection_secrets(connection_id,user_id,venue,key_version,sealed_secret) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','bitget',1,
 'gcs1.1.AAAAAAAAAAAAAAAA.' || repeat('Z',40) || '.AAAAAAAAAAAAAAAAAAAAAA');
-- Plaintext or JSON can never be stored as a secret.
select test_support.rejects($q$insert into public.gem_copy_connection_secrets(connection_id,user_id,venue,key_version,sealed_secret)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','bitget',1,'{"apiKey":"bg_live_1234567890abcdefghijklmnop"}')$q$, '23514');
-- A secret cannot point at another owner's connection.
select test_support.rejects($q$insert into public.gem_copy_connection_secrets(connection_id,user_id,venue,key_version,sealed_secret)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','bitget',1,
'gcs1.1.AAAAAAAAAAAAAAAA.' || repeat('Z',40) || '.AAAAAAAAAAAAAAAAAAAAAA')$q$, '23503');
-- One row per owner/venue/account.
select test_support.rejects($q$insert into public.gem_copy_connections(user_id,venue,external_account_ref)
values ('11111111-1111-4111-8111-111111111111','bitget','bitget-uta:1')$q$, '23505');
select test_support.rejects($q$update public.gem_copy_connections set last_error_code='Bad Code!'$q$, '23514');
select test_support.rejects($q$update public.gem_copy_connections set last_snapshot='[]'$q$, '23514');
-- updated_at is server-assigned on update.
update public.gem_copy_connections set updated_at='2000-01-01' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select test_support.assert_true((select updated_at > '2001-01-01' from public.gem_copy_connections where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'updated_at trigger');
reset role;

-- Signed-in owner: sees own connection and snapshot, never any sealed secret, cannot write.
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select test_support.assert_true((select count(*) = 1 from public.gem_copy_connections), 'owner sees exactly own connection');
select test_support.assert_true((select last_snapshot->'balances'->>'accountEquityUsd' = '10' from public.gem_copy_connections), 'owner reads own snapshot');
select test_support.rejects('select * from public.gem_copy_connection_secrets', '42501');
select test_support.rejects($q$update public.gem_copy_connections set connection_status='VERIFIED'$q$, '42501');
select test_support.rejects($q$insert into public.gem_copy_connections(user_id,venue) values ('11111111-1111-4111-8111-111111111111','mt5')$q$, '42501');
select test_support.rejects('delete from public.gem_copy_connections', '42501');
reset role;

set role anon;
select test_support.rejects('select * from public.gem_copy_connection_secrets', '42501');
select test_support.rejects('select * from public.gem_copy_connections', '42501');
reset role;

-- Deleting the connection removes its sealed secret.
set role service_role;
delete from public.gem_copy_connection_secrets where connection_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select test_support.assert_true((select count(*) = 0 from public.gem_copy_connection_secrets), 'secret deleted');
reset role;
select 'connection secrets acceptance passed' as result;
