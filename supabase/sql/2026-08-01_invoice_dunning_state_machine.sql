begin;

alter table public.invoices
  add column if not exists reminder_level smallint not null default 0,
  add column if not exists reminder_1_sent_at timestamptz,
  add column if not exists final_reminder_sent_at timestamptz,
  add column if not exists dunning_status text not null default 'none',
  add column if not exists dunning_updated_at timestamptz,
  add column if not exists dunning_last_outbox_id text,
  add column if not exists suspension_review_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_reminder_level_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_reminder_level_check
      check (reminder_level between 0 and 2);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_dunning_status_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_dunning_status_check
      check (dunning_status in (
        'none',
        'reminder_sent',
        'final_sent',
        'suspension_review',
        'closed_paid',
        'closed_cancelled'
      ));
  end if;
end
$$;

create index if not exists invoices_dunning_worklist_idx
  on public.invoices (dunning_status, reminder_level, due_at)
  where status in ('open', 'sent', 'overdue');

comment on column public.invoices.reminder_level is
  'Canonical Voxera dunning level: 0 none, 1 first reminder sent, 2 final reminder sent.';
comment on column public.invoices.dunning_status is
  'Canonical dunning workflow state. Human notes are audit text only and must not drive eligibility.';

commit;
