-- Run this once in Supabase SQL Editor before using the Excel import button.

alter table public.tickets
  add column if not exists resolved_at timestamptz;

-- Developers in the historical workbook include names outside the old fixed list.
-- Keep the value required when provided, but allow any non-blank developer name.
alter table public.tickets
  drop constraint if exists tickets_developer_check;

alter table public.tickets
  add constraint tickets_developer_check
  check (developer is null or btrim(developer) <> '');

-- Shared developer roster. All signed-in users can read it; only the ticket
-- administrator can add, rename, or remove names.
create table if not exists public.developers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

alter table public.developers enable row level security;
grant select, insert, update, delete on public.developers to authenticated;

drop policy if exists "Authenticated users can read developers"
  on public.developers;
create policy "Authenticated users can read developers"
  on public.developers for select to authenticated
  using (true);

drop policy if exists "Ticket admin can add developers"
  on public.developers;
create policy "Ticket admin can add developers"
  on public.developers for insert to authenticated
  with check (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'ncgtc.support@infoneo.in'
  );

drop policy if exists "Ticket admin can update developers"
  on public.developers;
create policy "Ticket admin can update developers"
  on public.developers for update to authenticated
  using (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'ncgtc.support@infoneo.in'
  )
  with check (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'ncgtc.support@infoneo.in'
  );

drop policy if exists "Ticket admin can remove developers"
  on public.developers;
create policy "Ticket admin can remove developers"
  on public.developers for delete to authenticated
  using (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'ncgtc.support@infoneo.in'
  );

insert into public.developers (name)
values
  ('Rahul giri'),
  ('Aniruddha Sharma'),
  ('Sachin'),
  ('Peeyush'),
  ('Pulkit'),
  ('Jatin'),
  ('Somesh'),
  ('Hina'),
  ('Ashish'),
  ('Asif')
on conflict (name) do nothing;

insert into public.developers (name)
select distinct btrim(tickets.developer)
from public.tickets as tickets
where tickets.developer is not null
  and btrim(tickets.developer) <> ''
on conflict (name) do nothing;

create or replace function public.admin_update_ticket_times(
  p_ticket_id text,
  p_assigned_at timestamptz,
  p_resolved_at timestamptz,
  p_sla_due_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'ncgtc.support@infoneo.in' then
    raise exception 'Only the ticket administrator can update ticket times.'
      using errcode = '42501';
  end if;

  if p_assigned_at is null then
    raise exception 'Assigned time is required.'
      using errcode = '22023';
  end if;

  if p_resolved_at is null and exists (
    select 1
    from public.tickets as ticket
    where ticket.id = p_ticket_id
      and ticket.status = 'Resolved'
  ) then
    raise exception 'Resolved time is required for a resolved ticket.'
      using errcode = '22023';
  end if;

  update public.tickets as ticket
  set assigned_at = p_assigned_at,
      resolved_at = case
        when ticket.status = 'Resolved' then p_resolved_at
        else null
      end,
      sla_due_at = coalesce(p_sla_due_at, ticket.sla_due_at)
  where ticket.id = p_ticket_id;

  if not found then
    raise exception 'Ticket % was not found.', p_ticket_id
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_update_ticket_times(text, timestamptz, timestamptz, timestamptz) from public;
revoke all on function public.admin_update_ticket_times(text, timestamptz, timestamptz, timestamptz) from anon;
grant execute on function public.admin_update_ticket_times(text, timestamptz, timestamptz, timestamptz) to authenticated;

create or replace function public.admin_import_tickets(p_tickets jsonb)
returns table(ticket_id text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tickets is null or jsonb_typeof(p_tickets) <> 'array' then
    raise exception 'The ticket import must be a JSON array.'
      using errcode = '22023';
  end if;

  return query
  with input_rows as (
    select *
    from jsonb_to_recordset(p_tickets) as rows(
      id text,
      title text,
      priority text,
      status text,
      scheme text,
      developer text,
      assigned_at timestamptz,
      sla_due_at timestamptz,
      resolved_at timestamptz,
      on_hold_started_at timestamptz
    )
  ),
  inserted_tickets as (
    insert into public.tickets (
      id,
      title,
      priority,
      status,
      scheme,
      developer,
      assigned_at,
      sla_due_at,
      resolved_at,
      on_hold_started_at
    )
    select
      input_rows.id,
      input_rows.title,
      input_rows.priority,
      input_rows.status,
      input_rows.scheme,
      input_rows.developer,
      input_rows.assigned_at,
      input_rows.sla_due_at,
      input_rows.resolved_at,
      input_rows.on_hold_started_at
    from input_rows
    where input_rows.id is not null
      and input_rows.title is not null
      and input_rows.priority in ('P1', 'P2', 'P3', 'P4')
      and input_rows.status in ('Open', 'In Progress', 'On Hold', 'Business Pending', 'Resolved')
      and input_rows.assigned_at is not null
      and input_rows.sla_due_at is not null
    on conflict (id) do nothing
    returning id, developer, assigned_at
  ),
  inserted_assignment_history as (
    insert into public.ticket_assignment_history as history (
      ticket_id,
      developer,
      assigned_at
    )
    select id, developer, assigned_at
    from inserted_tickets
    returning history.ticket_id
  )
  select inserted_tickets.id
  from inserted_tickets;
end;
$$;

revoke all on function public.admin_import_tickets(jsonb) from public;
revoke all on function public.admin_import_tickets(jsonb) from anon;
grant execute on function public.admin_import_tickets(jsonb) to authenticated;
