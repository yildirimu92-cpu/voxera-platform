-- Entfernt die Alt-Überladung public.ensure_user_profile(text, text).
--
-- Warum sie weg muss:
--   Sie setzt public.users.customer_id aus einem aufrufergelieferten Parameter,
--   ohne den Aufrufer zu verifizieren:
--
--     v_customer_hint := coalesce(p_customer_id, v_meta->>'customer_id', '');
--     select c.id into v_resolved_customer_id
--       from public.customers c where c.id::text = v_customer_hint;
--     ...
--     if v_row.customer_id is null and v_resolved_customer_id is not null then
--       update public.users set customer_id = v_resolved_customer_id ...
--
--   Kein E-Mail-Abgleich, kein customers.auth_user_id-Abgleich. Jeder
--   angemeldete Nutzer, dessen users.customer_id noch leer ist -- also jeder
--   frisch angelegte --, konnte sich damit einem beliebigen Mandanten
--   zuordnen. Danach liefert public.current_customer_id() diese fremde ID,
--   und jede darauf gestützte RLS-Policy gibt die Daten dieses Mandanten frei
--   (contracts, subscriptions, offers, invoices, customer_addons aus
--   2026-08-06, notifications und ai_change_requests aus 2026-08-08).
--
--   Die EXECUTE-Rechte für anon und authenticated wurden bereits als
--   Sofortmassnahme zurückgenommen. Das Entfernen der Funktion schliesst den
--   Weg endgültig, statt eine entrechtete Falle stehen zu lassen.
--
-- Warum das sicher ist -- vor dem Schreiben geprüft, nicht angenommen:
--   * Code: public.ensure_user_profile wird genau einmal aufgerufen
--     (customer-dashboard/index.html:12659) und dort mit p_customer_id,
--     p_dashboard_id UND p_email -- PostgREST löst das auf die
--     3-Parameter-Fassung auf, die bleibt unangetastet.
--   * Datenbank: kein Funktionsrumpf ruft die 2-Parameter-Fassung auf, und
--     pg_depend weist keinen abhängigen Eintrag darauf aus.
--
-- BEWUSST NICHT ENTFERNT: public.is_admin() (ohne Argument).
--   Im Code gibt es ebenfalls keine Referenz -- eine reine Code-Suche hätte
--   also "unbenutzt" gemeldet. Die Datenbank sagt das Gegenteil: 62 aktive
--   RLS-Policies auf rund 20 Tabellen (users, customers, calls, invoices,
--   invoice_items, invoice_sequences, subscriptions, onboarding, offers,
--   offer_acceptances, offer_events, offer_sequences, push_subscriptions,
--   customer_tasks, voxera_cases, admin_emails, feature_flags,
--   kantonale_notfallnummern, industry_templates) rufen is_admin() auf.
--   pg_depend führt sie als harte Abhängigkeiten; ein DROP würde ohnehin
--   scheitern. Die Funktion trägt die gesamte Admin-Autorisierung.
--
--   Anmerkung für die spätere P0-Nacharbeit: diese Fassung prüft nur die
--   Rolle, nicht den Status -- ein deaktivierter Admin passiert weiterhin.
--   2026-07-28_p0_security_foundation.sql härtet zwar is_admin(uuid), setzt
--   für is_admin() aber nur search_path und Rechte neu, ohne den Rumpf zu
--   ersetzen. Diese Lücke bleibt also auch nach einem vollständigen
--   P0-Nachzug bestehen und gehört separat entschieden.

begin;

do $drop_legacy$
declare
  v_oid oid := to_regprocedure('public.ensure_user_profile(text, text)');
  v_dependents int;
begin
  if v_oid is null then
    return;  -- bereits entfernt
  end if;

  -- Letzte Sicherung: nichts entfernen, woran noch etwas hängt.
  select count(*) into v_dependents
  from pg_catalog.pg_depend d
  where d.refobjid = v_oid
    and d.deptype <> 'i'
    and d.classid <> 'pg_namespace'::regclass;

  if v_dependents > 0 then
    raise exception using
      errcode = 'P0001',
      message = format('ensure_user_profile(text,text) hat %s Abhaengigkeit(en) -- nicht entfernt', v_dependents);
  end if;

  execute 'drop function public.ensure_user_profile(text, text)';
end
$drop_legacy$;

commit;
