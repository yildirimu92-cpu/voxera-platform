-- Addon-Aktivierung: Kontingente addieren statt ueberschreiben.
--
-- Ausgangslage: `customer_addons` traegt UNIQUE (customer_id, addon_code), und
-- beide Aktivierungspfade nutzen genau diesen Konflikt als Upsert-Ziel. Beim
-- zweiten Kauf eines `minutes_block` wurde die bestehende Zeile damit
-- ueberschrieben -- die zuvor bezahlte Menge fiel weg. Das Dashboard summiert
-- zwar ueber mehrere Zeilen (index.html:16878), der Unique-Constraint laesst
-- aber nur eine zu; Akkumulation muss folglich ueber `quantity` laufen.
--
-- Entscheid vom 10.08.:
--   * Einmal-Addons (billing_type = 'onetime') addieren.
--   * Monatliche Addons ueberschreiben idempotent wie bisher -- bei einem
--     Addon, das gebucht ist oder nicht, waere `quantity = 2` bedeutungslos.
--   * `valid_until` ist EINSCHLIESSLICH: der genannte Tag zaehlt noch.
--     Abgelaufen heisst `valid_until is not null and valid_until < current_date`.
--   * Ist die bestehende Zeile abgelaufen oder gekuendigt, ist ein Reset auf
--     die neue Periode korrekt -- dann wird nicht addiert.
--
-- Warum eine Funktion und kein Upsert im JavaScript: die Regel braucht den
-- Vorzustand der Zeile ("war sie abgelaufen?"). Im Client hiesse das lesen,
-- rechnen, schreiben -- zwei gleichzeitige Kaeufe koennten sich gegenseitig
-- ueberschreiben und ein bezahltes Kontingent verlieren. `ON CONFLICT DO
-- UPDATE` sieht den Vorzustand als `ca.` innerhalb derselben atomaren
-- Anweisung. Zusaetzlich liegt die Regel damit an einer Stelle statt doppelt
-- in Kunden- und Admin-Pfad.
--
-- Die Ablaufregel wandert aus dem JavaScript hierher: `addonValidUntil()` in
-- beiden Netlify-Funktionen entfaellt.
--
-- Noch NICHT enthalten: das Plan-Gate auf `available_from_plan` (Paket C1).
-- Diese Funktion ist die vorgesehene Stelle dafuer -- sie kennt bereits Kunde
-- und Addon-Referenz und ist der einzige Schreibweg auf `customer_addons`.

begin;

-- ---------------------------------------------------------------------------
-- SICHERHEITSMODELL DIESER FUNKTION -- bewusste Entscheidung, kein Versehen.
-- ---------------------------------------------------------------------------
-- Die Funktion nimmt `p_customer_id` entgegen und prueft ihn NICHT gegen
-- `current_customer_id()`. Das sieht nach einer Luecke aus und ist keine --
-- bitte nicht "reparieren", ohne den Admin-Pfad zu kennen:
--
--   * `admin-mutate.js` -> `addons.activate` aktiviert stellvertretend fuer
--     einen fremden Kunden. Dort ist `current_customer_id()` nicht die
--     Zielkundennummer, sondern die des handelnden Admins oder NULL. Eine
--     Gleichheitspruefung in der Funktion wuerde diesen Pfad brechen.
--
--   * Die Mandantenbindung liegt deshalb im Kundenpfad:
--     `customer-manage-addon.js` verifiziert das JWT, loest ueber
--     `auth_user_id` die Kundennummer auf und reicht nur diese herein. Der
--     Aufrufer kann sie nicht waehlen.
--
--   * Die alleinige Grenze ist damit der EXECUTE-Grant: ausschliesslich
--     `service_role`. Beide Aufrufer arbeiten mit dem Service-Role-Schluessel,
--     der den Browser nie erreicht. Dasselbe Modell benutzen
--     `assign_twilio_number` und `admin_apply_invoice_financial_action_v1`.
--
-- Weil SECURITY DEFINER die RLS-Policies auf `customer_addons` umgeht, ist
-- dieser Grant sicherheitskritisch. Am 10.08. stand die Funktion kurzzeitig
-- fuer `anon` und `authenticated` offen, weil `revoke ... from public` die
-- namentlichen Default-Privilege-Grants nicht entfernt -- siehe
-- 2026-08-10_addon_functions_execute_revoke_hotfix.sql. Wer diese Funktion
-- aendert, prueft danach:
--   select has_function_privilege('anon',
--     'public.activate_customer_addon_v1(text,text,integer)','EXECUTE');
-- Erwartet: false.
-- ---------------------------------------------------------------------------

