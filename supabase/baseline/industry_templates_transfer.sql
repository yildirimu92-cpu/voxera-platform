-- industry_templates von Produktion nach Staging übertragen — ohne Terminal.
--
-- Warum diese Datei existiert: `industry_templates` sind 19 Zeilen mit rund 88 KB
-- Textinhalt (Prompt-Blöcke, Vorgabetexte, Wizard-Schritte). Das ist die einzige
-- Tabelle, die nicht über den Supabase-Connector übertragen wurde — der Inhalt
-- müsste dafür vollständig durch die Agent-Sitzung fliessen, einmal beim Lesen und
-- einmal beim Schreiben. Alle anderen Stammdaten sind bereits auf Staging.
--
-- Ohne diese Tabelle funktioniert Staging vollständig, nur Onboarding-Tests mit
-- Branchenvorlagen greifen ins Leere (Vorlagenliste bleibt leer).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ANLEITUNG (zwei Schritte, beide im Supabase-Dashboard, kein Terminal nötig)
--
-- SCHRITT 1 — im SQL-Editor von PRODUKTION (ulcofbgrovgcvowdjrge):
--   Den Block unter "GENERATOR" ausführen. Er liefert genau EINE Zelle mit einem
--   fertigen INSERT-Skript. Zelle anklicken, vollständigen Inhalt kopieren.
--
--   Achtung: Die Ergebnisansicht kürzt lange Werte optisch. Über das Kopier-Symbol
--   der Zelle kopieren, nicht mit der Maus markieren — sonst fehlt das Ende.
--
-- SCHRITT 2 — im SQL-Editor von STAGING (hzqiyyqfchvfcmmbemvd):
--   Das kopierte Skript einfügen und ausführen.
--
-- SCHRITT 3 — Gegenprobe, auf BEIDEN Projekten ausführen. Beide müssen dieselbe
--   Zeilenzahl und denselben Hash liefern:
--
--     select count(*) as zeilen,
--            md5(string_agg(row_to_json(x)::text, '|' order by id)) as hash
--     from public.industry_templates x;
--
--   Referenzwert Produktion, Stand 2026-08-08: 19 Zeilen.
-- ─────────────────────────────────────────────────────────────────────────────


-- ══ GENERATOR — auf PRODUKTION ausführen ══════════════════════════════════════
--
-- Erzeugt ein idempotentes INSERT über jsonb_populate_recordset. Der Umweg über
-- JSON spart die Spaltenaufzählung und behält Typen bei (jsonb-Felder wie
-- required_fields und extra_steps kommen unverändert an).

select
  'insert into public.industry_templates' || E'\n' ||
  'select * from jsonb_populate_recordset(null::public.industry_templates, $vx$' || E'\n' ||
  jsonb_pretty(jsonb_agg(to_jsonb(x) order by x.id)) || E'\n' ||
  '$vx$::jsonb)' || E'\n' ||
  'on conflict (id) do update set' || E'\n' ||
  '  name = excluded.name,' || E'\n' ||
  '  default_business_description = excluded.default_business_description,' || E'\n' ||
  '  default_instructions = excluded.default_instructions,' || E'\n' ||
  '  prompt_block = excluded.prompt_block,' || E'\n' ||
  '  required_fields = excluded.required_fields,' || E'\n' ||
  '  default_services = excluded.default_services,' || E'\n' ||
  '  default_location_hours = excluded.default_location_hours,' || E'\n' ||
  '  default_booking_faq = excluded.default_booking_faq,' || E'\n' ||
  '  default_fallback_escalation = excluded.default_fallback_escalation,' || E'\n' ||
  '  default_response_constraints = excluded.default_response_constraints,' || E'\n' ||
  '  extra_steps = excluded.extra_steps,' || E'\n' ||
  '  sort_order = excluded.sort_order,' || E'\n' ||
  '  active = excluded.active;' as skript
from public.industry_templates x;


-- ══ Hinweis zum Dollar-Quoting ════════════════════════════════════════════════
--
-- Das erzeugte Skript umschliesst den JSON-Block mit $vx$…$vx$. Enthielte der
-- Inhalt selbst die Zeichenfolge $vx$, bräche das Quoting. Vor dem Ausführen auf
-- Produktion einmal prüfen — muss 0 liefern:
--
--   select count(*) from public.industry_templates
--   where to_jsonb(industry_templates)::text like '%$vx$%';
--
-- Stand 2026-08-08: 0 Treffer, das Quoting ist sicher.


-- ══ Derselbe Weg für andere Tabellen ══════════════════════════════════════════
--
-- Der Generator funktioniert für jede Tabelle — Tabellenname an den drei Stellen
-- ersetzen. Für Tabellen mit Fremdschlüsseln auf leere Tabellen (etwa
-- payment_accounts.created_by → admins) die betroffenen Spalten vorher auf null
-- setzen, sonst greift der Fremdschlüssel.
