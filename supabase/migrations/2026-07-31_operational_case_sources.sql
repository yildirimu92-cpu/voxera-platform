begin;

alter table if exists public.voxera_cases
  add column if not exists case_type text not null default 'internal_task',
  add column if not exists source text not null default 'admin',
  add column if not exists source_ref_id text,
  add column if not exists origin_channel text,
  add column if not exists requester_user_id uuid,
  add column if not exists requester_email text;

create unique index if not exists voxera_cases_source_ref_unique
  on public.voxera_cases (source, source_ref_id)
  where source_ref_id is not null;

comment on column public.voxera_cases.case_type is
  'Operational category: internal_task, customer_support or assistant_change.';
comment on column public.voxera_cases.source is
  'Origin system. customer_tasks are intentionally excluded from the admin case queue.';
comment on column public.voxera_cases.source_ref_id is
  'Idempotent link to the originating request, e.g. ai_change_requests.id.';

update public.voxera_cases
set case_type = coalesce(nullif(case_type, ''), 'internal_task'),
    source = coalesce(nullif(source, ''), 'admin')
where case_type is null or case_type = '' or source is null or source = '';

create or replace function public.sync_ai_change_request_from_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.case_type = 'assistant_change'
     and new.source = 'ai_change_request'
     and nullif(new.source_ref_id, '') is not null
     and to_regclass('public.ai_change_requests') is not null then
    update public.ai_change_requests
    set status = case
      when new.status = 'done' then 'done'
      when new.status in ('in_progress', 'waiting_external') then 'in_progress'
      else 'open'
    end,
    updated_at = now()
    where id::text = new.source_ref_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_ai_change_request_from_case on public.voxera_cases;
create trigger sync_ai_change_request_from_case
after insert or update of status on public.voxera_cases
for each row execute function public.sync_ai_change_request_from_case();

commit;