create or replace function public.activate_customer_addon_v1(
  p_customer_id text,
  p_addon_code  text,
  p_quantity    integer default 1
)
returns public.customer_addons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_addon public.voxera_addons;
  v_qty   integer;
  v_valid date;
  v_row   public.customer_addons;
begin
  -- Eingangswerte klemmen, bevor sie in die Tabelle gelangen.
  v_qty := greatest(1, least(coalesce(p_quantity, 1), 100));

  select * into v_addon
    from public.voxera_addons
   where addon_code = p_addon_code
     and coming_soon = false;

  if not found then
    raise exception 'addon_not_available'
      using errcode = 'no_data_found',
            detail  = 'Unbekanntes Add-on oder coming_soon = true.';
  end if;

  -- Einmal-Addons mit Minutenkontingent gelten bis zum letzten Tag des
  -- laufenden Monats, einschliesslich. Alles andere laeuft nicht ab.
  if v_addon.billing_type = 'onetime' and coalesce(v_addon.extra_minutes, 0) > 0 then
    v_valid := (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date;
  else
    v_valid := null;
  end if;

  -- Die Reset-Bedingung steht dreimal wortgleich in den CASE-Zweigen. Das ist
  -- Absicht: ON CONFLICT kennt keine lokale Variable, und die Bedingung auf
  -- eine Hilfsfunktion auszulagern haette den Vorzustand `ca.` unsichtbar
  -- gemacht. Reset gilt, wenn (a) das Addon monatlich ist -- dann wird
  -- ueberschrieben statt addiert, (b) die bestehende Zeile nicht aktiv ist,
  -- oder (c) ihre Periode verstrichen ist.
  insert into public.customer_addons as ca
    (customer_id, addon_code, status, billing_cycle, price_chf,
     quantity, valid_until, starts_at, cancelled_at, updated_at)
  values
    (p_customer_id, p_addon_code, 'active', v_addon.billing_type,
     coalesce(v_addon.price_monthly_chf, v_addon.price_onetime_chf),
     v_qty, v_valid, now(), null, now())
  on conflict (customer_id, addon_code) do update set
    status        = 'active',
    billing_cycle = excluded.billing_cycle,
    price_chf     = excluded.price_chf,

    quantity = case
      when excluded.billing_cycle <> 'onetime'
        or ca.status <> 'active'
        or (ca.valid_until is not null and ca.valid_until < current_date)
      then excluded.quantity
      else ca.quantity + excluded.quantity
    end,

    valid_until = case
      when excluded.billing_cycle <> 'onetime'
        or ca.status <> 'active'
        or (ca.valid_until is not null and ca.valid_until < current_date)
      then excluded.valid_until
      else greatest(ca.valid_until, excluded.valid_until)
    end,

    -- Beim Weiterlaufen bleibt der urspruengliche Beginn stehen; nur ein Reset
    -- setzt eine neue Periode in Gang.
    starts_at = case
      when excluded.billing_cycle <> 'onetime'
        or ca.status <> 'active'
        or (ca.valid_until is not null and ca.valid_until < current_date)
      then excluded.starts_at
      else ca.starts_at
    end,

    cancelled_at = null,
    updated_at   = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- Beide Aufrufer arbeiten mit dem Service-Role-Schluessel und haben die
-- Berechtigung des Aufrufers vorher selbst geprueft. `authenticated` braucht
-- die Funktion deshalb nicht -- sie wuerde sonst jedem eingeloggten Nutzer
-- erlauben, sich Addons auf fremde Kundennummern zu schreiben.
--
-- Einzeln widerrufen, nicht nur von PUBLIC: die namentlichen Grants aus
-- ALTER DEFAULT PRIVILEGES ueberleben ein PUBLIC-Revoke.
revoke all privileges on function public.activate_customer_addon_v1(text, text, integer) from public;
revoke all privileges on function public.activate_customer_addon_v1(text, text, integer) from anon;
revoke all privileges on function public.activate_customer_addon_v1(text, text, integer) from authenticated;
grant execute on function public.activate_customer_addon_v1(text, text, integer) to service_role;

commit;
