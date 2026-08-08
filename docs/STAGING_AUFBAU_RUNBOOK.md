# Runbook — Staging aus Produktion aufbauen (Weg A, CLI)

**Datum:** 2026-08-08 · **Bezug:** `STAGING_PRODUKTION_TRENNUNG_KONZEPT_2026-08-08.md`, Option 1

Erzeugt die Schema-Baseline mit `supabase db dump` und spielt sie in Staging ein.
Ersetzt den katalogbasierten Teilaufbau vom 2026-08-08 (siehe `STAGING_PROJEKT_STAND_2026-08-08.md`).

| | Ref |
| --- | --- |
| Produktion | `ulcofbgrovgcvowdjrge` |
| Staging | `hzqiyyqfchvfcmmbemvd` |

**Staging ist bereits zurückgesetzt** (2026-08-08): `public` leer, Owner `pg_database_owner`
und `USAGE`-Grants identisch zu Produktion, Migrations-Ledger geleert. Schritt 0 unten ist
nur nötig, falls erneut zurückgesetzt werden muss.

---

## Vorbereitung — die zwei Stolpersteine

**1. Der Direkt-Host ist IPv6-only.** `db.<ref>.supabase.co` ist über IPv4 nicht erreichbar.
Wenn dein Anschluss kein IPv6 hat, läuft jeder Befehl unten in einen Timeout, der wie ein
falsches Passwort aussieht. Nimm dann den **Session-Pooler** (Port 5432, *nicht* 6543 —
der Transaction-Modus kann kein `pg_dump`):

```
Dashboard → Projekt → Connect → Session pooler
Benutzername dort ist postgres.<projekt-ref>, nicht bloss postgres.
```

Dasselbe Problem hat schon den CI-Check gekostet, siehe `docs/DB_SECURITY_CI_SETUP.md`.

**2. Sonderzeichen im Passwort.** In einer Connection-URL müssen `/ @ : # %` prozent-kodiert
werden, sonst zerlegt der Parser die URL falsch. Vor dem ersten echten Befehl einmal prüfen:

```bash
psql "$PROD_URL" -c 'select current_user, current_database()'
```

Kommt hier nichts Vernünftiges zurück, liegt es an der URL — nicht an der Datenbank.

```bash
export PROD_URL='postgresql://postgres.ulcofbgrovgcvowdjrge:<PW>@<pooler-host>:5432/postgres'
export STAGING_URL='postgresql://postgres.hzqiyyqfchvfcmmbemvd:<PW>@<pooler-host>:5432/postgres'
```

> Beide Projekte haben **eigene** Passwörter. Nicht dasselbe zweimal einsetzen.
> Die URLs enthalten Zugangsdaten — nicht ins Repo, nicht in die Shell-History
> (führendes Leerzeichen vor `export` reicht in bash/zsh bei gesetztem `HISTCONTROL`).

---

## Schritt 0 — Staging zurücksetzen *(nur bei Bedarf)*

```bash
psql "$STAGING_URL" <<'SQL'
drop schema public cascade;
create schema public;
alter schema public owner to pg_database_owner;
comment on schema public is 'standard public schema';
grant usage on schema public to public;
grant usage on schema public to postgres, anon, authenticated, service_role;
delete from supabase_migrations.schema_migrations;
SQL
```

## Schritt 1 — Baseline aus Produktion ziehen

```bash
supabase db dump --db-url "$PROD_URL" --schema public \
  > supabase/migrations/0000_baseline_2026-08-08.sql
```

`supabase db dump` ist schema-only; ein `--schema-only`-Flag gibt es nicht (Daten holt man mit
`--data-only`). Danach kurz prüfen — die Zahlen müssen zum Ist-Stand passen:

```bash
grep -c '^CREATE TABLE'   supabase/migrations/0000_baseline_2026-08-08.sql   # 43
grep -c '^CREATE POLICY'  supabase/migrations/0000_baseline_2026-08-08.sql   # 111
grep -c 'ENABLE ROW LEVEL SECURITY' supabase/migrations/0000_baseline_2026-08-08.sql  # 43
```

Weichen die Zahlen ab, **nicht weitermachen** — dann hat der Dump nicht alles erfasst.

## Schritt 2 — In Staging einspielen

```bash
psql "$STAGING_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0000_baseline_2026-08-08.sql
```

`ON_ERROR_STOP=1` ist wichtig: ohne das läuft psql über Fehler hinweg und du bekommst am Ende
ein halb aufgebautes Schema mit grünem Abschluss.

Eine Warnung ist erwartbar und harmlos: der Dump verweist auf die Rolle
`voxera_ci_verifier`, die es nur auf Produktion gibt. Betrifft ausschliesslich deren Grants.

## Schritt 3 — Storage-Buckets

Buckets liegen in `storage.buckets` und sind **nicht** Teil des public-Dumps:

