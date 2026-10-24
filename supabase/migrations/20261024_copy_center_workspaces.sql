create table if not exists public.copy_center_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{"traders":[],"savedReviews":[],"portfolioSnapshots":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint copy_center_workspace_payload_is_object check (jsonb_typeof(payload) = 'object')
);
alter table public.copy_center_workspaces enable row level security;
drop policy if exists "Users can read their own copy center workspace" on public.copy_center_workspaces;
create policy "Users can read their own copy center workspace" on public.copy_center_workspaces for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can insert their own copy center workspace" on public.copy_center_workspaces;
create policy "Users can insert their own copy center workspace" on public.copy_center_workspaces for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update their own copy center workspace" on public.copy_center_workspaces;
create policy "Users can update their own copy center workspace" on public.copy_center_workspaces for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.copy_center_workspaces from anon;
grant select, insert, update on public.copy_center_workspaces to authenticated;
