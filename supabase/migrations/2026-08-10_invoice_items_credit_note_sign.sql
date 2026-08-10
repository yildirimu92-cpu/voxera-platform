-- Gutschrift-Positionen dürfen einen negativen Einzelpreis tragen.
--
-- Der Fund
-- --------
-- Beim Live-Test der Kulanzgutschrift auf Staging (10.08.) ist aufgefallen:
--
--     new row for relation "invoice_items"
--     violates check constraint "invoice_items_unit_price_check"   [23514]
--
-- Die Bedingung lautet `unit_price >= 0`. Gutschriften tragen ihren Betrag
-- aber überall negativ — in `invoices.total_amount`, `subtotal_amount`,
-- `amount` und eben auch in der Positionszeile.
--
-- **Das betrifft nicht nur die neue Funktion.** Die bestehende, seit Juli
-- ausgelieferte `admin_apply_invoice_financial_action_v1(create_credit)` —
-- erreichbar über „Storno / Gutschrift" im Rechnungsdetail — schreibt
-- `unit_price = -v_amount` und scheitert an derselben Zeile. Auf Staging
-- nachgewiesen: nach dem Aufruf null Gutschriften, null Positionszeilen, null
-- Protokolleinträge, und `credited_amount` der Originalrechnung unverändert
-- 0.00. Gutschriften auf eine bestehende Rechnung funktionieren heute also
-- nicht — unabhängig von dieser Umbauwelle.
--
-- Woher die Bedingung kommt
-- -------------------------
-- Aus keiner Repo-Datei. `supabase/sql/2026-04-11_invoice_system_v1.sql` legt
-- `invoice_items` an — ohne `invoice_items_unit_price_check`,
-- `invoice_items_quantity_check` und `invoice_items_tax_rate_check`. Alle drei
-- existieren auf der Datenbank. Sie sind also direkt dort angewendet worden,
-- ohne Datei im Repo: derselbe Migrations-Drift, den der Fahrplan als
-- Prozessthema führt. Die Bedingung stammt erkennbar aus der Zeit vor den
-- Gutschriften — die Typenliste in `invoice_items_item_type_check` kannte
-- 'credit_note' anfangs ebenfalls nicht und wurde im Juli nachgezogen.
--
-- Die Korrektur
-- -------------
-- Nicht die Funktionen umschreiben, sondern die Bedingung auf das ausweiten,
-- was das Datenmodell ohnehin tut: Positionen einer Gutschrift dürfen negativ
-- sein, alle anderen nicht. Das ist die kleinere Änderung, sie repariert beide
-- Wege auf einmal, und sie lässt den Schutz für die übrigen Positionstypen
-- unangetastet.
--
-- Ausserdem werden die drei Bedingungen hiermit erstmals im Repo festgehalten,
-- damit sie nicht länger nur auf der Datenbank stehen.

begin;

-- Bestandsaufnahme in Dateiform: so sahen die drei Bedingungen bisher aus.
--   invoice_items_unit_price_check  CHECK (unit_price >= 0)
--   invoice_items_quantity_check    CHECK (quantity   >= 0)
--   invoice_items_tax_rate_check    CHECK (tax_rate   >= 0)

alter table public.invoice_items
  drop constraint if exists invoice_items_unit_price_check;

alter table public.invoice_items
  add constraint invoice_items_unit_price_check
  check (unit_price >= 0 or item_type = 'credit_note');

-- quantity und tax_rate bleiben unverändert: eine Gutschrift hat Menge 1 und
-- keinen negativen Steuersatz. Sie werden hier nur nachdokumentiert, damit die
-- Repo-Datei den tatsaechlichen Stand zeigt.
alter table public.invoice_items
  drop constraint if exists invoice_items_quantity_check;
alter table public.invoice_items
  add constraint invoice_items_quantity_check check (quantity >= 0);

alter table public.invoice_items
  drop constraint if exists invoice_items_tax_rate_check;
alter table public.invoice_items
  add constraint invoice_items_tax_rate_check check (tax_rate >= 0);

comment on constraint invoice_items_unit_price_check on public.invoice_items is
  'Einzelpreise sind nicht negativ -- ausser bei Gutschriften, die ihren Betrag im gesamten Datenmodell negativ fuehren. Vor dem 10.08.2026 galt die Bedingung ausnahmslos und liess keine einzige Gutschrift-Positionszeile zu.';

commit;
