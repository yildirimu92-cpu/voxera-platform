-- Eine einzige Zaehlfunktion fuer verbrauchte Gespraechsminuten (Etappe 3
-- von 5). Ersetzt vier Berechnungen, die dieselbe Zahl unterschiedlich
-- ermitteln.
--
-- Warum es das braucht
-- --------------------
-- Bis heute berechnen vier Stellen den Minutenverbrauch getrennt:
--
--   daily-billing-runner.js:115-121   ceil je Anruf, dann summieren
--   invoice-service.js:143            summieren, dann einmal ceil
--   admin-panel/index.html:14253      ceil je Anruf (Browser)
--   customer-dashboard/index.html     ceil je Anruf, mit Schaetzung bei
--                                     fehlender Dauer
--
-- Die ersten beiden weichen nicht nur theoretisch ab. An den echten
-- Produktionsdaten gemessen (Stand 12.08.2026, 18:03 UTC):
--
--   Kunde cust_1786034079785_z8voxt, 35 gezaehlte Anrufe, 2'091 Sekunden
--     Summe-dann-runden (neue Regel) : 35 Minuten
--     ceil-je-Anruf     (alte Praxis): 58 Minuten
--     Differenz                      : 23 Minuten (+66 %)
--
-- Dieselbe Nutzung, zwei Rechnungsbetraege. Welcher gilt, haengt bislang
-- davon ab, welcher Codepfad zuerst laeuft. Das ist die Doppelquelle in
-- Reinform, und bei einer automatischen Nachbelastung wird daraus ein
-- Streit mit dem Kunden.
--
-- Die absoluten Zahlen wachsen weiter -- es ist eine Live-Datenbank, waehrend
-- der Analyse kamen Anrufe hinzu. Das Verhaeltnis blieb dabei stabil bei
-- +66 %, weil es an der durchschnittlichen Gespraechsdauer haengt und nicht
-- an der Anrufzahl: je kuerzer die Gespraeche, desto groesser der Aufschlag
-- durch Rundung je Anruf.
--
-- Die verbindliche Regel (Betreiber-Entscheidung vom 12.08.2026, wortgleich
-- in den AGB und im Preisdokument):
--
--   1. Sekundengenau summieren, erst die Monatssumme aufrunden -- nicht je
--      Einzelgespraech. Sonst zahlt der Kunde fuer Sekunden, die er nie
--      gesprochen hat.
--   2. Mindestdauer 10 Sekunden. Kuerzere Anrufe zaehlen gar nicht, auch
--      nicht anteilig.
--   3. Nur durchgestellte Gespraeche (live_status = 'completed').
--
-- Punkt 2 und 3 stuetzen sich gegenseitig: auf dem Bestand vom 12.08.2026
-- schliessen beide Regeln exakt dieselben zwei Anrufe aus (2 und 3
-- Sekunden, beide live_status = 'aborted'). Der kuerzeste durchgestellte
-- Anruf dauerte 13 Sekunden. Kein durchgestellter Anruf fiel unter die
-- 10-Sekunden-Schwelle -- die Schwelle ist damit heute folgenlos und wirkt
-- erst, wenn ein Gespraech zwar zustande kommt, aber sofort abbricht.
--
-- Was diese Funktion bewusst NICHT tut
-- ------------------------------------
-- Sie kennt weder Kontingent noch Minutenpreis. Beide haengen am Vertrag
-- (contracts.included_minutes, contracts.overage_rate_per_minute) und nicht
-- an einer globalen Konstante -- so bleibt Bestandsschutz moeglich: alte
-- Vertraege behalten ihre vereinbarten Werte, neue bekommen die aktuelle
-- Preisstruktur, und ein kuenftiger Preiswechsel beruehrt weder diese
-- Funktion noch bestehende Vertraege. Wer Kontingent und Ueberschreitung
-- braucht, liest die Vertragswerte und rechnet mit dem Ergebnis hier.

begin;

