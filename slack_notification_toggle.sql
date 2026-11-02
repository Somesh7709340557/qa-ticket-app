-- Admin-only Slack alert switch for the QA Ticket Management dashboard.
-- Run this once in the Supabase SQL Editor before deploying the frontend change.

create or replace function public.admin_get_slack_notifications_enabled()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'ncgtc.support@infoneo.in' then
    raise exception 'Only the ticket administrator can view Slack notification settings.'
      using errcode = '42501';
  end if;

  select settings.live_alerts_enabled
    into v_enabled
  from public.slack_notification_settings as settings
  where settings.id = 1;

  if not found then
    raise exception 'Slack notification settings are not configured.'
      using errcode = 'P0002';
  end if;

  return v_enabled;
end;
$$;

create or replace function public.admin_set_slack_notifications_enabled(
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'ncgtc.support@infoneo.in' then
    raise exception 'Only the ticket administrator can change Slack notification settings.'
      using errcode = '42501';
  end if;

  if p_enabled is null then
    raise exception 'A Slack notification setting is required.'
      using errcode = '22023';
  end if;

  update public.slack_notification_settings as settings
  set live_alerts_enabled = p_enabled
  where settings.id = 1
  returning settings.live_alerts_enabled into v_enabled;

  if not found then
    raise exception 'Slack notification settings are not configured.'
      using errcode = 'P0002';
  end if;

  return v_enabled;
end;
$$;

revoke all on function public.admin_get_slack_notifications_enabled() from public, anon;
revoke all on function public.admin_set_slack_notifications_enabled(boolean) from public, anon;
grant execute on function public.admin_get_slack_notifications_enabled() to authenticated;
grant execute on function public.admin_set_slack_notifications_enabled(boolean) to authenticated;

-- Only claim Slack alerts created since notifications were most recently enabled.
-- This prevents a backlog accumulated before/while paused from flooding Slack
-- when the administrator turns notifications back on.
create or replace function public.claim_slack_notifications(p_limit integer default 25)
returns table (
  id bigint,
  ticket_id text,
  event_type text,
  scheme text,
  developer text,
  priority text,
  from_status text,
  to_status text
)
language sql
security definer
set search_path = ''
as $$
  with claimable as (
    select queue.id
    from public.slack_notification_outbox as queue
    join public.slack_notification_settings as settings
      on settings.id = 1
    where settings.live_alerts_enabled
      and queue.created_at >= settings.activated_at
      and queue.delivered_at is null
      and queue.next_attempt_at <= now()
      and (queue.claimed_until is null or queue.claimed_until < now())
    order by queue.created_at
    for update of queue skip locked
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
  )
  update public.slack_notification_outbox as queue
  set claimed_until = now() + interval '5 minutes',
      attempt_count = queue.attempt_count + 1
  from claimable
  where queue.id = claimable.id
  returning queue.id, queue.ticket_id, queue.event_type, queue.scheme,
            queue.developer, queue.priority, queue.from_status, queue.to_status;
$$;

revoke all on function public.claim_slack_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_slack_notifications(integer) to service_role;
