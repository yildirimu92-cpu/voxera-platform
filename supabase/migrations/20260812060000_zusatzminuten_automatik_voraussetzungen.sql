-- Voraussetzungen fuer die automatische Nachbelastung von Zusatzminuten
-- (Etappe 2 von 5). Reine Schema-Reparatur, keine Verhaltensaenderung: der
-- Abrechnungslauf bleibt danach genauso gesperrt wie vorher, aber er kann
-- ueberhaupt erst laufen.
--
-- Ausgangslage, an der Produktionsdatenbank ulcofbgrovgcvowdjrge geprueft
-- (nicht aus den Migrationsdateien abgeleitet -- die weichen ab):
--
--   1. contracts.next_invoice_date und contracts.auto_invoice_enabled
--      existieren nicht. invoice-service.js:1188 filtert aber genau darauf
--      (`.lte('next_invoice_date', today)`). Die Abfrage bricht mit
--      42703 ab -- der wiederkehrende Abrechnungslauf hat also noch nie
--      eine Rechnung erzeugt.
--
--   2. invoices.invoice_type erlaubt 'extra_minutes' nicht. Belegt per
--      Testeinfuegung mit Rollback:
--        new row for relation "invoices" violates check constraint
--        "invoices_invoice_type_check"
--      Drei Codepfade schreiben diesen Wert (daily-billing-runner.js:218,
--      admin-overage-invoice.js:126, customer-billing-update.js:551).
--      Ueberzugsrechnungen konnten deshalb nie entstehen.
--
--   3. invoice_items.item_type erlaubt 'extra_minutes' ebenfalls nicht
--      (daily-billing-runner.js:246, admin-overage-invoice.js:158,
--      customer-billing-update.js:582).
--
-- Warum das zusammen in eine Migration gehoert: einzeln angewandt bleibt
-- der Pfad jeweils defekt, nur an einer anderen Stelle. Die Reparatur ist
-- erst als Ganzes wirksam.

begin;

-- ── 1 · Rechnungslauf-Spalten an contracts ──────────────────────────────
--
-- next_invoice_date traegt das Datum, an dem die naechste wiederkehrende
-- Rechnung faellig wird; invoice-service.js schreibt es nach jedem Lauf
-- selbst fort (ensureRecurringInvoiceForContract, :1154).
--
-- auto_invoice_enabled ist der Schalter je Vertrag. Default true, weil der
-- Code ihn genau so interpretiert (:1136: `== null ? true : Boolean(...)`)
-- -- ein NULL-Default wuerde das Verhalten also nicht aendern, aber die
-- Absicht verschleiern.

alter table public.contracts
  add column if not exists next_invoice_date date,
  add column if not exists auto_invoice_enabled boolean not null default true;

comment on column public.contracts.next_invoice_date is
  'Faelligkeitsdatum der naechsten wiederkehrenden Rechnung. Wird vom Abrechnungslauf (invoice-service.js) nach jeder erzeugten Rechnung um einen Zyklus fortgeschrieben. NULL = dieser Vertrag nimmt am wiederkehrenden Lauf nicht teil.';

comment on column public.contracts.auto_invoice_enabled is
  'Schalter je Vertrag fuer den wiederkehrenden Abrechnungslauf. false haelt den Vertrag an, ohne ihn zu kuendigen.';

-- Bestandsvertraege werden hier BEWUSST NICHT initialisiert.
--
-- next_invoice_date bleibt fuer alle bestehenden Vertraege NULL, und NULL
-- heisst fuer invoice-service.js: dieser Vertrag wird nicht angefasst
-- (`.lte('next_invoice_date', today)` schliesst NULL aus). Nach dieser
-- Migration kann der Lauf also technisch starten, erzeugt aber weiterhin
-- keine einzige Rechnung. Das ist der gewollte Zustand: Etappe 2 repariert
-- die Voraussetzung, Etappe 4 entscheidet ueber die Nutzung.
--
-- Warum die Initialisierung nicht hierher gehoert: sie ist eine fachliche
-- Entscheidung, keine Schema-Frage. Zu klaeren ist, ab wann wem das erste
-- Mal automatisch fakturiert wird. Ein rueckwirkend gesetztes Datum wuerde
-- beim ersten Durchgang sofort Rechnungen fuer zurueckliegende Perioden
-- erzeugen -- die Bestandsvertraege starteten am 06.08.2026, das waeren
-- unmittelbar Rechnungen, die niemand erwartet. Diese Entscheidung faellt
-- in Etappe 4, mit Ausgangsmessung davor, wie bei jeder Anwendung an
-- Produktion.

-- ── 2 · CHECK-Constraints um 'extra_minutes' erweitern ──────────────────
--
-- Beide Constraints sind bereits NOT VALID (Altbestand wird nicht geprueft,
-- neue Zeilen schon). Der Zustand bleibt erhalten: erneut NOT VALID, damit
-- diese Migration keine Vollpruefung ueber alle Rechnungszeilen ausloest
-- und sich nicht an Altbestand verschluckt, den sie nicht verursacht hat.

alter table public.invoices
  drop constraint if exists invoices_invoice_type_check;
alter table public.invoices
  add constraint invoices_invoice_type_check
  check (invoice_type = any (array[
    'setup_fee'::text,
    'subscription'::text,
    'recurring'::text,
    'manual'::text,
    'credit_note'::text,
    'extra_minutes'::text
  ])) not valid;

alter table public.invoice_items
  drop constraint if exists invoice_items_item_type_check;
alter table public.invoice_items
  add constraint invoice_items_item_type_check
  check (item_type = any (array[
    'setup_fee'::text,
    'subscription_base'::text,
    'overage'::text,
    'discount'::text,
    'manual'::text,
    'credit_note'::text,
    'extra_minutes'::text
  ])) not valid;

commit;
