begin;

-- Financial corrections are append-only documents. Existing issued invoices
-- remain unchanged; their settlement summary is updated for operations.
alter table public.invoices
  add column if not exists source_invoice_id uuid references public.invoices(id) on delete restrict,
  add column if not exists adjustment_status text not null default 'none',
  add column if not exists credited_amount numeric(12,2) not null default 0,
  add column if not exists outstanding_amount numeric(12,2),
  add column if not exists credit_reason text,
  add column if not exists adjustment_request_id text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid,
  add column if not exists void_reason text,
  add column if not exists refund_status text not null default 'none',
  add column if not exists refunded_amount numeric(12,2) not null default 0,
  add column if not exists financial_updated_at timestamptz;

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check
  check (status in ('draft','sent','open','paid','overdue','cancelled','void','credited')) not valid;

alter table public.invoices drop constraint if exists invoices_invoice_type_check;
alter table public.invoices
  add constraint invoices_invoice_type_check
  check (invoice_type in ('setup_fee','subscription','recurring','manual','credit_note')) not valid;

alter table public.invoice_items drop constraint if exists invoice_items_item_type_check;
alter table public.invoice_items
  add constraint invoice_items_item_type_check
  check (item_type in ('setup_fee','subscription_base','overage','discount','manual','credit_note')) not valid;

alter table public.invoices drop constraint if exists invoices_adjustment_status_check;
alter table public.invoices
  add constraint invoices_adjustment_status_check
  check (adjustment_status in ('none','partial','full','void')) not valid;

alter table public.invoices drop constraint if exists invoices_refund_status_check;
alter table public.invoices
  add constraint invoices_refund_status_check
  check (refund_status in ('none','partial','full')) not valid;

create index if not exists idx_invoices_source_invoice_id
  on public.invoices(source_invoice_id);
create unique index if not exists uq_invoices_adjustment_request_id
  on public.invoices(adjustment_request_id)
  where adjustment_request_id is not null;

