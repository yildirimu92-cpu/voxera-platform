-- NACHDOKUMENTIERT am 2026-08-11. Diese Datei wurde nicht vorab geschrieben und
-- dann angewandt, sondern umgekehrt: die Aenderung lief am 2026-08-11 direkt auf
-- der Produktions-DB (Ledger-Version 20260811190623) und hatte danach keine
-- Entsprechung im Repo.
--
-- Gefunden beim Verifizieren einer anderen Massnahme: Die Bestandszahlen fuer
-- anon/authenticated hatten sich zwischen zwei Messungen im Abstand von rund
-- einer Stunde veraendert, ohne dass eine Repo-Migration das erklaerte.
--
-- Herkunft des SQL: woertlich aus supabase_migrations.schema_migrations.statements
-- uebernommen, also aus dem, was tatsaechlich ausgefuehrt wurde -- nicht
-- rekonstruiert und nicht aus dem Anwendungscode abgeleitet. Eine Anweisung,
-- 1817 Zeichen, vollstaendig (nicht abgeschnitten) ausgelesen.
--
-- Die Migration steht bereits im Ledger und wird dadurch NICHT erneut
-- ausgefuehrt. Alle Anweisungen sind revoke-Operationen und damit ohnehin
-- idempotent.
--
-- ── Verhaeltnis zu 20260811183000_default_privileges_dml_root.sql ───────────
--
-- Beide Migrationen behandeln dieselbe Wurzel, und die Reihenfolge zaehlt:
--
--   18:49  20260811184916  revoke insert, update, delete          (aus PR #944)
--   19:06  20260811190623  revoke insert, update, delete, truncate,
--                                 references, trigger, maintain   (diese Datei)
--
-- Die zweite ist die weiter gehende und hat die erste ueberholt: Sie entfernt
-- zusaetzlich `references`, `trigger` und `maintain`, sowie erneut `truncate`
-- (das seit 20260809164858 ohnehin weg war). Die Default-Privilegien-Zeile
-- lautet danach `anon=r` und `authenticated=r` -- nur noch SELECT.
--
-- Die frueheren Ueberlegungen zu `references` und `trigger` (PR #944, Abschnitt
-- "Bewusst NICHT enthalten") sind damit erledigt, nicht offen: sie wurden hier
-- mitgenommen.
--
-- ── Der Teil, der ueber die Wurzel hinausgeht ──────────────────────────────
--
-- Ab der zweiten Anweisung geht diese Migration in den BESTAND -- 15 Tabellen,
-- von Hand aufgezaehlt. Das ist eine andere Klasse als die Wurzelbehandlung und
-- weicht von der Bauform ab, die 20260809164858_truncate_grant_sweep.sql
-- gewaehlt hatte: dort dynamisch ueber pg_class, mit der ausdruecklichen
-- Begruendung, eine gepflegte Liste sei "schon beim naechsten `create table`
-- unvollstaendig, ohne dass es auffiele".
--
-- Diese Datei bewertet das nicht -- sie dokumentiert nur, was lief. Die
-- Bewertung und die Frage, ob die Liste vollstaendig war, gehoeren in den
-- laufenden Auftrag zum anon-DML-Bestand
-- (docs/ANON_DML_WURZEL_DIAGNOSE_2026-08-11.md).
--
-- ── Gegen den Live-Katalog geprueft (2026-08-11, nach dem Lauf) ─────────────
--
--   Default-Privilegien, Erzeuger postgres, Objekttyp r:
--     {postgres=arwdDxtm, anon=r, authenticated=r, service_role=arwdDxtm}
--   Erzeuger supabase_admin unveraendert arwdDxtm -- aus der Migrationsrolle
--   nicht aenderbar (42501), bekannte und im Katalogcheck gepruefte Ausnahme.
--
--   Bestand anon:           INSERT 12, UPDATE 12, DELETE 12, SELECT 15,
--                           REFERENCES 1, TRIGGER 1
--   Bestand authenticated:  INSERT 17, UPDATE 17, DELETE 17, SELECT 28,
--                           REFERENCES 4, TRIGGER 4
--   service_role:           unveraendert 47 Tabellen, alle Rechte
--
-- ── Woertlich aus dem Ledger ───────────────────────────────────────────────

alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger, maintain
  on tables from anon, authenticated;

revoke insert, update, delete, references, trigger, maintain
  on public.admins from anon, authenticated;
revoke references, trigger, maintain
  on public.admin_emails from anon, authenticated;

revoke all on public.industry_templates from anon;
revoke all on public.outbox_events      from anon;
revoke all on public.plan_config        from anon;

revoke insert, update, delete, references, trigger, maintain
  on public.minutes_topups from anon, authenticated;

revoke insert, delete, references, trigger, maintain
  on public.users from anon, authenticated;

revoke delete, references, trigger, maintain
  on public.calls from authenticated;

revoke references, trigger, maintain
  on public.customers from authenticated;

revoke references, trigger, maintain on public.customer_tasks     from anon, authenticated;
revoke references, trigger, maintain on public.feature_flags      from anon, authenticated;
revoke references, trigger, maintain on public.invoice_items      from anon, authenticated;
revoke references, trigger, maintain on public.invoice_sequences  from anon, authenticated;
revoke references, trigger, maintain on public.offer_acceptances  from anon, authenticated;
revoke references, trigger, maintain on public.offer_events       from anon, authenticated;
revoke references, trigger, maintain on public.offer_sequences    from anon, authenticated;
revoke references, trigger, maintain on public.onboarding         from anon, authenticated;
revoke references, trigger, maintain on public.push_subscriptions from anon, authenticated;
revoke references, trigger, maintain on public.voxera_cases       from anon, authenticated;
