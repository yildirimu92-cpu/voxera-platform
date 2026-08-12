-- ci_security_probe_census zaehlt auch partitionierte Tabellen.
--
-- NOCH NICHT ANGEWANDT. Nach dem Anwenden gehoert die Datei auf die vom Ledger
-- vergebene Version umbenannt -- apply_migration vergibt eine eigene, und der
-- Ledger-Check ordnet ueber den Dateinamen-Praefix zu. Siehe
-- docs/TICKET_MIGRATIONS_VERSIONSDRIFT_2026-08-11.md.
--
-- ── Warum ──────────────────────────────────────────────────────────────────
--
-- Der Helfer filterte auf `c.relkind = 'r'` und liess damit den Elternteil
-- einer partitionierten Tabelle aus. Fuer die Laufzeitproben ist das nicht
-- bloss eine fehlende Zeile, sondern ein stiller Pass:
--
--   * Probe A und B lesen `coalesce(c.n, 0)`. Ohne Census-Zeile ist n = 0, und
--     beide melden dann SKIP mit der Begruendung "Tabelle ist leer" -- fuer
--     eine Tabelle, die voll sein kann.
--   * Probe B2 verhaelt sich genauso.
--   * Probe C filtert sie heraus, D2 wirft sie ueber den inneren Join weg.
--
-- Gefunden im Review von PR #977. Die dortige Aenderung nahm den Elternteil in
-- `tenant_tbl` auf -- ohne diesen Helfer waere er dort gelandet und danach
-- trotzdem uebersprungen worden. Das ist schlechter als die alte Lage: eine
-- Tabelle in der Kandidatenliste sieht geprueft aus.
--
-- ── Warum Partitionen NICHT ausgeschlossen werden ──────────────────────────
--
-- Naheliegend waere `and not c.relispartition`, damit dieselben Zeilen nicht
-- doppelt gezaehlt werden -- einmal unter dem Elternteil, einmal unter jeder
-- Partition. Bewusst nicht: Eine Partition ist ein eigenes Objekt mit eigenem
-- ACL und laesst sich direkt ansprechen. Wer nur den Elternteil prueft,
-- uebersieht ein Grant, das an einer einzelnen Partition haengt -- also genau
-- die Art Luecke, gegen die dieser Helfer existiert. Die Doppelzaehlung ist
-- kein Problem: die Proben schlagen je Relationsnamen nach, sie summieren
-- nicht.
--
-- ── Wirkung heute ──────────────────────────────────────────────────────────
--
-- In `public` gibt es aktuell keine partitionierte Tabelle. Die Migration
-- aendert damit KEIN einziges Pruefergebnis. Sie schliesst die Luecke, bevor
-- sie entsteht -- nachtraeglich faellt sie nicht auf, weil nichts rot wird.
--
-- Idempotent: create or replace, keine Datenaenderung, kein DML.

create or replace function public.ci_security_probe_census(p_home text default null)
returns table (rel text, row_count bigint, foreign_row_count bigint)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $ci_census$
declare
  r record;
  n bigint;
  fn bigint;
  keycol text;
begin
  for r in
    select c.oid, c.relname
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      -- 'p' = Elternteil einer partitionierten Tabelle. Siehe Kopf.
      and c.relkind in ('r', 'p')
    order by c.relname
  loop
    keycol := null;
    select a.attname into keycol
    from pg_catalog.pg_attribute as a
    where a.attrelid = r.oid and a.attname = 'customer_id'
      and a.attnum > 0 and not a.attisdropped;
    -- customers traegt die Mandanten-ID in `id`.
    if keycol is null and r.relname = 'customers' then
      keycol := 'id';
    end if;

    execute pg_catalog.format('select pg_catalog.count(*) from public.%I', r.relname) into n;

    -- Ohne Mandantenspalte bleibt foreign_row_count null: "nicht ermittelbar"
    -- ist eine andere Aussage als "keine fremden Zeilen", und die Proben
    -- muessen die beiden unterscheiden koennen.
    fn := null;
    if p_home is not null and keycol is not null then
      execute pg_catalog.format(
        'select pg_catalog.count(*) from public.%I where %I::text is distinct from $1',
        r.relname, keycol) into fn using p_home;
    end if;

    rel := r.relname;
    row_count := n;
    foreign_row_count := fn;
    return next;
  end loop;
end
$ci_census$;

-- Die Rechte aus 20260808122741 bleiben bestehen (create or replace laesst das
-- ACL unangetastet). Sie werden hier trotzdem erneut gesetzt: faellt die
-- Funktion je einem `drop` zum Opfer und wird ueber diese Datei
-- wiederhergestellt, waere sie sonst fuer jeden ausfuehrbar.
revoke all on function public.ci_security_probe_census(text) from public, anon, authenticated, service_role;
grant execute on function public.ci_security_probe_census(text) to voxera_ci_verifier;
