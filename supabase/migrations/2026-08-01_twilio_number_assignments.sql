begin;
create table if not exists public.telephony_numbers (
 id uuid primary key default gen_random_uuid(), provider text not null default 'twilio',
 provider_number_sid text not null unique, phone_e164 text not null unique, friendly_name text,
 capabilities jsonb not null default '{}'::jsonb, provider_status text,
 assignment_status text not null default 'available' check (assignment_status in ('available','assigned','verification_failed','released')),
 customer_id text references public.customers(id) on delete set null, voice_url text,
 last_verified_at timestamptz, last_synced_at timestamptz, assigned_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists telephony_numbers_customer_id_idx on public.telephony_numbers(customer_id);
create table if not exists public.telephony_number_assignment_audit (
 id uuid primary key default gen_random_uuid(), provider text not null default 'twilio',
 provider_number_sid text, phone_e164 text not null, customer_id text, previous_customer_id text,
 actor_id text, action text not null, details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.telephony_numbers enable row level security;
alter table public.telephony_number_assignment_audit enable row level security;
create or replace function public.assign_twilio_number(p_customer_id text,p_number_sid text,p_phone_e164 text,p_actor_id text default null,p_voice_url text default null)
returns setof public.telephony_numbers language plpgsql security definer set search_path=public as $$
declare v_other text;v_previous_customer text;v_previous_number text;v_now timestamptz:=now();
begin
 if p_customer_id is null or nullif(trim(p_number_sid),'') is null or nullif(trim(p_phone_e164),'') is null then raise exception 'customer_and_number_required';end if;
 perform pg_advisory_xact_lock(hashtext(trim(p_phone_e164)));
 perform 1 from public.customers where id=p_customer_id;
 if not found then raise exception 'customer_not_found';end if;
 select id into v_other from public.customers where trim(coalesce(voxera_number,''))=trim(p_phone_e164) and id<>p_customer_id limit 1 for update;
 if v_other is not null then raise exception 'twilio_number_already_assigned';end if;
 select voxera_number into v_previous_number from public.customers where id=p_customer_id for update;
 select customer_id into v_previous_customer from public.telephony_numbers where provider_number_sid=trim(p_number_sid) for update;
 update public.telephony_numbers set customer_id=null,assignment_status='available',assigned_at=null,updated_at=v_now where customer_id=p_customer_id and provider='twilio' and provider_number_sid<>trim(p_number_sid);
 insert into public.telephony_numbers(provider,provider_number_sid,phone_e164,assignment_status,customer_id,voice_url,assigned_at,last_synced_at,updated_at)
 values('twilio',trim(p_number_sid),trim(p_phone_e164),'assigned',p_customer_id,p_voice_url,v_now,v_now,v_now)
 on conflict(provider_number_sid) do update set phone_e164=excluded.phone_e164,assignment_status='assigned',customer_id=excluded.customer_id,voice_url=excluded.voice_url,assigned_at=excluded.assigned_at,last_synced_at=excluded.last_synced_at,updated_at=excluded.updated_at;
 update public.customers set voxera_number=trim(p_phone_e164),updated_at=v_now where id=p_customer_id;
 insert into public.telephony_number_assignment_audit(provider_number_sid,phone_e164,customer_id,previous_customer_id,actor_id,action,details)
 values(trim(p_number_sid),trim(p_phone_e164),p_customer_id,v_previous_customer,p_actor_id,'twilio_number.assigned',jsonb_build_object('previous_number',v_previous_number,'voice_url',p_voice_url));
 return query select * from public.telephony_numbers where provider_number_sid=trim(p_number_sid);
end;$$;
revoke all on function public.assign_twilio_number(text,text,text,text,text) from public;
revoke all on function public.assign_twilio_number(text,text,text,text,text) from anon;
revoke all on function public.assign_twilio_number(text,text,text,text,text) from authenticated;
grant execute on function public.assign_twilio_number(text,text,text,text,text) to service_role;
commit;
