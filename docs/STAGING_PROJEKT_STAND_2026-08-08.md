# Staging-Projekt — Stand und Fortsetzung

**Datum:** 2026-08-08 · **Bezug:** `STAGING_PRODUKTION_TRENNUNG_KONZEPT_2026-08-08.md`, Option 1
**Status:** angefangen, nicht fertig. Genauer Stand unten.

---

## Das Projekt

| | |
| --- | --- |
| Name | `voxera-staging` |
| Ref | `hzqiyyqfchvfcmmbemvd` |
| Region | `eu-central-2` (Zürich — dieselbe wie Produktion) |
| Postgres | 17.6.1 |
| Organisation | Voxera (`kvjhyaevtjdupymdcxql`) |
| **Kosten** | **~10 USD/Monat, laufend ab 2026-08-08** |

Produktion bleibt `ulcofbgrovgcvowdjrge`.

> Das Projekt kostet ab sofort Geld. Wenn Option 1 doch anders gelöst werden soll, muss es
> aktiv pausiert oder gelöscht werden — es verschwindet nicht von selbst.

---

## Was steht — mit Nachweis

Nicht behauptet, sondern per Katalog-Hash gegen Produktion gemessen:

| Objekt | Produktion | Staging | Nachweis |
| --- | --- | --- | --- |
| Tabellen / Spalten | 43 / 755 | 43 / 755 | Hash `be0946757f83a1e61d26ccbd6880a2b7` **identisch** |
| Constraints (PK/UNIQUE/CHECK/FK) | 180 | 180 | Hash `ccdb9f8c1eeba8535836be4b59c7d5b9` **identisch** |
| Sequenz `customer_code_seq` | ✓ | ✓ | |
| Erweiterungen (`uuid-ossp`, `pgcrypto`) | ✓ | ✓ | |
| Funktionen | 23 | **14** | unvollständig |

Angewandte Migrationen auf Staging: `baseline_01` bis `baseline_07`.

## Was fehlt

| Objekt | Anzahl | Anmerkung |
| --- | --- | --- |
| Funktionen | 9 | s. u. |
| Indizes (nicht constraint-gestützt) | 81 | |
| Trigger | 12 | brauchen die fehlenden Funktionen |
| RLS aktivieren | 43 Tabellen | **ohne das greift keine Policy** |
| Policies | 111 | brauchen `is_admin()`, `current_customer_id()` — beide vorhanden |
| Grants für `anon` / `authenticated` / `service_role` | — | |
| Storage-Buckets | 7 | `avatars`, `e-mail-asset`, `legal`, `Public`, `call-recordings`, `invoice-pdfs`, `voice-previews` |
| Default auf `offers.offer_number` | 1 | bewusst weggelassen, s. u. |

**Fehlende Funktionen:** `admin_apply_invoice_financial_action_v1` (10,5 KB — die grösste),
`next_credit_note_number_v1`, `next_invoice_number_v1`, `next_offer_number_v1`,
`next_customer_code`, `set_updated_at`, `sync_ai_change_request_from_case`,
`sync_notification_booleans`, `invoices_compat_normalize_v1` *(bereits angewandt — hier nicht mehr offen)*.

**Bewusste Abweichung:** `offers.offer_number` hat auf Produktion den Default
`next_offer_number_v1()`. Die Funktion existierte beim Anlegen der Tabelle noch nicht, deshalb
wurde die Spalte ohne Default erzeugt. Nach dem Nachziehen der Funktion:

```sql
alter table public.offers alter column offer_number set default next_offer_number_v1();
```

Bis dahin weicht Staging an dieser einen Stelle von Produktion ab.

---

## Warum es nicht in einem Zug fertig wurde

Diese Umgebung hat **keine direkte Datenbankverbindung** — kein Passwort, und der Egress-Proxy
blockt `db.*.supabase.co`. Damit ist `pg_dump` / `supabase db dump` nicht verfügbar, und die
gesamte DDL muss über den Supabase-Connector durch die Sitzung fliessen: einmal beim Auslesen
aus dem Katalog, einmal beim Anwenden. Für 43 Tabellen, 180 Constraints, 111 Policies und
23 Funktionen ist das machbar, aber es passt nicht in eine Sitzung.

Die Methode selbst ist nachweislich exakt — die beiden identischen Hashes oben sind der Beleg.
Sie ist nur langsam.

---

## Zwei Wege weiter

### Weg A — mit CLI und direkter Verbindung (empfohlen, schneller und vollständiger)

