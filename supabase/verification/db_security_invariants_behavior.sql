-- Laufzeit-Security-Invarianten der Produktions-DB.
--
-- Der Unterschied zu db_security_invariants_catalog.sql ist der entscheidende:
-- hier wird nicht gelesen, was im Katalog *steht*, sondern was eine echte
-- Session tatsaechlich *darf*. Genau diese Luecke hat die P0-Migration vom
-- 2026-07-28 wochenlang unentdeckt gelassen -- der Code lag im Repo, die
-- Policies existierten auf der DB nicht, und niemand hat je eine Session
-- geoeffnet und nachgesehen.
--
-- Die Proben impersonieren `anon` und `authenticated` per `set role` und
-- setzen `request.jwt.claims`, so wie PostgREST es bei einem echten Request
-- tut. Alles laeuft in EINER Transaktion, die am Ende zurueckgerollt wird.
--
-- Warum die Transaktion NICHT read-only ist: in einer Read-Only-Transaktion
-- schlaegt jeder Schreibversuch mit SQLSTATE 25006 fehl, BEVOR Postgres die
-- Rechte prueft. Damit waere Probe D blind -- sie koennte "durch Rechte
-- verweigert" nicht von "durch read-only verweigert" unterscheiden und wuerde
-- eine kaputte Berechtigung als bestanden melden. Stattdessen tragen alle
-- Schreibproben ein `where false`: die Rechtepruefung greift vollstaendig,
-- aber selbst wenn sie faelschlich durchliesse, waere die betroffene
-- Zeilenmenge leer. Keine Trigger, keine Sequenzen, keine Nebenwirkungen.
--
-- Ausgabekontrakt: STATUS <tab> GRUPPE <tab> NAME <tab> DETAIL

-- Aufruf (so ruft scripts/verify-db-security-invariants.mjs die Datei auf):
--   psql "$SUPABASE_DB_URL" -X -q -A -t -F '<tab>' -v ON_ERROR_STOP=1 -f <datei>
-- Das Feldtrennzeichen wird bewusst NUR ueber die Kommandozeile gesetzt: ein
-- `\pset fieldsep` in der Datei wuerde die Option ueberschreiben, und ob psql
-- die Escape-Sequenz '\t' zum Tabulator aufloest, haengt an der Version. Eine
-- Quelle, keine zweite, die sie still aushebeln kann.
\pset tuples_only on
\pset format unaligned
\pset pager off

begin;

create temp table probe_result (status text, grp text, name text, detail text) on commit drop;

-- Grundgesamtheit: ohne sie waere "0 Zeilen sichtbar" bei einer leeren Tabelle
-- ein falsches PASS.
create temp table census (rel text, n bigint) on commit drop;
insert into census select * from public.ci_security_probe_census();

create temp table ident (
  user_id uuid, home_customer_id text, foreign_customer_id text,
  home_rows bigint, foreign_rows bigint
) on commit drop;
insert into ident select * from public.ci_security_probe_identity();

-- Mandantentabellen dynamisch: jede neue Tabelle mit customer_id wird ab dem
-- naechsten Lauf automatisch mitgeprueft, ohne dass jemand daran denken muss.
create temp table tenant_tbl (rel text, key_col text) on commit drop;
insert into tenant_tbl
select c.relname, 'customer_id'
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
join pg_catalog.pg_attribute as a
  on a.attrelid = c.oid and a.attname = 'customer_id' and a.attnum > 0 and not a.attisdropped
where n.nspname = 'public' and c.relkind = 'r';
-- customers traegt die Mandanten-ID in `id`, nicht in `customer_id`.
insert into tenant_tbl values ('customers', 'id');

do $probes$
declare
  bogus_sub constant text := '00000000-0000-4000-8000-0000000ffff1';
  r record;
  -- Skalare statt record: bei null Treffern in `ident` sind Feldzugriffe auf
  -- eine record-Variable je nach Zuweisungszustand ein Laufzeitfehler.
  i_user_id uuid;
  i_home text;
  i_foreign text;
  i_foreign_rows bigint;
  visible bigint;
  leaked bigint;
  own_total bigint := 0;
  probed_tables int := 0;
  b boolean;
  txt text;
