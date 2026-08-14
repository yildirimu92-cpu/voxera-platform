-- READ ONLY: nach 20260814230000_system_config_historie.sql laufen lassen.
--
-- Prueft, was die Migration zusichert -- und zwar am Zielsystem, nicht an der
-- Migrationsdatei. Eine gruene Migration ist keine Aussage darueber, ob die
-- Datenbank den erwarteten Zustand traegt (Kommandozentrale, "Der Nachweis
-- kommt aus dem Zielsystem, nicht aus der Anzeige davor").
--
-- ACHTUNG: Dieses Skript ist READ ONLY und kann den TRIGGER deshalb nicht
-- ausloesen. Dass die Historie tatsaechlich schreibt, weist erst die
-- Wirkprobe weiter unten in der Datei nach -- sie ist bewusst auskommentiert
-- und wird einzeln freigegeben ausgefuehrt.

-- 1. Die Tabelle steht, mit den erwarteten Spalten.
select 'A_tabelle' as sec,
  column_name as detail,
  data_type || ' nullable=' || is_nullable
  || ' default=' || coalesce(column_default, '(keiner)') as info
from information_schema.columns
where table_schema = 'public' and table_name = 'system_config_history'

union all
-- 2. Beide Trigger haengen an system_config. Erwartet: genau zwei Zeilen --
--    trg_system_config_updated_at (BEFORE UPDATE) und
--    trg_system_config_historie (AFTER UPDATE OR DELETE).
select 'B_trigger',
  t.tgname,
  pg_get_triggerdef(t.oid)
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'system_config' and not t.tgisinternal

union all
-- 3. Beide Triggerfunktionen sind SECURITY DEFINER mit gesetztem search_path.
--    Ohne gesetzten search_path waere eine SECURITY-DEFINER-Funktion angreifbar.
select 'C_funktionen',
  p.proname,
  'security_definer=' || p.prosecdef::text
  || ' search_path=' || coalesce(p.proconfig::text, 'NICHT GESETZT')
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('fn_system_config_updated_at', 'fn_system_config_historie')

union all
-- 4. Rechte wie an der Quelltabelle: RLS an, authenticated liest, schreibt nicht.
select 'D_rechte',
  'system_config_history',
  'rls=' || c.relrowsecurity::text
  || ' policies=' || (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'system_config_history')
  || ' authenticated_select=' || pg_catalog.has_table_privilege('authenticated', 'public.system_config_history', 'SELECT')::text
  || ' authenticated_insert=' || pg_catalog.has_table_privilege('authenticated', 'public.system_config_history', 'INSERT')::text
  || ' anon_select=' || pg_catalog.has_table_privilege('anon', 'public.system_config_history', 'SELECT')::text
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'system_config_history'

union all
-- 5. Der Startbestand ist da. Erwartet: zwei Zeilen mit aktion='startbestand',
--    je eine fuer prompt_master_l1 und core_field_steps, beide mit nicht-leerem
--    wert_alt und dem Zeitstempel der jeweiligen Sicherungszeile.
select 'E_startbestand',
  key,
  'zeichen_alt=' || coalesce(length(wert_alt)::text, 'NULL')
  || ' geaendert_am=' || geaendert_am::text
  || ' von=' || geaendert_von
from public.system_config_history
where aktion = 'startbestand'

union all
-- 6. Gegenprobe zum Startbestand: der gesicherte Stand muss sich vom heutigen
--    Live-Stand UNTERSCHEIDEN. Waeren sie gleich, haette die Historie den
--    falschen Wert uebernommen -- und niemand haette es gemerkt, weil eine
--    Zeile trotzdem dastuende. Erwartet: unterscheidet_sich=true.
select 'F_startbestand_traegt',
  h.key,
  'unterscheidet_sich=' || (h.wert_alt is distinct from s.value)::text
  || ' zeichen_historie=' || length(h.wert_alt)::text
  || ' zeichen_live=' || length(s.value)::text
from public.system_config_history h
join public.system_config s on s.key = h.key
where h.aktion = 'startbestand'

order by 1, 2;

-- ── Wirkprobe: schreibt der Trigger tatsaechlich? ────────────────────────────
--
-- Einzeln freigegeben ausfuehren, NICHT im Rahmen einer Auslieferung. Sie
-- veraendert eine Zeile und dreht die Aenderung wieder zurueck -- und erzeugt
-- dabei bewusst ZWEI Historieneintraege. Das ist kein Nebeneffekt, sondern der
-- Nachweis: eine Aufzeichnung, die man nicht ausloesen kann, ist keine.
--
-- Geprueft wird an `default_assistant_name` (4 Zeichen), nicht am Prompt --
-- ein Fehlgriff dort waere teuer.
--
-- begin;
--   update public.system_config set value = value || 'X' where key = 'default_assistant_name';
--   -- Erwartet: eine neue Zeile, aktion='update', wert_alt ohne X, wert_neu mit X.
--   select aktion, wert_alt, wert_neu, geaendert_am, geaendert_von, geaendert_von_uid
--     from public.system_config_history
--    where key = 'default_assistant_name' order by id desc limit 1;
--   -- Erwartet: updated_at steht jetzt auf now(), nicht mehr auf 2026-05-07.
--   select key, updated_at from public.system_config where key = 'default_assistant_name';
--   update public.system_config set value = left(value, length(value) - 1) where key = 'default_assistant_name';
--   -- Erwartet: eine ZWEITE Zeile. Das Zuruecksetzen ist selbst eine Aenderung.
--   select count(*) from public.system_config_history where key = 'default_assistant_name';
-- commit;
--
-- Und die Gegenprobe, die zeigt, dass NICHT jede Anweisung eine Zeile erzeugt:
-- ein UPDATE ohne Wertaenderung darf die Historie nicht fuellen.
--
--   update public.system_config set value = value where key = 'default_assistant_name';
--   -- Erwartet: die Anzahl aus dem Schritt davor, unveraendert.
--   select count(*) from public.system_config_history where key = 'default_assistant_name';
