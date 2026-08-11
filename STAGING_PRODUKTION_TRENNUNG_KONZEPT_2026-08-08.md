# Staging/Produktion-Trennung — Bestandsaufnahme und Optionen

**Datum:** 2026-08-08
**Status:** Konzept zur Entscheidung. Keine Umsetzung.
**Auslöser:** Kommandozentrale, Tab „Rechtliches & Betrieb" → „Staging-Umgebung getrennt von
Produktion". Launch-Kriterium: muss vor dem ersten echten Pilotkunden geklärt sein.

**Methodik:** Repo-Inspektion (Stand `6e99580`) plus Live-Abfragen gegen das echte
Supabase-Projekt über den Supabase-Connector. Jede Aussage unten ist als **Fakt**,
**Wahrscheinlich** oder **Unverifiziert** gekennzeichnet, gemäß `AGENTS.md`.

---

## 0. Kernbefund vorweg — die Formulierung im Fahrplan trifft nicht ganz

Die Kommandozentrale sagt: *„Tests laufen aktuell gegen die Produktions-Supabase-Instanz."*
Das stimmt im Ergebnis, aber die naheliegende Lesart — „die CI-Pipeline schreibt in die
Produktions-DB" — ist **falsch**. Der tatsächliche Pfad ist ein anderer, und das verschiebt,
wo eine Trennung ansetzen muss.

**Fakt:** Von den 19 GitHub-Workflows sind 18 reine Repo-Datei-Prüfungen. Sie lesen Dateien und
vergleichen Strings; keiner davon öffnet eine Datenbankverbindung. Der einzige Workflow mit
DB-Zugriff ist `verify-db-security-invariants.yml`, und der ist bereits sauber gebaut:

- läuft **bewusst nicht** auf Pull Requests, sondern nur auf `push` nach `main`, alle 6 h per
  Cron und manuell (Begründung ausführlich in `docs/DB_SECURITY_CI_SETUP.md`);
- eigenes GitHub-Environment `production-db-readonly`, dadurch einzeln entziehbar;
- eigene Rolle `voxera_ci_verifier`, `NOINHERIT`, ohne eigene Tabellenrechte;
- alles in **einer Transaktion mit Rollback**, Schreibproben tragen `where false`.

Dieser Teil ist also nicht das Problem. **Das Risiko sitzt woanders:**

**Fakt:** `SUPABASE_URL` und `SUPABASE_ANON_KEY` sind in fünf Frontend-Dateien fest
einkompiliert — es gibt keinen Schalter, der auf etwas anderes zeigen könnte:

| Datei | Zeile |
| --- | --- |
| `customer-dashboard/index.html` | 9251 |
| `customer-dashboard/activate.html` | 142 |
| `admin-panel/index.html` | 4305 |
| `admin-panel/login.html` | 137 |
| `contract-signed.html` | 193 |

Alle fünf zeigen auf `https://ulcofbgrovgcvowdjrge.supabase.co` — die Produktion. Der Anon-Key
trägt im JWT dieselbe Projekt-Referenz.

**Fakt:** In den 88 Netlify Functions (37 Customer, 51 Admin) gibt es **keinen einzigen**
Umgebungs-Guard. Ein `grep` über `CONTEXT`, `NODE_ENV`, `deploy-preview` und `branch-deploy`
liefert null Treffer, und keine der beiden `netlify.toml` hat einen `[context.*]`-Block. Jede
Function nimmt `process.env.SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY`, was immer dort steht.

**Konsequenz:** Jede Deploy-Preview — also jeder offene PR — ist eine vollwertige,
öffentlich erreichbare Instanz der Anwendung mit **Produktions-Service-Role-Key**. Nicht die
CI ist der Risikopfad, sondern der manuelle Test in der Preview und die Live-Site.

Das ist keine Verschärfung der Lage, sondern eine Präzisierung: die Maßnahme muss an der
Frontend-/Netlify-Konfiguration ansetzen, nicht an den Workflows.

---

## 1. Bestandsaufnahme

### 1.1 Supabase-Projektstruktur

**Fakt** (abgefragt am 08.08.2026):

