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
| `system_config` | 2 von 2 |

`prompt_master_l1` (9 KB Prompt-Text) ist übertragen und **zeichengleich**: MD5
`ea9c01673610bebf29df38a44202e577`, 9140 Zeichen auf beiden Seiten. Die Vorlage nutzt
durchgängig CRLF; der Text wurde beim Einfügen entsprechend konvertiert, sonst hätte er sich
in jeder Zeile um ein Byte unterschieden.

### Eine offene Tabelle: `industry_templates`

**0 von 19 Zeilen.** 88 KB Textinhalt — die einzige Tabelle, die nicht über den Connector
übertragen wurde: der Inhalt müsste dafür vollständig durch die Agent-Sitzung fliessen,
einmal beim Lesen und einmal beim Schreiben.

Nachzuholen **ohne Terminal**, mit zwei Kopiervorgängen im Supabase-Dashboard:
`supabase/baseline/industry_templates_transfer.sql` enthält einen Generator, der auf
Produktion ein fertiges INSERT-Skript ausgibt; das wird im SQL-Editor von Staging eingefügt.
Anleitung und Gegenprobe stehen in der Datei.

Ohne diese Tabelle funktioniert Staging vollständig — nur Onboarding-Tests mit
Branchenvorlagen greifen ins Leere, weil die Vorlagenliste leer bleibt.

### `payment_accounts` trägt eine Test-IBAN, nicht die echte

Ursprünglich 1:1 übernommen, damit QR-Rechnungen dasselbe Ergebnis liefern — womit eine auf
Staging erzeugte Testrechnung aber gültige Zahlungsangaben von Voxera getragen hätte. Ersetzt:

| Feld | Wert |
| --- | --- |
| `iban` | `CH9300762011623852957` |
| `account_name` | `Voxera CHF (STAGING)` |
| `creditor_name` | `Voxera STAGING - Testkonto` |

`CH9300762011623852957` ist das ISO-13616-Beispiel für die Schweiz: gültige Prüfsumme, und
bewusst **kein** QR-IBAN. Ein QR-IBAN (IID im Bereich 30000–31999) hätte `reference_type` von
`NON` auf `QRR` gezwungen und damit einen anderen Codepfad getestet als in Produktion — die
Trennung soll das Verhalten spiegeln, nicht verändern. Die Produktions-IBAN ist mit IID 08440
ebenfalls kein QR-IBAN.

Der `creditor_name` erscheint auf der QR-Rechnung als Zahlungsempfänger; so ist auf einen
Blick erkennbar, dass ein Beleg aus Staging stammt.

`created_by` und `updated_by` stehen auf NULL, weil `admins` auf Staging leer ist und der
Fremdschlüssel sonst greift.

---

## Verhaltensprobe — die Härtung greift auch wirklich

Der Katalog-Vergleich oben zeigt, dass die Rechte gleich *aussehen*. Diese Probe misst, was
`anon` und `authenticated` tatsächlich *dürfen*. Ausgeführt auf Staging am 2026-08-08:

| | Probe | Erwartet | Ergebnis |
| --- | --- | --- | --- |
| 1 | `anon` SELECT auf `customers` | verweigert `42501` | ✅ |
| 2 | `anon` SELECT auf `invoices` | verweigert `42501` | ✅ |
| 3 | `anon` EXECUTE `current_customer_id()` | verweigert `42501` | ✅ |
| 4 | `authenticated` UPDATE `customers.plan` | verweigert `42501` | ✅ |
| 5 | `authenticated` UPDATE `customers.onboarding_completed` | **erlaubt** | ✅ |
| 6 | `authenticated` EXECUTE `is_admin()` | **erlaubt** | ✅ |

Proben 5 und 6 sind die Gegenkontrolle und der eigentliche Punkt: eine Datenbank, die
**alles** verbietet, bestünde 1 bis 4 mühelos und wäre trotzdem kaputt — Login und RLS würden
nicht funktionieren. Dasselbe Prinzip wie in `docs/DB_SECURITY_CI_SETUP.md`.

Probe 4 gegen 5 zeigt die Spalten-Allowlist im Betrieb: dieselbe Tabelle, dieselbe Rolle,
dieselbe Anweisungsart — der Unterschied ist allein die Spalte.

**Grenze dieser Probe:** Staging ist leer. Prüfungen der Art „Mandant sieht genau seine
eigenen Zeilen" (Gruppe C des CI-Checks) sind hier nicht aussagekräftig, weil null sichtbare
Zeilen auch bei kaputter Policy herauskämen. Deshalb wurden bewusst nur Rechtefehler geprüft —
die sind auch bei leerer Tabelle eindeutig.

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

1. **Netlify-Env auf Staging umstellen.** Für *Deploy previews* und *Branch deploys*, auf
   **beiden** Sites (voxera-dashboard und voxera-admin):

   ```
   SUPABASE_URL      = https://hzqiyyqfchvfcmmbemvd.supabase.co
   SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6cWl5eXFmY2h2ZmNtbWJlbXZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTAzNTEsImV4cCI6MjEwMTc4NjM1MX0.ii6UOmP8inKoaYekYv9JdgGpw5qCcKST1FMe8pIF6WA
   ```

   Der Anon-Key ist öffentlich — er steht im ausgelieferten Frontend und ist ohne RLS
   wertlos. Der **Service-Role-Key** ist es nicht: den aus dem Dashboard holen
   (voxera-staging → Settings → API) und nirgends notieren, wo er landen kann.

   Damit greift die Laufzeit-Konfiguration aus PR #844 ohne Codeänderung, und Previews zeigen
   auf Staging statt auf nichts. Schritte in `docs/RUNTIME_CONFIG_UND_PREVIEW_ISOLATION.md`.