create table if not exists public.credit_note_sequences (
  year integer primary key,
  last_value integer not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.next_credit_note_number_v1()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year integer := extract(year from now())::integer;
  next_value integer;
begin
  loop
    update public.credit_note_sequences
       set last_value = last_value + 1,
           updated_at = now()
     where year = current_year
     returning last_value into next_value;

    if found then exit; end if;

    begin
      insert into public.credit_note_sequences(year,last_value,updated_at)
      values(current_year,1,now())
      returning last_value into next_value;
      exit;
    exception when unique_violation then
      -- concurrent creator won; retry
    end;
  end loop;

  return format('VX-GS-%s-%s', current_year, lpad(next_value::text, 6, '0'));
end;
$$;

create table if not exists public.invoice_refunds (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  credit_note_id uuid references public.invoices(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'CHF',
  method text not null default 'manual',
  reference text,
  reason text,
  status text not null default 'recorded' check (status in ('recorded','completed','failed','cancelled')),
  request_id text not null unique,
  refunded_at timestamptz not null default now(),
  refunded_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_invoice_refunds_invoice_id
  on public.invoice_refunds(invoice_id, refunded_at desc);

create table if not exists public.invoice_financial_actions (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  action text not null check (action in ('void_draft','create_credit','record_refund')),
  actor_user_id uuid,
  actor_role text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_invoice_financial_actions_invoice_id
  on public.invoice_financial_actions(invoice_id, created_at desc);

-- Backfill operational balances for existing primary invoices.
update public.invoices
set outstanding_amount = case
      when lower(coalesce(status,'')) in ('paid','cancelled','void','credited') then 0
      else greatest(coalesce(total_amount,total,amount,0) - coalesce(credited_amount,0), 0)
    end,
    financial_updated_at = coalesce(financial_updated_at, updated_at, created_at, now())
where outstanding_amount is null;

create or replace function public.admin_apply_invoice_financial_action_v1(
  p_action text,
  p_invoice_id uuid,
  p_amount numeric default null,
  p_reason text default null,
  p_actor_user_id uuid default null,
  p_actor_role text default null,
  p_request_id text default null,
  p_refund_method text default null,
  p_refund_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_request_id text := btrim(coalesce(p_request_id,''));
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_invoice public.invoices%rowtype;
  v_credit public.invoices%rowtype;
  v_total numeric(12,2);
  v_existing_credit numeric(12,2);
  v_remaining numeric(12,2);
  v_amount numeric(12,2);
  v_credit_tax numeric(12,2);
  v_credit_subtotal numeric(12,2);
  v_new_credit numeric(12,2);
  v_new_remaining numeric(12,2);
  v_new_refunded numeric(12,2);
  v_refundable numeric(12,2);
  v_credit_number text;
  v_result jsonb;
  v_previous jsonb;
  v_existing_result jsonb;
  v_refund_id uuid;
begin
  if v_action not in ('void_draft','create_credit','record_refund') then
    raise exception 'Unsupported financial action: %', v_action using errcode = '22023';
  end if;
  if p_invoice_id is null then
    raise exception 'invoice_id is required' using errcode = '22023';
  end if;
  if v_request_id = '' then
    raise exception 'request_id is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_request_id));
  select result into v_existing_result
  from public.invoice_financial_actions
  where request_id = v_request_id;
  if found then
    return v_existing_result || jsonb_build_object('duplicate',true);
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if lower(coalesce(v_invoice.invoice_type,'')) = 'credit_note' then
    raise exception 'Financial actions must target the original invoice' using errcode = '22023';
  end if;

  v_previous := to_jsonb(v_invoice);
  v_total := greatest(coalesce(v_invoice.total_amount,v_invoice.total,v_invoice.amount,0),0);
  select coalesce(sum(abs(coalesce(total_amount,total,amount,0))),0)
    into v_existing_credit
  from public.invoices
  where source_invoice_id = p_invoice_id
    and lower(coalesce(invoice_type,'')) = 'credit_note'
    and lower(coalesce(status,'')) not in ('cancelled','void');
  v_existing_credit := greatest(v_existing_credit, coalesce(v_invoice.credited_amount,0));
  v_remaining := greatest(v_total - v_existing_credit,0);

  if v_action = 'void_draft' then
    if lower(coalesce(v_invoice.status,'')) <> 'draft' or v_invoice.sent_at is not null then
      raise exception 'Only an unsent draft invoice can be voided. Issued invoices require a credit note.' using errcode = '23514';
    end if;
    if v_existing_credit > 0 then
      raise exception 'Invoice already has credit notes and cannot be voided.' using errcode = '23514';
    end if;

    update public.invoices
       set status = 'void',
           adjustment_status = 'void',
           outstanding_amount = 0,
           voided_at = now(),
           voided_by = p_actor_user_id,
           void_reason = v_reason,
           financial_updated_at = now(),
           updated_at = now()
     where id = p_invoice_id
     returning * into v_invoice;

    v_result := jsonb_build_object(
      'success',true,'action',v_action,'invoice',to_jsonb(v_invoice),
      'credit_note',null,'refund',null,'duplicate',false
    );

  elsif v_action = 'create_credit' then
    if lower(coalesce(v_invoice.status,'')) in ('draft','cancelled','void','credited') then
      raise exception 'Invoice status does not allow a new credit note.' using errcode = '23514';
    end if;
    if v_reason is null then
      raise exception 'A credit-note reason is required.' using errcode = '22023';
    end if;

    v_amount := round(coalesce(p_amount, v_remaining),2);
    if v_amount <= 0 then
      raise exception 'Credit amount must be greater than zero.' using errcode = '22023';
    end if;
    if v_amount > v_remaining then
      raise exception 'Credit amount exceeds the remaining creditable amount.' using errcode = '23514';
    end if;

    if v_amount = v_total and v_existing_credit = 0 then
      v_credit_tax := abs(coalesce(v_invoice.tax_amount,0));
      v_credit_subtotal := abs(coalesce(v_invoice.subtotal_amount,v_invoice.subtotal,v_total-v_credit_tax));
    else
      v_credit_tax := case when v_total > 0 then round(abs(coalesce(v_invoice.tax_amount,0)) * (v_amount / v_total),2) else 0 end;
      v_credit_subtotal := greatest(v_amount - v_credit_tax,0);
    end if;

    v_credit_number := public.next_credit_note_number_v1();
    insert into public.invoices(
      invoice_number,customer_id,subscription_id,invoice_type,billing_provider,status,currency,
      subtotal_amount,subtotal,tax_amount,total_amount,total,amount,
      period_start,period_end,invoice_date,issued_at,due_at,due_date,sent_at,
      external_reference,offer_id,contract_id,notes,source_invoice_id,
      adjustment_status,credited_amount,outstanding_amount,credit_reason,adjustment_request_id,
      financial_updated_at,created_at,updated_at
    ) values (
      v_credit_number,v_invoice.customer_id,v_invoice.subscription_id,'credit_note',
      coalesce(nullif(v_invoice.billing_provider,''),'invoice'),'credited',coalesce(nullif(v_invoice.currency,''),'CHF'),
      -v_credit_subtotal,-v_credit_subtotal,-v_credit_tax,-v_amount,-v_amount,-v_amount,
      v_invoice.period_start,v_invoice.period_end,current_date,now(),null,null,now(),
      'credit:'||p_invoice_id::text||':'||v_request_id,v_invoice.offer_id,v_invoice.contract_id,
      'Gutschrift zu Rechnung '||coalesce(v_invoice.invoice_number,p_invoice_id::text)||': '||v_reason,
      p_invoice_id,'full',0,0,v_reason,v_request_id,now(),now(),now()
    ) returning * into v_credit;

    insert into public.invoice_items(
      invoice_id,sort_order,item_type,title,description,quantity,unit_price,line_total,metadata
    ) values (
      v_credit.id,1,'credit_note','Gutschrift',
      'Gutschrift zu Rechnung '||coalesce(v_invoice.invoice_number,p_invoice_id::text)||' – '||v_reason,
      1,-v_amount,-v_amount,jsonb_build_object('source_invoice_id',p_invoice_id,'reason',v_reason)
    );

    v_new_credit := v_existing_credit + v_amount;
    v_new_remaining := greatest(v_total - v_new_credit,0);
    update public.invoices
       set credited_amount = v_new_credit,
           outstanding_amount = case
             when lower(coalesce(status,'')) = 'paid' or paid_at is not null then 0
             else v_new_remaining
           end,
           adjustment_status = case when v_new_remaining = 0 then 'full' else 'partial' end,
           status = case
             when v_new_remaining = 0 and lower(coalesce(status,'')) <> 'paid' then 'credited'
             else status
           end,
           financial_updated_at = now(),
           updated_at = now()
     where id = p_invoice_id
     returning * into v_invoice;

    v_result := jsonb_build_object(
      'success',true,'action',v_action,'invoice',to_jsonb(v_invoice),
      'credit_note',to_jsonb(v_credit),'refund',null,'duplicate',false,
      'remaining_creditable_amount',v_new_remaining,
      'refund_due_amount',case when lower(coalesce(v_invoice.status,'')) = 'paid' or v_invoice.paid_at is not null then greatest(v_new_credit-coalesce(v_invoice.refunded_amount,0),0) else 0 end
    );

  else
    if not (lower(coalesce(v_invoice.status,'')) = 'paid' or v_invoice.paid_at is not null) then
      raise exception 'Refunds can only be recorded for paid invoices.' using errcode = '23514';
    end if;
    v_refundable := greatest(v_existing_credit - coalesce(v_invoice.refunded_amount,0),0);
    v_amount := round(coalesce(p_amount,v_refundable),2);
    if v_amount <= 0 then
      raise exception 'Refund amount must be greater than zero.' using errcode = '22023';
    end if;
    if v_amount > v_refundable then
      raise exception 'Refund amount exceeds the credited but not yet refunded amount.' using errcode = '23514';
    end if;

    insert into public.invoice_refunds(
      invoice_id,credit_note_id,amount,currency,method,reference,reason,status,request_id,refunded_at,refunded_by
    ) values (
      p_invoice_id,null,v_amount,coalesce(nullif(v_invoice.currency,''),'CHF'),
      coalesce(nullif(btrim(p_refund_method),''),'manual'),nullif(btrim(p_refund_reference),''),
      v_reason,'recorded',v_request_id,now(),p_actor_user_id
    ) returning id into v_refund_id;

    v_new_refunded := coalesce(v_invoice.refunded_amount,0) + v_amount;
    update public.invoices
       set refunded_amount = v_new_refunded,
           refund_status = case when v_new_refunded >= v_existing_credit then 'full' else 'partial' end,
           financial_updated_at = now(),
           updated_at = now()
     where id = p_invoice_id
     returning * into v_invoice;

    v_result := jsonb_build_object(
      'success',true,'action',v_action,'invoice',to_jsonb(v_invoice),
      'credit_note',null,
      'refund',jsonb_build_object('id',v_refund_id,'amount',v_amount,'method',coalesce(nullif(btrim(p_refund_method),''),'manual'),'reference',nullif(btrim(p_refund_reference),'')),
      'duplicate',false,'refund_due_amount',greatest(v_existing_credit-v_new_refunded,0)
    );
  end if;

  insert into public.invoice_financial_actions(request_id,invoice_id,action,actor_user_id,actor_role,result)
  values(v_request_id,p_invoice_id,v_action,p_actor_user_id,p_actor_role,v_result);

  insert into public.commercial_lifecycle_audit(
    actor_admin_id,actor_role,action,customer_id,contract_id,invoice_id,previous_state,next_state,metadata,happened_at
  ) values (
    p_actor_user_id,p_actor_role,'invoice.'||v_action,v_invoice.customer_id,v_invoice.contract_id,p_invoice_id,
    jsonb_build_object('invoice',v_previous),jsonb_build_object('invoice',to_jsonb(v_invoice)),
    jsonb_build_object('request_id',v_request_id,'credit_note_id',v_credit.id,'refund_id',v_refund_id,'amount',v_amount,'reason',v_reason),now()
  );

  return v_result;
end;
$$;

revoke all on function public.admin_apply_invoice_financial_action_v1(text,uuid,numeric,text,uuid,text,text,text,text) from public;
grant execute on function public.admin_apply_invoice_financial_action_v1(text,uuid,numeric,text,uuid,text,text,text,text) to service_role;
revoke all on function public.next_credit_note_number_v1() from public;
grant execute on function public.next_credit_note_number_v1() to service_role;

commit;