| | |
| --- | --- |
| Organisation | `Voxera` (`kvjhyaevtjdupymdcxql`), **Plan: Pro** |
| Projekte in der Org | 2 |
| Produktion | `ulcofbgrovgcvowdjrge` — „info@voxera.ch's Project", `eu-central-2`, PostgreSQL 17.6.1 |
| Zweites Projekt | `uuvfmufhofuhzdnidabf` — „Finanzpilot", angelegt 28.05.2026 |

**„Finanzpilot" ist kein Staging.** Der Name deutet auf ein separates Vorhaben; es hat keine
Verbindung zum Voxera-Code (kein Repo-Verweis, andere Anlagezeit). *Falls das nicht stimmt und
das Projekt frei ist, wäre es ein Kandidat — bitte kurz bestätigen.*

**Fakt:** Es existiert **kein Staging-Projekt und kein Supabase-Branch.** Der Aufruf
`list_branches` läuft in einen Fehler, was bei nicht aktivierter Branching-Integration das
erwartete Verhalten ist (**Wahrscheinlich**: Branching ist schlicht nie eingeschaltet worden).

**Fakt — Umfang des Schemas** (das ist der Aufwandstreiber jeder Option):

| Objekt | Anzahl |
| --- | --- |
| Tabellen `public` | 43 |
| Funktionen `public` | 23 |
| RLS-Policies `public` | 111 |
| Trigger `public` (nicht-intern) | 12 |
| Storage-Buckets | 7 (`avatars`, `e-mail-asset`, `legal`, `Public`, `call-recordings`, `invoice-pdfs`, `voice-previews`) |

### 1.2 Der wunde Punkt: das Migrations-Ledger

**Fakt:** `supabase_migrations.schema_migrations` enthält **7 Einträge, alle vom 08.08.2026**:

```
20260808031625  ai_change_requests_tenant_isolation_reassert
20260808032146  notifications_rls_current_customer_id
20260808033650  drop_legacy_ensure_user_profile_overload
20260808040253  p0_security_foundation_catchup
20260808114412  ci_security_verifier_role
20260808122741  ci_security_verifier_role_census_v2
20260808151344  customer_effective_greeting
```

Im Repo liegen dagegen 17 Dateien unter `supabase/migrations/` und **über 60** unter
`supabase/sql/`. Es gibt kein `supabase/config.toml`, also keinen CLI-Projekt-Link — SQL wurde
bisher manuell im Editor bzw. über den Connector eingespielt.

**Das ist derselbe Befund, der laut Kommandozentrale schon einmal Root Cause war:** Die
P0-Security-Migration galt wochenlang als „live verifiziert", war auf der DB aber nie wirksam,
weil es kein Ledger gab, das den Unterschied hätte sichtbar machen können.

**Für dieses Konzept heißt das:** Der heutige Produktionsstand ist **nicht aus dem Repo
reproduzierbar.** Wer heute ein leeres Supabase-Projekt anlegt und `supabase db push` laufen
lässt, bekommt nicht die Produktion, sondern ein Fragment. Eine **Baseline-Migration** (ein
Schema-Dump der Produktion, als `0000_baseline.sql` ins Repo, Ledger darauf neu aufgesetzt) ist
deshalb **gemeinsame Vorbedingung der Optionen 1 und 4** — und der größte Einzelposten.

Positiver Nebeneffekt: Dieselbe Baseline schließt die Lücke, die den P0-Vorfall ermöglicht hat.
Der Posten zahlt auf zwei Launch-Kriterien gleichzeitig ein.

### 1.3 Wie Testdaten heute von echten Daten unterschieden werden

**Direkte Antwort: gar nicht — jedenfalls nicht strukturell.**

**Fakt:** Eine Suche über *alle* Spalten *aller* Tabellen nach `%test%`, `%demo%`, `%env%`,
`%sandbox%`, `%seed%` liefert genau zwei Treffer, und beide bedeuten etwas anderes:
`customers.activation_test_mode` und `customers.activation_test_candidate_call_id` — das ist der
Aktivierungs-Testanruf eines Kunden, ein Produktfeature, kein Umgebungsmerkmal.

Es gibt **keine** `is_test`-, `is_demo`- oder `environment`-Spalte. Nirgends.

**Fakt — der gesamte Datenbestand der Produktions-DB:**

