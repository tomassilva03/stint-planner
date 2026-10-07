-- Stint Planner database. Run once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Plans are stored whole as JSON. Owners can share a plan with teammates by email as editor or viewer.

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_email text not null default (auth.jwt() ->> 'email'),
  name text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists public.plan_members (
  plan_id uuid not null references public.plans (id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('editor', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (plan_id, email)
);

create index if not exists plan_members_email on public.plan_members (email);

-- Helpers run with the table owner's rights so the policies below don't recurse into each other.
create or replace function public.my_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.plan_role(pid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from plans where id = pid and owner_id = auth.uid()) then 'owner'
    else (select role from plan_members where plan_id = pid and email = public.my_email())
  end
$$;

-- Keep updated_at / updated_by honest, and stop anyone moving a plan to another owner.
create or replace function public.plans_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.owner_id := old.owner_id;
    new.owner_email := old.owner_email;
  end if;
  return new;
end
$$;

drop trigger if exists plans_touch on public.plans;
create trigger plans_touch before insert or update on public.plans
for each row execute function public.plans_touch();

grant select, insert, update, delete on public.plans, public.plan_members to authenticated;

alter table public.plans enable row level security;
alter table public.plan_members enable row level security;

drop policy if exists "read own or shared plans" on public.plans;
-- owner_id is checked directly so a new plan can be read back by the insert that creates it
-- (plan_role can't see a row its own statement is inserting).
create policy "read own or shared plans" on public.plans for select
  using (owner_id = auth.uid() or public.plan_role(id) is not null);

drop policy if exists "create own plans" on public.plans;
create policy "create own plans" on public.plans for insert
  with check (owner_id = auth.uid());

drop policy if exists "owners and editors update" on public.plans;
create policy "owners and editors update" on public.plans for update
  using (public.plan_role(id) in ('owner', 'editor'));

drop policy if exists "owners delete" on public.plans;
create policy "owners delete" on public.plans for delete
  using (owner_id = auth.uid());

drop policy if exists "see members of my plans" on public.plan_members;
create policy "see members of my plans" on public.plan_members for select
  using (public.plan_role(plan_id) is not null);

drop policy if exists "owners manage members" on public.plan_members;
create policy "owners manage members" on public.plan_members for all
  using (public.plan_role(plan_id) = 'owner')
  with check (public.plan_role(plan_id) = 'owner');

drop policy if exists "members can leave" on public.plan_members;
create policy "members can leave" on public.plan_members for delete
  using (email = public.my_email());

-- Live updates for teammates watching the same plan
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'plans') then
    alter publication supabase_realtime add table public.plans;
  end if;
end
$$;
