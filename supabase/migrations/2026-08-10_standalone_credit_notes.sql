-- Freistehende Kulanzgutschrift ohne Rechnungsbezug.
--
-- Ausgangslage
-- ------------
-- Das Admin-Portal trug seit Längerem ein vollständiges Gutschrift-Formular
-- (#credit-note-modal) mit sich, das an keiner Stelle erreichbar war und
-- ausserdem gegen eine Server-Aktion "invoices.create" rief, die es nie gab.
-- Ein Klick wäre mit 400 zurückgekommen.
--
-- Gutschriften AUF EINE BESTEHENDE RECHNUNG gibt es dagegen längst:
-- admin_apply_invoice_financial_action_v1(create_credit), erreichbar über
-- „Storno / Gutschrift" im Rechnungsdetail. Diese Migration ergänzt den
-- zweiten, bisher fehlenden Fall — die Kulanzgutschrift ohne Bezugsrechnung —
-- und benutzt dafür bewusst dieselben Bausteine:
--
--   * denselben Nummernkreis  → next_credit_note_number_v1()  ("VX-GS-JJJJ-NNNNNN")
--   * dieselbe Ablage         → invoices mit invoice_type = 'credit_note'
--   * dieselbe Idempotenz     → uq_invoices_adjustment_request_id
--   * dasselbe Prüfprotokoll  → invoice_financial_actions
--
-- Unterschied zur rechnungsgebundenen Gutschrift: source_invoice_id bleibt
-- NULL, und es wird keine Bezugsrechnung fortgeschrieben. Das Prüfprotokoll
-- zeigt deshalb auf die Gutschrift selbst.
--
-- Mehrwertsteuer
-- --------------
-- tax_amount = 0, subtotal = Betrag. Das ist keine Vereinfachung, sondern die
-- geltende Hauskonvention: admin-overage-invoice.js legt Rechnungen ebenfalls
-- mit tax_amount 0 an. Wenn Voxera später mit MwSt. fakturiert, muss dieser
-- Punkt an beiden Stellen gemeinsam geändert werden -- nicht nur hier.
--
-- Rechte: wie bei der bestehenden Finanzaktion nur service_role. Der Browser
-- erreicht die Funktion ausschliesslich über admin-mutate
-- (action "credit-notes.create", Capability billing:write).

begin;

-- 1) Das Prüfprotokoll kennt die neue Aktion.
alter table public.invoice_financial_actions
  drop constraint if exists invoice_financial_actions_action_check;

alter table public.invoice_financial_actions
  add constraint invoice_financial_actions_action_check
  check (action in ('void_draft','create_credit','record_refund','create_standalone_credit'));

-- 2) Die Funktion selbst.
create or replace function public.admin_create_standalone_credit_note_v1(
  p_customer_id text,
  p_amount numeric,
  p_reason text,
  p_issued_on date default null,
  p_contract_id uuid default null,
  p_actor_user_id uuid default null,
  p_actor_role text default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id text := btrim(coalesce(p_request_id,''));
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_customer_id text := nullif(btrim(coalesce(p_customer_id,'')),'');
  v_amount numeric(12,2);
  v_issued_on date := coalesce(p_issued_on, current_date);
  v_number text;
  v_credit public.invoices%rowtype;
  v_existing_result jsonb;
  v_customer_name text;
  v_result jsonb;
begin
  if v_request_id = '' then
    raise exception 'request_id is required' using errcode = '22023';
  end if;
  if v_customer_id is null then
    raise exception 'customer_id is required' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'A credit-note reason is required.' using errcode = '22023';
  end if;

  v_amount := round(coalesce(p_amount,0),2);
  if v_amount <= 0 then
    raise exception 'Credit amount must be greater than zero.' using errcode = '22023';
  end if;

  -- Idempotenz: derselbe request_id liefert dasselbe Ergebnis, statt eine
  -- zweite Gutschrift anzulegen. Gleiche Mechanik wie bei der
  -- rechnungsgebundenen Aktion.
  perform pg_advisory_xact_lock(hashtext(v_request_id));
  select result into v_existing_result
  from public.invoice_financial_actions
  where request_id = v_request_id;
  if found then
    return v_existing_result || jsonb_build_object('duplicate',true);
  end if;

  select customer_name into v_customer_name
  from public.customers
  where id = v_customer_id;
  if not found then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;

  v_number := public.next_credit_note_number_v1();

  insert into public.invoices(
    invoice_number,customer_id,invoice_type,billing_provider,status,currency,
    subtotal_amount,tax_amount,total_amount,total,amount,
    invoice_date,issued_at,contract_id,notes,source_invoice_id,
    adjustment_status,credited_amount,outstanding_amount,credit_reason,adjustment_request_id,
    financial_updated_at,created_at,updated_at
  ) values (
    v_number,v_customer_id,'credit_note','invoice','credited','CHF',
    -v_amount,0,-v_amount,-v_amount,-v_amount,
    v_issued_on,now(),p_contract_id,
    'Kulanzgutschrift: '||v_reason,
    null,
    'full',0,0,v_reason,v_request_id,
    now(),now(),now()
  ) returning * into v_credit;

  insert into public.invoice_items(
    invoice_id,sort_order,item_type,title,description,quantity,unit_price,line_total,metadata
  ) values (
    v_credit.id,1,'credit_note','Kulanzgutschrift',v_reason,
    1,-v_amount,-v_amount,
    jsonb_build_object('standalone',true,'reason',v_reason,'customer_id',v_customer_id)
  );

  v_result := jsonb_build_object(
    'credit_note_id',v_credit.id,
    'credit_note_number',v_credit.invoice_number,
    'customer_id',v_customer_id,
    'customer_name',v_customer_name,
    'amount',v_amount,
    'issued_on',v_issued_on,
    'reason',v_reason
  );

  insert into public.invoice_financial_actions(
    request_id,invoice_id,action,actor_user_id,actor_role,result
  ) values (
    v_request_id,v_credit.id,'create_standalone_credit',p_actor_user_id,p_actor_role,v_result
  );

  return v_result;
end;
$$;

revoke all on function public.admin_create_standalone_credit_note_v1(text,numeric,text,date,uuid,uuid,text,text) from public;
revoke all on function public.admin_create_standalone_credit_note_v1(text,numeric,text,date,uuid,uuid,text,text) from anon, authenticated;
grant execute on function public.admin_create_standalone_credit_note_v1(text,numeric,text,date,uuid,uuid,text,text) to service_role;

comment on function public.admin_create_standalone_credit_note_v1(text,numeric,text,date,uuid,uuid,text,text) is
  'Kulanzgutschrift ohne Bezugsrechnung. Nutzt Nummernkreis, Ablage, Idempotenz und Pruefprotokoll der rechnungsgebundenen Gutschrift. Nur ueber service_role (admin-mutate, Capability billing:write).';

commit;