| Tabelle | Zeilen |
| --- | --- |
| `customers` | 4 |
| `calls` | 13 |
| `invoices` | 11 |
| `contracts` | 6 |
| `voxera_cases` | 6 |
| `offers` | 5 |
| `subscriptions` | 4 |
| `telephony_numbers` | 4 |
| `auth.users` | 3 |
| `admins` | 1 |
| `customer_tasks` | 0 |

Und alle vier Kunden:

| ID | Name | E-Mail | Status | Twilio-Nr. | ElevenLabs-Agent |
| --- | --- | --- | --- | --- | --- |
| `cust_1786034079785_z8voxt` | E2E Test AG | yildirim.u92@gmail.com | invited | **+41445052800** | **ja** |
| `cust_1786038570979_7r8y29` | E2E 2 Test AG | uy@bluewin.ch | onboarding | – | nein |
| `cust_1786042447224_k879a8` | E2E 3 Test AG | umuty@icloud.com | onboarding | – | nein |
| `cust_1786050506781_pswyft` | E2E 4 Test AG | info@voxera.ch | onboarding | – | nein |

**Die einzige Unterscheidung ist die Namenskonvention „… Test AG" im Freitextfeld
`customer_name`.** Kein Constraint erzwingt sie, keine Query verlässt sich darauf, keine
UI zeigt sie als Kennzeichen an.

Zwei Dinge daran sind bemerkenswert:

1. **Die Bestandsaufnahme fällt heute günstig aus.** Es gibt *ausschließlich* Testdaten in der
   Produktions-DB. Der Zeitpunkt, an dem eine Trennung noch billig ist, ist **jetzt** — solange
   nichts migriert werden muss, was echten Kunden gehört.
2. **Testdaten verbrauchen bereits echte Ressourcen.** Testkunde 1 hat eine reale Twilio-Nummer
   und einen realen ElevenLabs-Agent. Eine DB-Trennung allein trennt diese Seite *nicht* mit.

### 1.4 Netlify-Setup und Deploy-Previews

**Fakt:** Zwei Sites, je eigene `netlify.toml`.

| | Customer Dashboard | Admin Panel |
| --- | --- | --- |
| Functions | 37 | 51 |
| Scheduled Functions | `cleanup-stale-calls` (`*/5`), `enforce-data-retention` (`17 3 * * *`) | `outbox-retry-worker` (`*/5`), `daily-billing-runner` (`0 6`), `lifecycle-runner` (`15 4`) |
| `[context.*]`-Blöcke | keine | keine |

**Fakt:** Rund 25 verschiedene Env-Variablen im Einsatz, angeführt von `SUPABASE_URL` (80
Referenzen), `SUPABASE_SERVICE_ROLE_KEY` (78) und `SUPABASE_ANON_KEY` (59). Netlify vererbt
Site-Env-Variablen standardmäßig an **alle** Kontexte, also auch an Deploy-Previews.

**Wahrscheinlich** (dokumentiertes Netlify-Verhalten, für dieses Konto nicht einzeln geprüft):
Scheduled Functions laufen nur auf Production-Deploys, nicht in Previews. Das ist die einzige
faktisch vorhandene Trennung heute — und sie ist von der Plattform geerbt, nicht von uns gebaut.
Die fünf Cronjobs oben sind damit nicht der akute Risikopfad; die 88 HTTP-Functions sind es.

**Fakt — was aus einer Preview heraus real passieren kann**, weil dieselben Keys wirken:

| Wirkung | betroffene Dateien |
| --- | --- |
| E-Mail-Versand (Make-Webhook / SMTP / nodemailer) | 9 |
| ElevenLabs-Agent anlegen, ändern, synchronisieren | 8 |
| Twilio: Nummernzuweisung, echter ausgehender Testanruf | 3 |
| Harter Kundenlöschung inkl. `auth.users` | `admin-panel/netlify/functions/customer-delete-permanently.js` |

Beim letzten Punkt lohnt der Blick in die Datei: sie löscht kaskadierend über elf Tabellen. Der
einzige Schutz ist eine Rollenprüfung (`owner`) — die in einer Preview genauso besteht wie in
Produktion, weil es dieselbe Auth-Instanz ist.

