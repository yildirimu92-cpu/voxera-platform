# Staging-Projekt — Stand

**Datum:** 2026-08-08 · **Bezug:** `STAGING_PRODUKTION_TRENNUNG_KONZEPT_2026-08-08.md`, Option 1
**Status:** Schema vollständig aufgebaut und gegen Produktion verifiziert.

---

## Das Projekt

| | |
| --- | --- |
| Name | `voxera-staging` |
| Ref | `hzqiyyqfchvfcmmbemvd` |
| API-URL | `https://hzqiyyqfchvfcmmbemvd.supabase.co` |
| Region | `eu-central-2` (Zürich — dieselbe wie Produktion) |
| Postgres | 17.6.1 (identisch zu Produktion) |
| Organisation | Voxera (`kvjhyaevtjdupymdcxql`) |
| **Kosten** | **~10 USD/Monat, laufend ab 2026-08-08** |

Produktion bleibt `ulcofbgrovgcvowdjrge`.

> Das Projekt kostet ab sofort Geld. Wird es nicht mehr gebraucht, muss es aktiv pausiert
> oder gelöscht werden — es verschwindet nicht von selbst.

---

## Verifikation — jede Kategorie per Katalog-Hash gegen Produktion gemessen

Nicht behauptet, sondern nachgerechnet. Beide Datenbanken liefern paarweise denselben Hash:

| Kategorie | Hash | Anzahl |
| --- | --- | --- |
| Tabellen / Spalten | `be0946757f83a1e61d26ccbd6880a2b7` | 755 Spalten in 43 Tabellen |
| Constraints (PK/UNIQUE/CHECK/FK) | `ccdb9f8c1eeba8535836be4b59c7d5b9` | 180 |
| Indizes | `7763be67e1d695f0598147ef56dff0e3` | 143 |
| Funktionen | `0bce02daa1b3823091bef01324def8ff` | 23 |
| Trigger | `b617c33e52d84d072b57bb8a3f3d3d31` | 12 |
| RLS-Policies | `1b4b57f9ad233e9f1431e33ec2d33ff0` | 111 |
| RLS aktiviert | — | 43 von 43 Tabellen |
| Tabellen-Grants | `f6fc8f8c8897283038d644f4d9cfa53b` | 797 |
| **Spalten-Grants** | `30694cf2436942b60b4a55e458d04fef` | 9 |
| Funktions-Grants | `dec508e42f3213ca8f4e6b10c962dff5` | 40 |
| Storage-Buckets | `df90b8acc2f160c0d34efd50d0ba88b2` | 7 |

Die Abfrage, die diese Werte erzeugt, steht in `docs/STAGING_AUFBAU_RUNBOOK.md`, Schritt 4.

### Warum die Grants der wichtigste Teil sind

Ein neues Supabase-Projekt gibt `anon` und `authenticated` standardmässig **alle** Rechte auf
neue Tabellen im public-Schema. Produktion hat das durch die P0-Härtung stark eingeschränkt.
Ein Staging mit Standardrechten hätte zwar dieselben Tabellen, aber eine völlig andere
Sicherheitslage — und jeder Test dort wäre wertlos, weil er nicht misst, was in Produktion
gilt. Deshalb wurden alle Rechte zuerst zurückgenommen und dann exakt nachgezogen.

Drei Punkte, die dabei nur auffallen, wenn man den Katalog liest statt Tabellen zu zählen:

1. **Spalten-Allowlists.** `authenticated` darf UPDATE nur auf genau diesen Spalten:
   - `calls`: `dashboard_status`, `notes_customer_voxera`, `read_at`, `updated_at`
   - `customers`: `contact_first_name`, `in_app_notification_settings`, `onboarding_completed`, `updated_at`
   - `notifications`: `read_at`

   Ohne sie könnte ein Kunde beliebige Spalten seiner eigenen Zeile ändern — etwa seinen Plan
   oder die Zahlungsangaben. Die RLS-Policy erlaubt die Zeile, der Spalten-Grant begrenzt das Feld.

2. **`anon` hat auf elf Tabellen gar keine Rechte mehr** (`calendar_*`,
   `commercial_lifecycle_audit`, `contracts`, `customer_addons`,
   `customer_operational_updates`, `customers`, `invoices`, `notifications`, `offers`,
   `payment_accounts`, `subscriptions`).

3. **`anon` hat kein `EXECUTE` auf `current_customer_id()` und `is_admin()`** —
   `authenticated` und `service_role` schon. Fehlte das Recht für `authenticated`, bräche
   jedes RLS-Prädikat und damit der Login.

---

## Daten

**Kundendaten: null.** `customers`, `calls`, `invoices`, `users`, `contracts`, `offers` sind
leer und sollen es bleiben.

Stammdaten übernommen:

| Tabelle | Zeilen |
| --- | --- |
| `plan_config` | 4 |
| `voxera_voices` | 4 |
| `voxera_addons` | 8 |
| `feature_flags` | 15 |
| `kantonale_notfallnummern` | 14 |
| `payment_accounts` | 1 |
| `system_config` | 1 von 2 |