2. **`industry_templates` nachziehen** — `supabase/baseline/industry_templates_transfer.sql`,
   zwei Kopiervorgänge im Dashboard, kein Terminal nötig.

3. **Migrations-Ledger — siehe Abschnitt unten. Nicht als Einzeiler machbar.**

4. **`verify-db-security-invariants` gegen Staging.** Die Verhaltensprobe oben deckt den Kern
   bereits ab; der vollständige Check ist gründlicher (210 Invarianten). Braucht auf Staging
   zuerst die Rolle `voxera_ci_verifier` (die beiden Migrationen
   `2026-08-08_ci_security_verifier_role.sql` und `…_census_v2.sql`, dann Passwort setzen —
   `docs/DB_SECURITY_CI_SETUP.md`) und einen Netzweg zur Datenbank, den die Agent-Umgebung
   nicht hat. Deren beide Hilfsfunktionen haben auf Staging bewusst noch kein `EXECUTE`-Grant,
   weil die Rolle fehlt — restriktiver als Produktion, nicht lockerer.

5. **Erst danach den End-to-End-Test fahren** — auf Staging, nicht auf Produktion.

---

## Befund: Das Migrations-Ledger lässt sich nicht mit einer Zeile reparieren

Der Plan war, die Baseline auf Produktion als angewandt einzutragen, damit ein späteres
`supabase db push` sie nicht erneut einspielt. Beim Nachsehen zeigt sich, dass die Annahme
dahinter nicht trägt.

**Fakt:** Die sieben Ledger-Einträge tragen 14-stellige Versionen im CLI-Format
(`20260808031625_ai_change_requests_tenant_isolation_reassert`). Sie stammen alle von
`apply_migration`-Aufrufen, nicht von den Repo-Dateien.

**Fakt:** Die 17 Dateien in `supabase/migrations/` heissen `YYYY-MM-DD_name.sql`, also
`2026-08-08_p0_security_foundation_catchup.sql`. Auf die Ziffernfolge `2026` folgt ein
Bindestrich, kein Unterstrich.

**Wahrscheinlich** (aus der Supabase-Konvention hergeleitet, nicht mit der CLI nachgemessen —
sie ist in dieser Umgebung nicht installiert): Die CLI erkennt Migrationsdateien am Muster
`<Ziffern>_<Name>.sql`. Die Repo-Dateien erfüllen das nicht und wären für `supabase db push`
schlicht unsichtbar.

**Konsequenz:** Die befürchtete Gefahr — ein `db push` spielt alte Migrationen erneut ein —
besteht so vermutlich gar nicht. Das eigentliche Problem ist ein anderes und grösser: der
CLI-Migrationsworkflow funktioniert für dieses Repo **überhaupt nicht**. Genau deshalb wurde
seit jeher von Hand im SQL-Editor eingespielt, und genau deshalb blieb das Ledger leer — die
Ursachenkette, die zum P0-Vorfall geführt hat.

**Warum hier nichts geschrieben wurde:** Ein Ledger-Eintrag für Dateien, die die CLI nicht
sieht, ändert nichts und erzeugt den Eindruck, das Problem sei erledigt. Ein grüner Haken,
der das Falsche misst — dieselbe Fehlerklasse wie beim P0-Check, der wochenlang grün war,
während keine einzige Policy existierte.

### Schritt 0 — die Annahme zuerst bestätigen. Vor jeder Umbenennung.

Der Befund oben ist als **Wahrscheinlich** eingestuft, nicht als Fakt: die Supabase-CLI war in
der Umgebung nicht installiert, das Namensmuster ist aus der Konvention hergeleitet und nicht
nachgemessen. Bevor eine einzige Datei umbenannt wird:

```bash
supabase migration list --db-url "$PROD_URL"
```

Die Ausgabe stellt lokale Dateien den Ledger-Einträgen gegenüber. Zu erwarten ist, dass die 17
Dateien mit Bindestrich-Namen **gar nicht** in der lokalen Spalte auftauchen. Tun sie es doch,
ist die Herleitung falsch — dann sieht die CLI sie sehr wohl, die Gefahr eines erneuten
Einspielens ist real, und der richtige Fix ist ein anderer (Ledger befüllen statt umbenennen).

Der ganze Plan darunter hängt an dieser einen Ausgabe. Eine Umbenennung von 17 Dateien plus
14 Referenzen auf einer unbestätigten Annahme wäre genau der Fehler, den dieses Dokument an
anderer Stelle beschreibt.

**Der tatsächliche Fix** — erst nach Schritt 0:

1. die 17 Dateien auf `YYYYMMDDHHMMSS_name.sql` umbenennen,
2. das Ledger mit genau diesen Versionen befüllen (Schreibvorgang auf Produktion),
3. **14 Dateien anpassen, die die Migrationen unter ihrem heutigen Namen referenzieren** —
   4 Workflows (`verify-twilio-number-assignment`, `verify-customer-operational-updates`,
   `verify-admin-voices`, `verify-calendar-integrations`) und 10 Verifizierer-Skripte,
   darunter `verify-p0-security-foundation.mjs` und `verify-db-security-invariants.mjs`.

Schritt 3 ist der Grund, warum das nicht nebenbei geht: Wird eine Referenz übersehen, wird
ein Sicherheits-Check still wirkungslos, weil er eine Datei prüft, die es nicht mehr gibt.
Das braucht einen eigenen Durchgang mit vollständiger CI-Gegenprobe.
