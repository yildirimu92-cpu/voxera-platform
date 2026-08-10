begin;

alter table if exists public.voxera_cases
  add column if not exists due_at timestamptz,
  add column if not exists queue_scope text not null default 'admin';

alter table if exists public.voxera_cases
  drop constraint if exists voxera_cases_queue_scope_check;

alter table if exists public.voxera_cases
  add constraint voxera_cases_queue_scope_check
  check (queue_scope in ('admin', 'customer_followup'));

-- Explicit operational intake always belongs to the Admin queue.
update public.voxera_cases
set queue_scope = 'admin'
where coalesce(case_type, 'internal_task') in ('customer_support', 'assistant_change')
   or coalesce(source, '') in ('admin', 'admin_portal', 'manual_admin', 'internal', 'operations', 'customer_portal_support', 'ai_change_request');

-- Quarantine legacy Customer-Dashboard follow-ups which were historically
-- written into voxera_cases or backfilled with the default source "admin".
update public.voxera_cases c
set queue_scope = 'customer_followup'
where coalesce(c.case_type, 'internal_task') = 'internal_task'
  and coalesce(c.source, '') not in ('admin_portal', 'manual_admin', 'operations')
  and coalesce(c.origin_channel, '') not in ('admin_portal')
  and (
    lower(coalesce(c.source, '')) ~ '(customer.*(task|follow)|call.*follow|callback|follow[_ -]?up)'
    or lower(coalesce(c.origin_channel, '')) in ('customer_dashboard', 'customer_portal')
    or lower(coalesce(to_jsonb(c)->>'type', '')) ~ '(customer.*(task|follow)|call.*follow|callback|follow[_ -]?up)'
    or (
      lower(coalesce(c.title, '') || ' ' || coalesce(c.note, '')) ~ '(follow[ -]?up|rückruf|callback|zurückrufen|anruf.*nachfassen)'
      and (
        nullif(to_jsonb(c)->>'phone', '') is not null
        or nullif(to_jsonb(c)->>'call_id', '') is not null
        or nullif(to_jsonb(c)->>'conversation_id', '') is not null
      )
    )
  );

create index if not exists voxera_cases_admin_queue_due_idx
  on public.voxera_cases (queue_scope, status, due_at);

comment on column public.voxera_cases.queue_scope is
  'Admin queue separation. admin = operational Admin work; customer_followup = Customer Dashboard follow-up, excluded from Cases & Support.';
comment on column public.voxera_cases.due_at is
  'Operational due date. New manually created Admin cases default to 24 hours after creation.';

commit;