Braucht das Datenbank-Passwort aus dem Supabase-Dashboard. Erfasst zusätzlich Dinge, die über
den Katalog mühsam sind: Kommentare, Storage-Policies, Rollen-Grants.

```bash
# 1. Schema aus Produktion ziehen (erzeugt zugleich die Repo-Baseline)
supabase db dump --db-url "postgresql://postgres:<PW>@db.ulcofbgrovgcvowdjrge.supabase.co:5432/postgres" \
  --schema public --schema-only > supabase/migrations/0000_baseline_2026-08-08.sql

# 2. Staging zurücksetzen (der Teilstand oben würde sonst kollidieren)
#    Dashboard → voxera-staging → Settings → General → Reset database
#    oder: drop schema public cascade; create schema public;

# 3. Einspielen
psql "postgresql://postgres:<PW>@db.hzqiyyqfchvfcmmbemvd.supabase.co:5432/postgres" \
  -f supabase/migrations/0000_baseline_2026-08-08.sql
```

Storage-Buckets sind **nicht** Teil des Dumps und müssen separat angelegt werden (Liste oben).

### Weg B — im selben Verfahren weitermachen

Eine neue Sitzung mit vollem Kontext kann direkt an `baseline_08` anschliessen. Die
Katalog-Abfragen, die die DDL erzeugen, stehen unten — sie sind der eigentliche Generator und
funktionieren gegen jedes Supabase-Projekt.

---

## Generator-Abfragen

Gegen die Quell-Datenbank ausführen, Ergebnis auf das Ziel anwenden.

```sql
-- Indizes (ohne die, die ein Constraint mitbringt)
select string_agg(indexdef || ';', E'\n' order by indexname) from pg_indexes i
where schemaname='public' and not exists (
  select 1 from pg_constraint pc join pg_class pcl on pcl.oid=pc.conindid
  where pcl.relname=i.indexname);

-- Funktionen
select string_agg(pg_get_functiondef(p.oid), E';\n\n') from pg_proc p
join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';

-- Trigger
select string_agg(pg_get_triggerdef(t.oid) || ';', E'\n') from pg_trigger t
join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal;

-- RLS aktivieren
select string_agg('alter table public.' || quote_ident(c.relname) || ' enable row level security;', E'\n')
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relrowsecurity;

-- Policies
select string_agg(
  'create policy ' || quote_ident(policyname) || ' on public.' || quote_ident(tablename)
  || ' as ' || permissive || ' for ' || cmd
  || ' to ' || array_to_string(roles, ', ')
  || coalesce(' using (' || qual || ')', '')
  || coalesce(' with check (' || with_check || ')', '') || ';', E'\n' order by tablename, policyname)
from pg_policies where schemaname='public';

-- Grants auf Tabellen
select string_agg('grant ' || privilege_type || ' on public.' || quote_ident(table_name)
  || ' to ' || quote_ident(grantee) || ';', E'\n')
from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated','service_role');
```

**Verifikation nach jedem Schritt** — beide Seiten müssen denselben Hash liefern:

```sql
-- Struktur
select md5(string_agg(sig,'|' order by sig)), count(*) from (
  select c.relname||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text as sig
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  where n.nspname='public' and c.relkind='r') x;

-- Policies
select md5(string_agg(sig,'|' order by sig)), count(*) from (
  select tablename||':'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'')
  from pg_policies where schemaname='public') x;
```

---

## Danach noch offen (nicht Teil des Schema-Abgleichs)

1. **Migrations-Ledger auf Produktion in Ordnung bringen.** `supabase_migrations.schema_migrations`
   kennt nur 7 Einträge; die Baseline muss dort als angewandt vermerkt werden, sonst versucht
   ein späteres `supabase db push` sie erneut einzuspielen. **Das ist ein Schreibvorgang auf
   Produktion** und sollte bewusst und einzeln erfolgen, nicht nebenbei.
2. **`supabase/config.toml` anlegen** — fehlt bisher komplett, ohne sie gibt es keine
   CLI-Projektbindung.
3. **Seed-Daten für Staging** (Testkunden, Plan-Konfiguration, `industry_templates`,
   `kantonale_notfallnummern`, `voxera_voices` — die vier letzten sind Stammdaten und sollten
   aus Produktion übernommen werden).
4. **Netlify-Env auf Staging umstellen** für die Preview-/Branch-Kontexte — damit greift die in
   PR #844 gebaute Laufzeit-Konfiguration und Previews zeigen auf Staging statt auf nichts.
5. **`verify-db-security-invariants` gegen Staging laufen lassen** — der Check ist der beste
   verfügbare Beweis, dass die Sicherheitsschicht drüben genauso greift.