**Unverifiziert:** Ob Deploy-Previews passwortgeschützt sind, ob Branch-Deploys aktiv sind, und
die genaue Env-Variablen-Belegung pro Site. Dafür fehlt in dieser Session ein Netlify-Zugang;
alles oben stammt aus dem Repo und aus Supabase. **Vor einer Entscheidung sollten diese drei
Punkte im Netlify-Dashboard nachgesehen werden** — sie ändern die Aufwände unten nicht, aber
Punkt 1 ändert, wie exponiert die heutige Lage tatsächlich ist.

### 1.5 Backup — angrenzend, hier nicht gelöst

**Wahrscheinlich:** Der Pro-Plan beinhaltet tägliche Backups mit 7 Tagen Aufbewahrung; PITR ist
kostenpflichtiges Add-on. **Unverifiziert:** ob Backups tatsächlich laufen und ob je ein Restore
getestet wurde. Die Kommandozentrale führt das als eigenen offenen Punkt; er bleibt hier offen,
gehört aber sachlich in dieselbe Umsetzung (ein Restore-Test *ist* das Befüllen eines
Staging-Projekts).

### 1.6 Default-Privilegien: Staging und Produktion weichen ausgerechnet hier ab

Gefunden am 10.08.2026 beim Prüfen des offenen Review-Threads auf PR #896
(`db_security_invariants`, TRUNCATE-Sweep). Zwei Befunde, beide gegen die
Live-Datenbanken gemessen, nicht aus dem Repo hergeleitet.

**Befund A — der TRUNCATE-Sweep aus PR #892 war grantor-gebunden. Für TRUNCATE
war das bekannt und abgesichert; für die vier übrigen Verben nicht.**

