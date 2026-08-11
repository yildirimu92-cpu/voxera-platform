-- invoice_date ist eine Legacy-Kompatibilitaetsspalte ohne Lesepfad im Repo
-- (siehe Diagnose auf PR #914 und Fix in 20260811210000). NOT NULL mit
-- Default now()::date ist eine Schema-Randbedingung aus der
-- Kompatibilitaets-Migration 2026-04-12_invoices_compatibility_bridge.sql,
-- keine aktive Nutzung -- deshalb belassen statt entfernt: das Entfernen der
-- Spalte oder ihres NOT-NULL-Constraints waere invasiver als der Nutzen hier
-- rechtfertigt, waehrend der Kompatibilitaets-Trigger sie ohnehin korrekt
-- synchron zu issued_at haelt.
--
-- Der Kommentar macht das an der Spalte selbst explizit, damit niemand sie
-- fuer die kanonische Quelle haelt -- und nimmt dem einzigen denkbaren
-- kuenftigen Leser (ein Buchhaltungs-Export ohne Uhrzeit) gleich das
-- Argument: issued_at::date leistet dasselbe, ohne eine zweite Quelle zu
-- brauchen.

comment on column public.invoices.invoice_date is
  'Legacy-Kompatibilitätsspalte, kein Lesepfad im Repo. issued_at ist die kanonische Quelle. NOT NULL wegen Altbestand-Constraint, nicht wegen aktiver Nutzung. Für einen künftigen Export ohne Uhrzeit reicht issued_at::date.';
