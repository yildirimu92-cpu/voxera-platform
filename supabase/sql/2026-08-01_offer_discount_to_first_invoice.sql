-- Apply an accepted offer's one-time credit to the first setup invoice.
-- This keeps the commercial total from the offer consistent with invoicing.

create or replace function public.apply_offer_credit_to_invoice_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer_id uuid;
  v_discount numeric := 0;
  v_existing_discount numeric := 0;
  v_new_total numeric := 0;
begin
  -- Only the initial setup invoice receives an absolute one-time credit.
  if coalesce(new.invoice_type, '') <> 'setup_fee' then
    return new;
  end if;

  v_offer_id := new.offer_id;
  if v_offer_id is null and new.contract_id is not null then
    select c.offer_id into v_offer_id
    from public.contracts c
    where c.id = new.contract_id;
  end if;

  if v_offer_id is null then
    return new;
  end if;

  select greatest(coalesce(o.discount_amount, 0), 0)
    into v_discount
  from public.offers o
  where o.id = v_offer_id;

  if coalesce(v_discount, 0) <= 0 then
    return new;
  end if;

  -- Never reduce an invoice below zero.
  v_discount := least(v_discount, greatest(coalesce(new.subtotal_amount, new.total_amount, 0), 0));
  v_new_total := greatest(coalesce(new.subtotal_amount, new.total_amount, 0) - v_discount, 0);

  new.subtotal_amount := v_new_total;
  new.total_amount := greatest(v_new_total + coalesce(new.tax_amount, 0), 0);
  new.offer_id := coalesce(new.offer_id, v_offer_id);
  new.notes := concat_ws(E'\n', nullif(new.notes, ''), 'Einmalige Gutschrift gemäss Offerte: CHF ' || to_char(v_discount, 'FM999999990.00'));

  return new;
end;
$$;

drop trigger if exists trg_apply_offer_credit_to_invoice_v1 on public.invoices;
create trigger trg_apply_offer_credit_to_invoice_v1
before insert on public.invoices
for each row
execute function public.apply_offer_credit_to_invoice_v1();

create or replace function public.add_offer_credit_invoice_item_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer_id uuid;
  v_discount numeric := 0;
begin
  if coalesce(new.invoice_type, '') <> 'setup_fee' then
    return new;
  end if;

  v_offer_id := new.offer_id;
  if v_offer_id is null and new.contract_id is not null then
    select c.offer_id into v_offer_id
    from public.contracts c
    where c.id = new.contract_id;
  end if;

  if v_offer_id is null then
    return new;
  end if;

  select greatest(coalesce(o.discount_amount, 0), 0)
    into v_discount
  from public.offers o
  where o.id = v_offer_id;

  if coalesce(v_discount, 0) <= 0 then
    return new;
  end if;

  -- Avoid duplicate discount rows on retries.
  if not exists (
    select 1 from public.invoice_items ii
    where ii.invoice_id = new.id
      and ii.item_type = 'offer_credit'
  ) then
    insert into public.invoice_items (
      invoice_id,
      sort_order,
      item_type,
      title,
      description,
      quantity,
      unit_price,
      line_total,
      metadata
    ) values (
      new.id,
      999,
      'offer_credit',
      'Einmalige Gutschrift gemäss Offerte',
      'Auf der angenommenen Offerte vereinbarte Gutschrift',
      1,
      -least(v_discount, greatest(coalesce(new.total_amount, 0) + v_discount, 0)),
      -least(v_discount, greatest(coalesce(new.total_amount, 0) + v_discount, 0)),
      jsonb_build_object('offer_id', v_offer_id, 'source', 'accepted_offer')
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_add_offer_credit_invoice_item_v1 on public.invoices;
create trigger trg_add_offer_credit_invoice_item_v1
after insert on public.invoices
for each row
execute function public.add_offer_credit_invoice_item_v1();

comment on function public.apply_offer_credit_to_invoice_v1() is
'Applies offers.discount_amount once to the initial setup invoice before insert.';
comment on function public.add_offer_credit_invoice_item_v1() is
'Adds a visible negative invoice item for the one-time offer credit.';