*Korrektur gegenüber der ersten Fassung dieses Abschnitts:* Beim genaueren Lesen
von `2026-08-09_truncate_grant_sweep.sql` und dem zugehörigen Katalog-Check
(im Rahmen von PR #892) stellte sich heraus, dass der `supabase_admin`-Rest
**kein unbemerkter blinder Fleck war**, sondern im Migrationskommentar
ausdrücklich als „bekannte Restluecke, bewusst so belassen" dokumentiert ist —
inklusive des Versuchs, sie zu schliessen (`42501 permission denied to change
default privileges`, ausprobiert und dokumentiert, nicht vermutet) und einer
benannten Kompensation. Die Kompensation ist real: der „Bestandscheck" im
Katalog (`db_security_invariants_catalog.sql`, der `pg_class`-Sweep über alle
Tabellen in `public`) misst die **effektive** TRUNCATE-Berechtigung je Tabelle
via `has_table_privilege()` — unabhängig davon, welcher Default-ACL-Eintrag sie
verursacht hat. Entstünde je eine Tabelle unter `supabase_admin`, würde dieser
Check sie beim nächsten Lauf melden. Für TRUNCATE gilt der ursprüngliche Satz
„trifft nur zur Hälfte zu" also nicht — die andere Hälfte ist bewusst
akzeptiert und beobachtet, nicht übersehen.

```sql
select pg_get_userbyid(defaclrole) as grantor, defaclobjtype, defaclacl::text
from pg_default_acl
where defaclnamespace::regnamespace::text = 'public' and defaclobjtype = 'r';
```

Gemessen auf `ulcofbgrovgcvowdjrge` (Produktion):

| Grantor | ACL für `anon` / `authenticated` auf künftige Tabellen |
| --- | --- |
| `postgres` | `arwdxtm` |
| `supabase_admin` | `arwd**D**xtm` |

**Was tatsächlich offen bleibt:** Dieselbe Rundum-Absicherung existiert nur für
TRUNCATE. Für INSERT, SELECT, UPDATE, DELETE (`arwd`) — die für **beide**
Grantoren weiterhin an künftige Tabellen gehen — gibt es weder einen
Default-ACL-Wurzelcheck noch einen `pg_class`-Bestandscheck über alle Tabellen.
Jeder andere `has_table_privilege`/`has_column_privilege`-Aufruf im Katalog
zielt auf eine feste, benannte Tabelle (`customers`, `calls`, `system_config`)
— eine Positivliste, kein Sweep. Eine neu angelegte Tabelle mit offenem SELECT
für `authenticated` würde von nichts im Repo erfasst, bis sie jemand von Hand
in eine dieser Listen einträgt. Das ist die substanzielle Lücke, nicht die
`supabase_admin`-Restluecke bei TRUNCATE.

Zusätzlich am 10.08. frisch gemessen, zwei kleinere, unbestätigte Verdachtsmomente
aus PR #892 ausgeräumt: Aktuell trägt kein Default-ACL für `public` einen Eintrag
für die Pseudorolle `PUBLIC` (jeder Grantee ist eine benannte Rolle), und es
existiert keine partitionierte Tabelle (`relkind='p'`) in `public`. Beide
Codex-Befunde auf #892 sind damit heute nicht ausgenutzt, aber die zugrunde
liegende Prüflücke im Katalog (nur `relkind='r'`, nur benannte Rollen als
Grantee) besteht weiter.

**Befund B — Staging ist für genau diese Prüfung ungeeignet.** Dieselbe
Abfrage gegen `voxera-staging` (`hzqiyyqfchvfcmmbemvd`, angelegt 08.08.)
liefert **keine einzige Zeile**. Dort vergeben neu angelegte Tabellen von
vornherein nichts an `anon`/`authenticated` — vermutlich, weil neuere
Supabase-Projekte diese permissiven Default-ACLs nicht mehr mitbringen
(nicht verifiziert, für die Sache ohne Belang).

**Konsequenz für dieses Konzept:** Staging und Produktion unterscheiden sich in
genau der Eigenschaft, die eine Rechte-Migration prüfen soll. Eine Migration,
die auf Staging sauber aussieht — keine offenen Grants auf einer neuen Tabelle —
kann in Produktion trotzdem eine offene Tabelle hinterlassen, weil die
Ausgangslage der beiden Umgebungen verschieden ist. Für Migrationen, die
Tabellen anlegen oder Grants ändern, ist ein grüner Staging-Lauf **kein**
Nachweis, dass Produktion ebenso grün wäre. Jede Option in diesem Konzept, die
Staging als Vorprüfung für produktionswirksame Migrationen vorsieht, muss diese
Divergenz entweder auflösen (Staging auf denselben Default-ACL-Stand bringen)
oder ausdrücklich als Lücke benennen.

Nicht Teil dieses Punktes: ob und wie die fehlenden `revoke`-Anweisungen
nachgezogen werden. Das ist Gegenstand des offenen Threads auf PR #896 selbst.

---

## 2. Optionen

Alle Aufwände in Arbeitstagen, gerechnet für eine Person mit Kontextwissen.

### Gemeinsame Vorbedingung — vorab sichtbar machen

Zwei Posten fallen in mehreren Optionen an und sollten nicht in einer einzelnen Option
versteckt werden:

| Posten | Aufwand | nötig für |
| --- | --- | --- |
| **V1 — Baseline-Migration** Schema-Dump der Produktion als `0000_baseline.sql`, Supabase-interne Schemas ausklammern, Ledger konsistent aufsetzen, `supabase/sql/` und `supabase/migrations/` zusammenführen | **1–1.5 Tage** | Option 1, Option 4 |
| **V2 — Frontend-Config auslagern** `SUPABASE_URL`/`ANON_KEY` aus den 5 HTML-Dateien lösen. Die Dateien haben >9000 Zeilen und es gibt keinen Build-Schritt (`command = "echo 'Deploy successful'"`), also braucht es entweder einen Runtime-Config-Endpunkt oder einen minimalen Injektions-Schritt im Build | **0.5–1 Tag** | Option 1, Option 3, Option 4 |

---

### Option 1 — Eigenes Staging-Supabase-Projekt

Zweites Projekt `voxera-staging` in derselben Org. Produktion und Staging teilen nur noch das
Repo.

**Aufwand: 3–5 Tage** · **Kosten: ~$10/Monat** (per `get_cost` für ein zusätzliches Projekt in
dieser Org bestätigt)

| Teilposten | Tage |
| --- | --- |
| V1 Baseline-Migration | 1–1.5 |
| Projekt anlegen, Baseline einspielen, 111 Policies / 23 Funktionen / 12 Trigger / 7 Buckets nachziehen, mit `verify-db-security-invariants.mjs` gegen Staging gegenprüfen | 0.5–1 |
| V2 Frontend-Config auslagern | 0.5–1 |
| Netlify-Env pro Kontext setzen (2 Sites, ~25 Variablen), zweiter Secrets-Satz | 0.5 |
| Seed-Daten für Staging, ein E2E-Durchlauf zur Verifikation | 0.5–1 |

**Dafür:**
- Löst das Problem an der Wurzel. Kein Pfad führt mehr von einem PR zu Kundendaten.
- Der bestehende `verify-db-security-invariants`-Check wird dadurch *mehr* wert, nicht weniger:
  er kann künftig auch auf PRs gegen Staging laufen — genau das, was `DB_SECURITY_CI_SETUP.md`
  heute aus guten Gründen ausschließen muss.
- Migrationen werden vor Produktion erstmals irgendwo geprobt. Genau die Fehlerklasse des
  P0-Vorfalls.
- Der Restore-Test aus 1.5 fällt praktisch als Nebenprodukt an.

**Dagegen:**
- Der Fahrplan beziffert die Staging-Trennung mit **1–2 Tagen**. Für diese Option ist das
  **zu niedrig** — die Ledger-Lücke war zum Zeitpunkt der Schätzung noch nicht beziffert.
  Realistisch 3–5 Tage. Das ist die wichtigste Korrektur dieses Dokuments.
- Dauerhafter Pflegeaufwand: zwei Projekte driften auseinander, sobald jemand einmal direkt auf
  Produktion arbeitet. Der Ledger-Check muss dann auf beide laufen.
- **Trennt Twilio, ElevenLabs und Make nicht mit.** Ein Testanruf aus Staging kostet echtes
  Guthaben und läuft über eine echte Nummer. Vollständige Trennung (zweiter Twilio-Subaccount,
  eigener ElevenLabs-Testagent, zweiter Make-Webhook): **+1–2 Tage**, kann später nachgezogen
  werden.
- Zwei Sätze Secrets zu verwalten — mit dem noch fehlenden Key-Rotation-Prozess (offener Punkt
  im Sicherheits-Tab) ein zusätzlicher Posten.

---

### Option 2 — Kennzeichnung und Guards innerhalb derselben DB

`customers.is_test boolean not null default false`, Backfill für die vier bestehenden Kunden,
Guards in den destruktiven Functions, sichtbare Kennzeichnung in der Admin-UI, dazu ein
schriftliches Test-Protokoll.

**Aufwand: 1–2 Tage** · **Kosten: $0**

| Teilposten | Tage |
| --- | --- |
| Spalte + Backfill + `NOT NULL DEFAULT false` | 0.25 |
| Guards in `customer-delete-permanently`, `enforce-data-retention`, `daily-billing-runner`, `lifecycle-runner` | 0.5 |
| Admin-UI: Filter und sichtbare Kennzeichnung | 0.5 |
| Test-Protokoll dokumentieren | 0.25 |

**Dafür:**
- Billig, schnell, kein neues Projekt, keine Schema-Duplikate, keine Drift.
- Macht die heutige Namenskonvention zu etwas, worauf sich Code verlassen darf.
- Nützlich in **jeder** Zielarchitektur — auch mit Staging will man Testkunden in Produktion
  markieren können.

**Dagegen — und das ist der entscheidende Punkt:**

Diese Option **löst das eigentliche Risiko nicht.** Das Risiko ist nicht „Testzeilen und echte
Zeilen liegen nebeneinander". Es ist „ein Preview-Deploy hat einen Produktions-Service-Role-Key".
Ein Flag *in einer Zeile* schützt nicht gegen:

- eine fehlerhafte Migration oder einen Schema-Reset — DDL kennt kein `is_test`. **Exakt die
  Operation, die laut Kommandozentrale im Verdacht steht, die P0-Policies zurückgesetzt zu
  haben;**
- `enforce-data-retention` mit falschem Cutoff (die Function filtert auf `created_at`, sonst
  nichts);
- einen Bug im Guard selbst — bei 88 Functions ohne einen einzigen bestehenden Guard ist die
  Wahrscheinlichkeit, alle relevanten Pfade zu treffen, nicht hoch;
- Löschungen in `auth.users`, wo die Spalte gar nicht existiert.

**Als alleinige Antwort auf das Launch-Kriterium halte ich das nicht für tragfähig.** Als
Ergänzung ist es gut und günstig.

---

### Option 3 — Deploy-Previews entschärfen, statt eine zweite Umgebung zu bauen

Der Preview-Kontext bekommt schlicht **keine Produktions-Credentials mehr**. Env-Variablen in
Netlify werden auf den Production-Kontext eingeschränkt, die Frontend-Config kommt zur Laufzeit
statt hartkodiert, und Previews werden zusätzlich passwortgeschützt. Previews werden damit zu
reinen **UI-Previews**: Layout, Navigation, Design-System — sichtbar. Alles, was Daten braucht —
tot.

**Aufwand: 1–1.5 Tage** · **Kosten: $0**

| Teilposten | Tage |
| --- | --- |
| V2 Frontend-Config auslagern | 0.5–1 |
| Netlify-Env auf `production`-Kontext scopen (2 Sites) | 0.25 |
| Preview-Passwortschutz aktivieren | 0.1 |
| Sauberer Fehlerzustand statt kaputter Seite, wenn Config fehlt | 0.25 |

**Dafür:**
- **Bestes Verhältnis von Risikoreduktion zu Aufwand.** Entfernt den heute wahrscheinlichsten
  Unfallpfad, ohne irgendetwas zu duplizieren.
- Braucht **kein** V1 — also keine Baseline-Migration, keine Ledger-Arbeit.
- Passt zur aktuellen Arbeitslast: die sechs launch-kritischen Etappen sind fast durchgehend
  Design- und Navigationsarbeit. Genau dafür reicht eine UI-Preview.
- Die Arbeit ist in Option 1 vollständig enthalten (V2), also kein verlorener Aufwand, sondern
  eine Vorauszahlung.

**Dagegen:**
- **Funktionale PR-Tests entfallen ersatzlos.** Wer einen Billing-Lauf, den Call-Intake oder
  einen Vertragsabschluss testen will, muss dann direkt auf Produktion testen — und ist genau
  dort, wo man nicht sein wollte. Der geplante End-to-End-Test (2–3 Tage im Fahrplan) wird davon
  betroffen sein.
- Keine Lösung für Migrationen: die gehen weiterhin ungeprobt nach Produktion.
- Als Dauerzustand nicht tragfähig. Als Zwischenschritt gut.

---

### Option 4 — Supabase Branching pro Pull Request *(Ausblick, nicht für jetzt)*

Supabase legt zu jedem PR automatisch eine eigene Datenbank aus `supabase/migrations/` an.

**Aufwand: 5–8 Tage** · **Kosten: $0.01344/h pro laufendem Branch** (bestätigt), also ~$0.32 pro
Tag und offenem PR — nur solange der Branch existiert.

**Dafür:** Das architektonisch richtige Modell. Jeder PR bekommt eine echte, frische DB;
Migrationen werden zwangsläufig geprobt, weil der Branch sonst gar nicht erst hochkommt.

**Dagegen:** Setzt V1 zwingend voraus — ein Branch *ist* nichts anderes als „Migrationen von
Null angewandt", und mit 7 von über 60 Migrationen im Ledger entsteht daraus kein
funktionierendes System. Dazu kommt der Teil, den Option 1 nicht hat: die Branch-Credentials
wechseln pro PR und müssen automatisiert in die Preview injiziert werden (Netlify-Build-Plugin
oder die Supabase-Netlify-Integration). Das ist der eigentliche Aufwandstreiber.

**Einschätzung: richtig, aber nicht jetzt.** Vor dem Pilot bindet das Tage, die in den sechs
launch-kritischen Etappen fehlen. Nach dem Pilot ein guter Kandidat — und dann deutlich
billiger, weil V1 dann längst erledigt ist.

---

## 3. Vergleich

| | Opt. 1 Staging-Projekt | Opt. 2 Kennzeichnung | Opt. 3 Previews entschärfen | Opt. 4 Branching |
| --- | --- | --- | --- | --- |
| Aufwand | 3–5 Tage | 1–2 Tage | 1–1.5 Tage | 5–8 Tage |
| Laufende Kosten | ~$10/Mt. | $0 | $0 | ~$0.32/Tag/PR |
| Braucht V1 (Baseline) | **ja** | nein | nein | **ja** |
| Preview kann Kundendaten anfassen | nein | ja | nein | nein |
| Migration wird vorab geprobt | ja | nein | nein | ja |
| Funktionale PR-Tests möglich | ja | ja | **nein** | ja |
| Schützt gegen Schema-Reset | ja | **nein** | teilweise | ja |
| Trennt Twilio/ElevenLabs/Make | nein (+1–2 Tage) | nein | nein | nein |
| Löst das Launch-Kriterium | **ja** | nein | teilweise | ja |

---

## 4. Empfehlung

**Gestuft, nicht entweder/oder — Option 3 sofort, Option 1 vor dem Pilotkunden.**

1. **Jetzt: Option 3 (1–1.5 Tage).** Der größte Teil des heutigen Risikos verschwindet für
   wenig Geld, und der Hauptposten darin (V2) ist in Option 1 ohnehin enthalten. Kein verlorener
   Aufwand. Solange die verbleibende Arbeit überwiegend Design ist, kostet der Verlust
   funktionaler Previews wenig.

2. **Vor dem ersten Pilotkunden: Option 1 (3–5 Tage, davon 1–1.5 bereits durch V2 vorgezogen,
   also real noch 2.5–4).** Das ist die Maßnahme, die das Launch-Kriterium tatsächlich erfüllt.
   Der Zeitpunkt sollte **vor** dem geplanten End-to-End-Test liegen — sonst wird der E2E-Test
   erneut gegen Produktion gefahren und erzeugt genau die Datenlage, die man später trennen muss.

3. **Beiläufig mitnehmen: das `is_test`-Flag aus Option 2** (0.25 Tage nur für Spalte und
   Backfill). Auch mit Staging bleibt es sinnvoll, Testkunden in Produktion markieren zu können.
   Die UI- und Guard-Anteile aus Option 2 sind mit Staging entbehrlich.

4. **Nach dem Pilot: Option 4 neu bewerten.** Dann ist V1 erledigt und die Option kostet nur
   noch die Integrationsarbeit.

**Nicht empfohlen: Option 2 allein.** Sie liest sich wie eine Lösung, adressiert aber nicht den
Pfad, über den der Schaden real entstehen würde.

### Auswirkung auf die Zeitschätzung

Der Fahrplan führt „Staging von Produktion trennen" mit **1–2 Tagen**. Nach dieser Aufnahme:

| Weg | Aufwand |
| --- | --- |
| Empfehlung (3 → 1, ohne Twilio/ElevenLabs) | **4–6 Tage** |
| nur Option 3 | 1–1.5 Tage |
| nur Option 2 | 1–2 Tage (löst das Kriterium nicht) |

Gegenüber dem Fahrplan sind das **+2 bis +4 Tage** auf die launch-kritische Summe (17–28).
Grund ist nicht die Trennung selbst, sondern die Ledger-Lücke aus 1.2, die bei der bisherigen
Schätzung noch nicht beziffert war. Ein Teil davon wäre ohnehin angefallen — die Baseline
schließt die Lücke, die den P0-Vorfall ermöglicht hat.

---

## 5. Was offen bleibt

**Zu entscheiden:**
1. Option 3 sofort, oder direkt auf Option 1 gehen?
2. Externe Dienste (Twilio, ElevenLabs, Make) mit trennen oder bewusst später? (+1–2 Tage)
3. Ist das Supabase-Projekt „Finanzpilot" wirklich fremd, oder verfügbar?
4. Siehe 1.6: Soll Staging auf denselben Default-ACL-Stand wie Produktion gebracht
   werden, damit ein grüner Staging-Lauf bei Rechte-Migrationen wieder aussagekräftig
   ist — oder wird die Divergenz bewusst stehengelassen und jede Rechte-Migration
   separat gegen Produktion geprüft?

**Vor der Umsetzung im Netlify-Dashboard nachzusehen** (siehe 1.4 — ändert die Aufwände nicht,
aber die Einschätzung der heutigen Exponiertheit):
1. Sind Deploy-Previews passwortgeschützt oder öffentlich erreichbar?
2. Sind Branch-Deploys aktiv?
3. Welche Env-Variablen sind pro Site tatsächlich gesetzt, und in welchen Kontexten?

**Bewusst nicht Teil dieses Konzepts:** Backup/Restore-Test (eigener Punkt in der
Kommandozentrale, überschneidet sich aber mit Option 1), API-Key-Rotation, Error-Tracking.
