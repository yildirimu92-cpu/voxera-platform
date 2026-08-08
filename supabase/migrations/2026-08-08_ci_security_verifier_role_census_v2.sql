-- Zensus-Helfer v2: zusaetzlich die Zahl der FREMDEN Zeilen je Tabelle.
--
-- Warum als eigene Migration und nicht als Aenderung an
-- 2026-08-08_ci_security_verifier_role.sql: die erste Fassung war bereits auf
-- der Produktions-DB angewandt. Eine angewandte Migrationsdatei nachtraeglich
-- umzuschreiben laesst Repo und Datenbank auseinanderlaufen, waehrend das
-- Ledger weiter Uebereinstimmung behauptet -- exakt der Mechanismus, dessen
-- Folgen dieser ganze Vorgang aufarbeitet.
--
-- Anlass (aus dem Review von PR #835): die Loesch- und Schreibproben melden
-- "0 fremde Zeilen getroffen". Das beweist aber nur dann etwas, wenn es in der
-- betreffenden Tabelle ueberhaupt fremde Zeilen GIBT. Beim ersten Lauf traf das
-- auf ai_change_requests und voxera_cases nicht zu -- dort liegen ausschliess-
-- lich eigene Zeilen, und die Proben meldeten trotzdem PASS. Ein PASS, das
-- nichts gemessen hat, ist schlimmer als gar keine Probe: es erzeugt Vertrauen,
-- das nicht gedeckt ist.
--
-- Mit foreign_row_count kann die Probe eine Tabelle ohne Ziel ehrlich als SKIP
-- ausweisen. Rueckgabe bleiben ausschliesslich Zaehlwerte -- keine Inhalte.

begin;

-- Damit sich ein roter CI-Lauf mit postgres-Zugang exakt nachstellen laesst:
--   set role voxera_ci_verifier;
-- Das ist keine Bequemlichkeit. Die Rolle ist NOINHERIT, und deshalb verhaelt
-- sich der Katalog unter ihr anders als unter postgres: die Grant-Sichten des
-- Informationsschemas filtern auf `enabled_roles` und liefern unter der
-- CI-Rolle null Zeilen. Genau daran ist die erste Fassung der Katalogpruefung
-- gescheitert, und aufgefallen ist es nur, weil sich die Rolle nachstellen
-- liess. Ohne SET-Option waere der Check bei Rot eine Blackbox.
--
-- INHERIT bleibt aus: postgres soll die Rolle annehmen koennen, nicht passiv
-- mitfuehren -- sonst waere die Nachstellung wieder unecht.
grant voxera_ci_verifier to postgres with inherit false, set true;

-- Der Rueckgabetyp aendert sich, deshalb erst drop: `create or replace` kann
-- die OUT-Spalten einer Funktion nicht umbauen.
drop function if exists public.ci_security_probe_census();
drop function if exists public.ci_security_probe_census(text);

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
      and c.relkind = 'r'
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

revoke all on function public.ci_security_probe_census(text) from public, anon, authenticated, service_role;
grant execute on function public.ci_security_probe_census(text) to voxera_ci_verifier;

-- ── Selbstkontrolle ────────────────────────────────────────────────────────
do $$
declare
  problem text;
begin
  if pg_catalog.has_function_privilege('authenticated', 'public.ci_security_probe_census(text)', 'EXECUTE') then
    problem := 'authenticated darf den Zensus aufrufen';
  elsif pg_catalog.has_function_privilege('anon', 'public.ci_security_probe_census(text)', 'EXECUTE') then
    problem := 'anon darf den Zensus aufrufen';
  elsif not pg_catalog.has_function_privilege('voxera_ci_verifier', 'public.ci_security_probe_census(text)', 'EXECUTE') then
    problem := 'voxera_ci_verifier darf den Zensus nicht aufrufen';
  -- Bliebe die alte Signatur stehen, waere der Aufruf ohne Argument mehrdeutig
  -- -- derselbe Fehlermodus, den is_admin(uuid) in PR #833 beinahe ausgeloest
  -- haette.
  elsif to_regprocedure('public.ci_security_probe_census()') is not null then
    problem := 'die alte parameterlose Zensus-Signatur existiert noch';
  end if;

  if problem is not null then
    raise exception using
      errcode = 'raise_exception',
      message = 'ci_security_verifier_role_census_v2 abgebrochen: ' || problem;
  end if;
end
$$;

commit;
