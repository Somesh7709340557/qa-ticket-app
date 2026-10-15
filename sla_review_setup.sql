-- Run this once in Supabase SQL Editor to enable reviewed SLA billing decisions.
-- All signed-in users can record a review. The original SLA calculation remains unchanged.
alter table public.tickets
  add column if not exists reviewed_sla_override text,
  add column if not exists reviewed_sla_remark text,
  add column if not exists reviewed_sla_at timestamptz,
  add column if not exists reviewed_sla_by text;

alter table public.tickets
  drop constraint if exists tickets_reviewed_sla_override_check;

alter table public.tickets
  add constraint tickets_reviewed_sla_override_check
  check (reviewed_sla_override is null or reviewed_sla_override = 'Within SLA');

grant select (
  reviewed_sla_override,
  reviewed_sla_remark,
  reviewed_sla_at,
  reviewed_sla_by
) on public.tickets to authenticated;

create or replace function public.review_ticket_sla(
  p_ticket_id text,
  p_reviewed_sla_override text,
  p_remark text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remark text := nullif(btrim(p_remark), '');
  v_reviewer text := coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    auth.uid()::text
  );
  v_history_remark text;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required to review SLA.'
      using errcode = '42501';
  end if;

  if p_reviewed_sla_override is not null
    and p_reviewed_sla_override <> 'Within SLA' then
    raise exception 'Reviewed SLA must be Within SLA or the calculated result.'
      using errcode = '22023';
  end if;

  if v_remark is null then
    raise exception 'A remark is required for every SLA review.'
      using errcode = '22023';
  end if;

  update public.tickets as ticket
  set reviewed_sla_override = p_reviewed_sla_override,
      reviewed_sla_remark = v_remark,
      reviewed_sla_at = now(),
      reviewed_sla_by = v_reviewer
  where ticket.id = p_ticket_id;

  if not found then
    raise exception 'Ticket % was not found.', p_ticket_id
      using errcode = 'P0002';
  end if;

  v_history_remark :=
    case
      when p_reviewed_sla_override = 'Within SLA'
        then 'SLA review set to Within SLA: '
      else 'SLA review reset to the calculated result: '
    end || v_remark;

  insert into public.ticket_remarks (ticket_id, remark)
  values (p_ticket_id, v_history_remark);
end;
$$;

revoke all on function public.review_ticket_sla(text, text, text) from public;
revoke all on function public.review_ticket_sla(text, text, text) from anon;
grant execute on function public.review_ticket_sla(text, text, text) to authenticated;