### Zwei bewusste Auslassungen

**`industry_templates` — 0 von 19 Zeilen.** 88 KB Textinhalt; das passt nicht durch den
Connector, über den dieser Aufbau lief. Nachzuholen mit direktem Zugang:

```bash
supabase db dump --db-url "$PROD_URL" --data-only --table public.industry_templates \
  | psql "$STAGING_URL" -v ON_ERROR_STOP=1
```

Betrifft Onboarding-Tests mit Branchenvorlagen; alles andere funktioniert ohne.

**`system_config` — nur `default_assistant_name`.** Der zweite Schlüssel `prompt_master_l1`
ist 9 KB Prompt-Text und fehlt. Ohne ihn erzeugt der Prompt-Builder auf Staging keinen
vollständigen Assistenten-Prompt. Gleicher Weg wie oben, `--table public.system_config`.

### Zum Mitdenken: `payment_accounts` enthält die echte IBAN

Die Zeile wurde 1:1 übernommen, damit QR-Rechnungen auf Staging dasselbe Ergebnis liefern wie
in Produktion. Das heisst aber auch: eine auf Staging erzeugte Test-Rechnung trägt die echten
Zahlungsangaben von Voxera. Kein Datenschutzproblem — es sind eigene Daten, keine
Kundendaten — aber es sollte niemand versehentlich so eine Rechnung verschicken.
`created_by` und `updated_by` stehen auf NULL, weil `admins` auf Staging leer ist und der
Fremdschlüssel sonst greift.

---

## Angewandte Migrationen

`baseline_01` bis `baseline_15`, danach `seed_01` und `seed_02`. Reihenfolge:
Erweiterungen und Sequenz → Tabellen → PK/UNIQUE → CHECK → FK → Funktionen →
Indizes → Trigger und RLS → Policies → Grants → Funktions-Grants → Storage → Stammdaten.

Die Reihenfolge ist nicht beliebig: `offers.offer_number` hat den Default
`next_offer_number_v1()`, die Funktion muss also vor dem Default existieren. Sie wurde
deshalb in `baseline_07` nachgezogen, nachdem die Tabelle stand.

---

## Wie es gebaut wurde

Über den Supabase-Connector (Management-API via HTTPS), nicht mit `supabase db dump`. Die
Agent-Umgebung hat keinen TCP-Zugang zu Port 5432 — nachgemessen: DNS löst auf, die
Verbindung läuft in einen Timeout. Details in `docs/STAGING_AUFBAU_RUNBOOK.md`.

Die DDL wurde aus dem Katalog von Produktion erzeugt (`pg_get_constraintdef`,
`pg_get_functiondef`, `pg_get_triggerdef`, `pg_get_indexdef`, `aclexplode`) und auf Staging
angewandt. Dass dieses Verfahren exakt ist und nicht nur ungefähr, zeigen die elf
übereinstimmenden Hashes oben — insbesondere, weil derselbe Struktur-Hash schon bei einem
früheren, unabhängigen Durchlauf herauskam.

---

## Nächste Schritte

1. **Netlify-Env auf Staging umstellen.** Für *Deploy previews* und *Branch deploys*:
   ```
   SUPABASE_URL       = https://hzqiyyqfchvfcmmbemvd.supabase.co
   SUPABASE_ANON_KEY  = (Dashboard → voxera-staging → Settings → API → anon/public)
   SUPABASE_SERVICE_ROLE_KEY = (ebenda, service_role)
   ```
   Damit greift die Laufzeit-Konfiguration aus PR #844 ohne weitere Codeänderung, und
   Previews zeigen auf Staging statt auf nichts. Schritte in
   `docs/RUNTIME_CONFIG_UND_PREVIEW_ISOLATION.md`.

2. **Die beiden fehlenden Seed-Tabellen nachziehen** (siehe oben).

3. **Migrations-Ledger auf Produktion in Ordnung bringen.** Dort stehen weiterhin nur 7
   Einträge. **Schreibvorgang auf Produktion** — bewusst und einzeln ausführen.

4. **`verify-db-security-invariants` gegen Staging laufen lassen.** Der Katalog-Vergleich oben
   zeigt, dass die Rechte gleich *aussehen*; der Check misst, was `anon` und `authenticated`
   tatsächlich *dürfen*. Braucht auf Staging zuerst die Rolle `voxera_ci_verifier`
   (`supabase/migrations/2026-08-08_ci_security_verifier_role.sql` und `…_census_v2.sql`,
   dann Passwort setzen — siehe `docs/DB_SECURITY_CI_SETUP.md`). Deren beide Hilfsfunktionen
   haben auf Staging bewusst noch kein `EXECUTE`-Grant, weil die Rolle fehlt.

5. **Erst danach den End-to-End-Test fahren** — auf Staging, nicht auf Produktion.