create or replace function public.customer_usage_for_period(
  p_customer_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  used_seconds bigint,
  used_minutes integer,
  counted_calls integer,
  ignored_too_short integer,
  ignored_not_completed integer
)
language sql
stable
security definer
set search_path = public
as $$
  with fenster as (
    select c.duration_seconds, c.live_status
    from public.calls c
    where c.customer_id = p_customer_id
      and c.created_at >= p_from
      and c.created_at <  p_to
  ),
  gezaehlt as (
    select
      coalesce(sum(f.duration_seconds) filter (
        where f.live_status = 'completed' and f.duration_seconds >= 10
      ), 0)::bigint as sek,
      count(*) filter (
        where f.live_status = 'completed' and f.duration_seconds >= 10
      )::integer as n_gezaehlt,
      count(*) filter (
        where f.live_status = 'completed'
          and coalesce(f.duration_seconds, 0) < 10
      )::integer as n_zu_kurz,
      count(*) filter (
        where f.live_status is distinct from 'completed'
      )::integer as n_nicht_durchgestellt
    from fenster f
  )
  select
    g.sek,
    -- Einmal aufrunden, auf der Monatssumme. Nicht je Anruf.
    ceil(g.sek / 60.0)::integer,
    g.n_gezaehlt,
    g.n_zu_kurz,
    g.n_nicht_durchgestellt
  from gezaehlt g;
$$;

comment on function public.customer_usage_for_period(text, timestamptz, timestamptz) is
  'Einzige Wahrheit fuer verbrauchte Gespraechsminuten je Kunde und Zeitraum. Regel (AGB-konform, Stand 12.08.2026): nur live_status=''completed'' ab 10 Sekunden; Sekunden werden summiert und die Summe EINMAL aufgerundet, nicht je Anruf. Kennt bewusst weder Kontingent noch Preis -- beide haengen am Vertrag, damit Bestandsschutz und kuenftige Preiswechsel moeglich bleiben. Gibt zusaetzlich aus, wie viele Anrufe warum nicht gezaehlt wurden, damit eine Rechnung erklaerbar bleibt.';

-- Rechte: service_role fuer die Abrechnung, authenticated fuer die Anzeige
-- im Kundendashboard. security definer ist noetig, weil die Funktion ueber
-- calls liest -- authenticated hat darauf durch die RLS-Haertung
-- (2026-08-06_p0_rls_tenant_isolation_hardening.sql) keinen freien Zugriff.
--
-- Mandantentrennung: die Funktion filtert auf den uebergebenen
-- p_customer_id. Damit ein Kunde nicht die Zahlen eines anderen abfragen
-- kann, prueft der Wrapper unten gegen current_customer_id().
revoke all on function public.customer_usage_for_period(text, timestamptz, timestamptz) from public;
revoke all on function public.customer_usage_for_period(text, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.customer_usage_for_period(text, timestamptz, timestamptz) to service_role;

-- ── Kundensichtbarer Zugang, mandantengebunden ──────────────────────────
--
-- Ohne diesen Wrapper muesste das Dashboard die Basisfunktion aufrufen und
-- koennte dabei eine fremde customer_id uebergeben -- security definer
-- wuerde sie bereitwillig beantworten. Der Wrapper nimmt deshalb gar keine
-- Kunden-ID entgegen, sondern leitet sie aus der Sitzung ab.
create or replace function public.my_usage_for_period(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  used_seconds bigint,
  used_minutes integer,
  counted_calls integer,
  ignored_too_short integer,
  ignored_not_completed integer
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.customer_usage_for_period(
    public.current_customer_id(), p_from, p_to
  );
$$;

comment on function public.my_usage_for_period(timestamptz, timestamptz) is
  'Mandantengebundener Zugang zu customer_usage_for_period fuer das Kundendashboard. Leitet die Kunden-ID aus der Sitzung ab (current_customer_id()), nimmt sie also bewusst nicht als Parameter entgegen -- sonst koennte ein Kunde die Zahlen eines anderen abfragen.';

revoke all on function public.my_usage_for_period(timestamptz, timestamptz) from public;
revoke all on function public.my_usage_for_period(timestamptz, timestamptz) from anon;
grant execute on function public.my_usage_for_period(timestamptz, timestamptz) to authenticated, service_role;

commit;