```bash
psql "$STAGING_URL" -v ON_ERROR_STOP=1 -f supabase/baseline/storage_buckets.sql
```

## Schritt 4 — Verifizieren

Der eigentliche Beweis. Beide Befehle auf **beiden** Datenbanken ausführen — die Hashes
müssen paarweise übereinstimmen:

```bash
for URL in "$PROD_URL" "$STAGING_URL"; do
psql "$URL" -At <<'SQL'
select 'struktur ' || md5(string_agg(sig,'|' order by sig)) || ' n=' || count(*) from (
  select c.relname||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text as sig
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  where n.nspname='public' and c.relkind='r') x
union all
select 'constraints ' || md5(string_agg(sig,'|' order by sig)) || ' n=' || count(*) from (
  select c.relname||':'||con.conname||':'||pg_get_constraintdef(con.oid) as sig
  from pg_constraint con join pg_class c on c.oid=con.conrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and con.contype in ('p','u','c','f')) x
union all
select 'policies ' || md5(string_agg(sig,'|' order by sig)) || ' n=' || count(*) from (
  select tablename||':'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'')
  from pg_policies where schemaname='public') x
union all
select 'funktionen ' || md5(string_agg(sig,'|' order by sig)) || ' n=' || count(*) from (
  select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as sig
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') x
union all
select 'indizes ' || md5(string_agg(indexdef,'|' order by indexdef)) || ' n=' || count(*)
  from pg_indexes where schemaname='public'
union all
select 'rls_aktiv n=' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity;
SQL
echo '---'
done
```

**Zielwerte aus Produktion (Stand 2026-08-08):** 43 Tabellen / 755 Spalten
(`be0946757f83a1e61d26ccbd6880a2b7`), 180 Constraints
(`ccdb9f8c1eeba8535836be4b59c7d5b9`), 111 Policies, 23 Funktionen, 43 Tabellen mit RLS.

Die ersten beiden Hashes stammen aus dem katalogbasierten Aufbau und sind unabhängig vom
Dump entstanden — stimmen sie wieder, haben zwei verschiedene Verfahren dasselbe Ergebnis
geliefert.

## Schritt 5 — Sicherheits-Invarianten gegen Staging

Der schärfste verfügbare Test. Er misst nicht den Katalog, sondern was `anon` und
`authenticated` tatsächlich dürfen:

```bash
SUPABASE_DB_URL=… node scripts/verify-db-security-invariants.mjs
```

Braucht auf Staging die Rolle `voxera_ci_verifier` — anlegen mit
`supabase/migrations/2026-08-08_ci_security_verifier_role.sql` und
`…_census_v2.sql`, dann ein Passwort setzen (siehe `docs/DB_SECURITY_CI_SETUP.md`).

Der Ledger-Teil des Checks (Gruppe G) wird auf Staging abweichen, solange dort nur die
Baseline steht — das ist erwartet, kein Fehler.

---

## Danach

1. **Migrations-Ledger auf Produktion.** Die Baseline muss dort als angewandt eingetragen
   werden, sonst spielt ein späteres `supabase db push` sie erneut ein:
   ```sql
   insert into supabase_migrations.schema_migrations (version, name)
   values ('0000', 'baseline_2026-08-08')
   on conflict (version) do nothing;
   ```
   **Schreibvorgang auf Produktion** — bewusst und einzeln ausführen, nicht nebenbei.

2. **Stammdaten nach Staging kopieren.** Ohne sie ist Staging technisch korrekt, aber fachlich
   leer: `plan_config`, `industry_templates`, `kantonale_notfallnummern`, `voxera_voices`,
   `voxera_addons`, `feature_flags`. Alles Konfiguration, keine Kundendaten:
   ```bash
   supabase db dump --db-url "$PROD_URL" --data-only \
     --table public.plan_config --table public.industry_templates \
     --table public.kantonale_notfallnummern --table public.voxera_voices \
     --table public.voxera_addons --table public.feature_flags \
     | psql "$STAGING_URL" -v ON_ERROR_STOP=1
   ```
   **Keine** `customers`, `calls`, `invoices`, `contracts`, `offers`, `users`, `admins`
   übernehmen — Staging soll gerade keine Kundendaten enthalten.

3. **Netlify-Env auf Staging umstellen.** Für *Deploy previews* und *Branch deploys*
   `SUPABASE_URL` und `SUPABASE_ANON_KEY` des Staging-Projekts eintragen. Damit zeigen
   Previews auf Staging statt auf nichts — die Laufzeit-Konfiguration aus PR #844 greift
   ohne weitere Codeänderung. Details in `docs/RUNTIME_CONFIG_UND_PREVIEW_ISOLATION.md`.

4. **Erst danach den End-to-End-Test fahren.** Sonst erzeugt er wieder Testdaten in
   Produktion — genau die Lage, die Option 1 auflösen soll.
