create table if not exists public.copy_center_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{"traders":[],"savedReviews":[],"portfolioSnapshots":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint copy_center_workspace_payload_is_object check (jsonb_typeof(payload) = 'object')
);
alter table public.copy_center_workspaces enable row level security;
drop policy if exists "Users can read their own copy center workspace" on public.copy_center_workspaces;
create policy "Users can read their own copy center workspace" on public.copy_center_workspaces for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own copy center workspace" on public.copy_center_workspaces;
create policy "Users can insert their own copy center workspace" on public.copy_center_workspaces for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own copy center workspace" on public.copy_center_workspaces;
create policy "Users can update their own copy center workspace" on public.copy_center_workspaces for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all privileges on table public.copy_center_workspaces from anon, authenticated, public;
grant select, insert, update on table public.copy_center_workspaces to authenticated;
