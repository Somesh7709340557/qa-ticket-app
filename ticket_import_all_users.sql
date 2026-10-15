-- Run this once in Supabase SQL Editor to allow every authenticated app user
-- to import past tickets. Anonymous users remain unable to call this function.

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