begin

  -- ═══ Probe A: Deny-by-default ════════════════════════════════════════════
  -- Eine authentifizierte Session mit einem Subject, das es nicht gibt, darf
  -- in keiner Mandantentabelle eine einzige Zeile sehen. Waeren die Policies
  -- so weg wie im Juli, wuerden die (weiterhin vorhandenen) Grants hier alles
  -- durchreichen und die Probe schlaegt rot aus.
  for r in
    select t.rel, coalesce(c.n, 0) as n
    from tenant_tbl as t left join census as c on c.rel = t.rel
    order by t.rel
  loop
    if r.n = 0 then
      insert into probe_result values ('SKIP', 'A-deny-default',
        'authenticated mit fremdem Subject sieht nichts in ' || r.rel,
        'Tabelle ist leer -- 0 sichtbare Zeilen waeren kein Beweis');
      continue;
    end if;

    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims',
        pg_catalog.json_build_object('sub', bogus_sub, 'role', 'authenticated')::text, true);
      execute pg_catalog.format('select pg_catalog.count(*) from public.%I', r.rel) into visible;
      reset role;
      insert into probe_result values (
        case when visible = 0 then 'PASS' else 'FAIL' end,
        'A-deny-default',
        'authenticated mit fremdem Subject sieht nichts in ' || r.rel,
        visible::text || ' von ' || r.n::text || ' Zeilen sichtbar');
    exception when others then
      txt := sqlstate;
      reset role;
      -- Gar kein Leserecht ist strenger als eine leere Ergebnismenge.
      insert into probe_result values (
        case when txt = '42501' then 'PASS' else 'FAIL' end,
        'A-deny-default',
        'authenticated mit fremdem Subject sieht nichts in ' || r.rel,
        case when txt = '42501' then 'permission denied -- strenger als noetig'
             else 'unerwarteter Fehler SQLSTATE ' || txt end);
    end;
  end loop;

  -- ═══ Probe B: anon-Aussperrung ═══════════════════════════════════════════
  -- anon haelt auf vielen Tabellen weiterhin breite DML-Grants (siehe
  -- Baseline-Diff im Katalog-Teil). Davor steht ausschliesslich RLS. Diese
  -- Probe misst, ob das tatsaechlich haelt -- nicht, ob es haelten sollte.
  for r in
    select t.rel, coalesce(c.n, 0) as n
    from tenant_tbl as t left join census as c on c.rel = t.rel
    order by t.rel
  loop
    if r.n = 0 then
      insert into probe_result values ('SKIP', 'B-anon',
        'anon sieht nichts in ' || r.rel, 'Tabelle ist leer');
      continue;
    end if;

    begin
      perform set_config('role', 'anon', true);
      perform set_config('request.jwt.claims', '', true);
      execute pg_catalog.format('select pg_catalog.count(*) from public.%I', r.rel) into visible;
      reset role;
      insert into probe_result values (
        case when visible = 0 then 'PASS' else 'FAIL' end,
        'B-anon', 'anon sieht nichts in ' || r.rel,
        visible::text || ' von ' || r.n::text || ' Zeilen sichtbar');
    exception when others then
      txt := sqlstate;
      reset role;
      insert into probe_result values (
        case when txt = '42501' then 'PASS' else 'FAIL' end,
        'B-anon', 'anon sieht nichts in ' || r.rel,
        case when txt = '42501' then 'permission denied'
             else 'unerwarteter Fehler SQLSTATE ' || txt end);
    end;
  end loop;

  -- ═══ Probe C: positive Mandantenisolation ════════════════════════════════
  -- Probe A allein ist erfuellbar, indem RLS pauschal alles verbietet. Dann
  -- waere die Anwendung kaputt, der Check aber gruen -- und beim naechsten
  -- Lockerungsversuch faellt niemandem auf, dass A nie etwas gemessen hat.
  -- Deshalb hier die Gegenrichtung mit einer echten Identitaet: der Mandant
  -- sieht seine eigenen Zeilen, und ausschliesslich die.
  select user_id, home_customer_id, foreign_customer_id, foreign_rows
    into i_user_id, i_home, i_foreign, i_foreign_rows
    from ident limit 1;

  if i_user_id is null then
    insert into probe_result values ('SKIP', 'C-isolation',
      'Mandant sieht genau seine eigenen Zeilen',
      'kein geeigneter Nicht-Admin-Nutzer mit Mandantenzuordnung gefunden');
  elsif coalesce(i_foreign_rows, 0) = 0 then
    insert into probe_result values ('SKIP', 'C-isolation',
      'Mandant sieht genau seine eigenen Zeilen',
      'nur ein Mandant traegt Daten -- es gaebe nichts zu leaken');
  else
    for r in
      select t.rel, t.key_col, coalesce(c.n, 0) as n
      from tenant_tbl as t left join census as c on c.rel = t.rel
      where coalesce(c.n, 0) > 0
      order by t.rel
    loop
      begin
        perform set_config('role', 'authenticated', true);
        perform set_config('request.jwt.claims',
          pg_catalog.json_build_object('sub', i_user_id::text, 'role', 'authenticated')::text, true);
        execute pg_catalog.format(
          'select pg_catalog.count(*) filter (where %I::text is not distinct from $1),'
          || ' pg_catalog.count(*) filter (where %I::text is distinct from $1) from public.%I',
          r.key_col, r.key_col, r.rel)
          into visible, leaked using i_home;
        reset role;

        own_total := own_total + visible;
        probed_tables := probed_tables + 1;
        insert into probe_result values (
          case when leaked = 0 then 'PASS' else 'FAIL' end,
          'C-isolation', 'kein Fremdmandant sichtbar in ' || r.rel,
          visible::text || ' eigene, ' || leaked::text || ' fremde Zeilen sichtbar');
      exception when others then
        txt := sqlstate;
        reset role;
        insert into probe_result values (
          case when txt = '42501' then 'PASS' else 'FAIL' end,
          'C-isolation', 'kein Fremdmandant sichtbar in ' || r.rel,
          case when txt = '42501' then 'permission denied'
               else 'unerwarteter Fehler SQLSTATE ' || txt end);
      end;
    end loop;

    -- Der Wachhund ueber Probe A: wenn der Mandant nirgends etwas sieht,
    -- messen A und C nichts und duerfen nicht gruen melden.
    insert into probe_result values (
      case when own_total > 0 then 'PASS' else 'FAIL' end,
      'C-isolation', 'der Mandant sieht ueberhaupt eigene Zeilen',
      own_total::text || ' eigene Zeilen ueber ' || probed_tables::text
        || ' Tabellen -- 0 hiesse: RLS sperrt pauschal alles und Probe A misst nichts');
  end if;

  -- ═══ Probe D: Schreibsperren ═════════════════════════════════════════════
  -- Alle Anweisungen tragen `where false` und beruehren garantiert null Zeilen.
  -- Erwartet wird SQLSTATE 42501 (insufficient_privilege). Kein Fehler heisst:
  -- der Schreibpfad steht offen.
  for r in
    select * from (values
      ('authenticated', 'update public.customers set status = status where false',
       'authenticated darf customers.status nicht schreiben'),
      ('authenticated', 'update public.customers set ai_instructions = ai_instructions where false',
       'authenticated darf customers.ai_instructions nicht schreiben'),
      ('authenticated', 'update public.users set email = email where false',
       'authenticated darf users.email nicht schreiben'),
      ('authenticated', 'insert into public.calls (id) select null::uuid where false',
       'authenticated darf keine calls anlegen'),
      ('anon', 'select 1 from public.system_config limit 1',
       'anon darf system_config nicht lesen'),
      ('anon', 'update public.customers set status = status where false',
       'anon darf customers.status nicht schreiben'),
      ('anon', 'insert into public.calls (id) select null::uuid where false',
       'anon darf keine calls anlegen')
    ) as v(role_name, stmt, label)
  loop
    begin
      perform set_config('role', r.role_name, true);
      perform set_config('request.jwt.claims',
        pg_catalog.json_build_object('sub', bogus_sub, 'role', r.role_name)::text, true);
      execute r.stmt;
      reset role;
      insert into probe_result values ('FAIL', 'D-schreibsperre', r.label,
        'kein Fehler -- der Schreib-/Lesepfad steht offen');
    exception when others then
      txt := sqlstate;
      reset role;
      insert into probe_result values (
        case when txt = '42501' then 'PASS' else 'FAIL' end,
        'D-schreibsperre', r.label,
        case when txt = '42501' then 'insufficient_privilege wie erwartet'
             when txt = '25006' then 'read_only_sql_transaction -- die Probe misst nichts, '
                                     || 'die Transaktion darf nicht read-only sein'
             else 'unerwarteter Fehler SQLSTATE ' || txt end);
    end;
  end loop;

  -- Gegenkontrolle: ein ERLAUBTER Schreibpfad muss durchgehen. Ohne sie wuerde
  -- eine global gesperrte Datenbank alle D-Proben bestehen.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', bogus_sub, 'role', 'authenticated')::text, true);
    execute 'update public.customers set updated_at = updated_at where false';
    reset role;
    insert into probe_result values ('PASS', 'D-schreibsperre',
      'Gegenkontrolle: authenticated darf customers.updated_at schreiben',
      'kein Fehler -- die D-Proben messen echte Rechte, keine Pauschalsperre');
  exception when others then
    txt := sqlstate;
    reset role;
    insert into probe_result values ('FAIL', 'D-schreibsperre',
      'Gegenkontrolle: authenticated darf customers.updated_at schreiben',
      'SQLSTATE ' || txt || ' -- entweder ist die Spalten-Allowlist kaputt, '
        || 'oder die D-Proben messen nur eine Pauschalsperre');
  end;

  -- ═══ Probe D2: DELETE unter RLS ══════════════════════════════════════════
  -- `authenticated` HAELT DELETE-Rechte auf mehreren Mandantentabellen -- auf
  -- customers absichtlich, weil das Admin-Panel als `authenticated` arbeitet
  -- und ueber `admins_delete_customers` loescht. Der Grant allein sagt damit
  -- nichts; entscheidend ist, ob RLS einen Nicht-Admin von fremden Zeilen
  -- fernhaelt. Genau das laesst sich nur durch ein echtes DELETE feststellen.
  --
  -- Sicherheit: das Praedikat trifft ausschliesslich Zeilen eines FREMDEN
  -- Mandanten, und die Transaktion wird ausnahmslos zurueckgerollt -- die Datei
  -- enthaelt kein einziges `commit`. Greift RLS wie vorgesehen, sind es null
  -- Zeilen; greift sie nicht, meldet die Probe das laut und die Loeschung ist
  -- durch den Rollback trotzdem folgenlos.
  --
  -- customers und users bleiben bewusst aussen vor: dort haengen Kaskaden dran,
  -- und ein (wenn auch zurueckgerollter) Kaskadenlauf auf der Produktions-DB
  -- ist kein angemessener Preis fuer eine Probe.
  if i_user_id is not null and coalesce(i_foreign_rows, 0) > 0 then
    for r in
      select v.rel, coalesce((select c.n from census as c where c.rel = v.rel), 0) as n
      from (values ('calls'), ('notifications'), ('ai_change_requests')) as v(rel)
      where coalesce((select c.n from census as c where c.rel = v.rel), 0) > 0
    loop
      begin
        perform set_config('role', 'authenticated', true);
        perform set_config('request.jwt.claims',
          pg_catalog.json_build_object('sub', i_user_id::text, 'role', 'authenticated')::text, true);
        -- `is distinct from <eigener Mandant>` statt `= <ein bestimmter fremder
        -- Mandant>`: sonst ist die Probe wirkungslos, sobald der zufaellig
        -- gewaehlte Fremdmandant in dieser Tabelle gar keine Zeilen hat -- 0
        -- Treffer waeren dann kein Beweis, sondern ein Zufall. So trifft das
        -- Praedikat jede Zeile, die dem Mandanten nicht gehoert.
        execute pg_catalog.format(
          'delete from public.%I where customer_id is distinct from $1', r.rel)
          using i_home;
        get diagnostics visible = row_count;
        reset role;
        insert into probe_result values (
          case when visible = 0 then 'PASS' else 'FAIL' end,
          'D2-delete-rls', 'Nicht-Admin kann keine fremden Zeilen in ' || r.rel || ' loeschen',
          visible::text || ' fremde Zeilen getroffen (von ' || r.n::text
            || ' Tabellenzeilen; zurueckgerollt)');
      exception when others then
        txt := sqlstate;
        reset role;
        insert into probe_result values (
          case when txt = '42501' then 'PASS' else 'FAIL' end,
          'D2-delete-rls', 'Nicht-Admin kann keine fremden Zeilen in ' || r.rel || ' loeschen',
          case when txt = '42501' then 'insufficient_privilege -- DELETE gar nicht erst erlaubt'
               else 'unerwarteter Fehler SQLSTATE ' || txt end);
      end;
    end loop;
  else
    insert into probe_result values ('SKIP', 'D2-delete-rls',
      'Nicht-Admin kann keine fremden Zeilen loeschen',
      'keine geeignete Identitaet oder kein zweiter Mandant mit Daten');
  end if;

  -- ═══ Probe E: Funktionsverhalten zur Laufzeit ════════════════════════════
  -- Der argumentlose Aufruf ist der Kern: bekaeme is_admin(uuid) je wieder ein
  -- DEFAULT, waere `is_admin()` mehrdeutig ("function is not unique") und die
  -- 62 davon abhaengigen Policies fielen gleichzeitig aus. Der Katalogcheck
  -- sieht das Argument; erst der Aufruf beweist, dass es aufloest.
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', bogus_sub, 'role', 'authenticated')::text, true);
    b := public.is_admin();
    reset role;
    insert into probe_result values (
      case when b is not null and b = false then 'PASS' else 'FAIL' end,
      'E-funktionen', 'is_admin() loest eindeutig auf und ist false fuer Unbekannte',
      'Ergebnis: ' || coalesce(b::text, 'null'));
  exception when others then
    txt := sqlstate;
    reset role;
    insert into probe_result values ('FAIL', 'E-funktionen',
      'is_admin() loest eindeutig auf und ist false fuer Unbekannte',
      'SQLSTATE ' || txt || ' -- bei 42725 ist der Aufruf mehrdeutig geworden');
  end;

  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', bogus_sub, 'role', 'authenticated')::text, true);
    b := public.is_super_admin();
    reset role;
    insert into probe_result values (
      case when b = false then 'PASS' else 'FAIL' end,
      'E-funktionen', 'is_super_admin() ist false fuer Unbekannte',
      'Ergebnis: ' || coalesce(b::text, 'null'));
  exception when others then
    txt := sqlstate; reset role;
    insert into probe_result values ('FAIL', 'E-funktionen',
      'is_super_admin() ist false fuer Unbekannte', 'SQLSTATE ' || txt);
  end;

  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', bogus_sub, 'role', 'authenticated')::text, true);
    txt := public.current_customer_id();
    reset role;
    insert into probe_result values (
      case when txt is null then 'PASS' else 'FAIL' end,
      'E-funktionen', 'current_customer_id() ist null fuer ein fremdes Subject',
      'Ergebnis: ' || coalesce(txt, 'null'));
  exception when others then
    txt := sqlstate; reset role;
    insert into probe_result values ('FAIL', 'E-funktionen',
      'current_customer_id() ist null fuer ein fremdes Subject', 'SQLSTATE ' || txt);
  end;

  -- Positivkontrolle: mit echtem Subject muss die Aufloesung greifen. Sonst
  -- waere "null fuer Unbekannte" nur ein Nebeneffekt einer kaputten Funktion.
  if i_user_id is not null then
    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims',
        pg_catalog.json_build_object('sub', i_user_id::text, 'role', 'authenticated')::text, true);
      txt := public.current_customer_id();
      reset role;
      insert into probe_result values (
        case when txt is not distinct from i_home then 'PASS' else 'FAIL' end,
        'E-funktionen', 'current_customer_id() loest ein echtes Subject korrekt auf',
        case when txt is not distinct from i_home
             then 'stimmt mit der Mandantenzuordnung ueberein'
             else 'weicht von der Mandantenzuordnung ab' end);
    exception when others then
      txt := sqlstate; reset role;
      insert into probe_result values ('FAIL', 'E-funktionen',
        'current_customer_id() loest ein echtes Subject korrekt auf', 'SQLSTATE ' || txt);
    end;
  else
    insert into probe_result values ('SKIP', 'E-funktionen',
      'current_customer_id() loest ein echtes Subject korrekt auf',
      'kein geeigneter Nicht-Admin-Nutzer gefunden');
  end if;

  -- anon darf die Autorisierungsfunktionen gar nicht erst aufrufen.
  for r in
    select * from (values
      ('public.is_admin()'), ('public.is_super_admin()'), ('public.current_customer_id()')
    ) as v(fn)
  loop
    begin
      perform set_config('role', 'anon', true);
      execute 'select ' || r.fn;
      reset role;
      insert into probe_result values ('FAIL', 'E-funktionen',
        'anon darf ' || r.fn || ' nicht aufrufen', 'Aufruf ging durch');
    exception when others then
      txt := sqlstate;
      reset role;
      insert into probe_result values (
        case when txt = '42501' then 'PASS' else 'FAIL' end,
        'E-funktionen', 'anon darf ' || r.fn || ' nicht aufrufen',
        case when txt = '42501' then 'insufficient_privilege wie erwartet'
             else 'unerwarteter Fehler SQLSTATE ' || txt end);
    end;
  end loop;

end
$probes$;

select status, grp, name,
       replace(replace(coalesce(detail, ''), chr(10), ' '), chr(9), ' ')
from probe_result
order by grp, name;

-- Der Zensus als Rohdaten: der Runner meldet im Report, wie viele Tabellen
-- mangels Daten uebersprungen wurden. Ein Check, der still 40 von 44 Proben
-- ueberspringt, ist keine Zusicherung.
select 'INFO', 'census', rel, n::text from census order by rel;

rollback;
