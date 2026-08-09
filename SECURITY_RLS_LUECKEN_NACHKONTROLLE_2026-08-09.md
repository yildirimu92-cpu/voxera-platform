# Nachkontrolle der RLS-Nebenfunde aus PR #830 (`calls`, `system_config`)

**Datum:** 2026-08-09
**Anlass:** Briefing "RLS-Lücken bei `calls` und `system_config` schliessen"
**Datenbank:** Produktion (`ulcofbgrovgcvowdjrge`), alle Messungen live gegen die echte DB

## Ergebnis in drei Sätzen

Beide im Briefing genannten Lücken sind **bereits geschlossen** — der P0-Nachzug
(PR #833) hat sie mitgenommen, die Notiz aus der PR-#830-Diagnose war veraltet.
Beim Nachmessen ist stattdessen ein **anderer, echter Befund** aufgefallen: `anon`
und `authenticated` konnten `public.system_config` **truncieren**, `authenticated`
zusätzlich `public.calls` — und auf `TRUNCATE` wird RLS nicht angewandt, dort gab
es also gar keine zweite Schutzschicht. Das ist behoben, auf Produktion angewandt
und im 6-Stunden-Cron als harte Invariante verankert.

---

## 1. Diagnose: der tatsächliche Stand, nicht die Notiz

Das Briefing warnte ausdrücklich davor, von der alten Notiz auszugehen. Genau das
war richtig — beide Punkte stimmen nicht mehr.

### Befund 1 — `calls`: `authenticated` hat kein INSERT (mehr)

| Gemessen | Ergebnis |
|---|---|
| Tabellen-Grant `INSERT` für `authenticated` | **nicht vorhanden** |
| Echter `INSERT`-Versuch als Nicht-Admin (zurückgerollt) | `42501 insufficient_privilege` |
| Echter `INSERT`-Versuch als **Admin** (zurückgerollt) | `42501` — auch der Admin kommt nicht durch |

Geschlossen durch `2026-08-08_p0_security_foundation_catchup.sql`, Abschnitt 4
("Schreibpfad gehört dem Server"). Die Migration steht im Ledger
(`20260808040253`), ist also nachweislich angewandt — anders als die
ursprüngliche P0-Migration vom 28.07., die genau daran gescheitert war.

**Keine Diskrepanz zwischen Repo-Migration und DB-Zustand.** Das im Briefing
vermutete Fehlerbild des ursprünglichen P0-Vorfalls liegt hier *nicht* vor. Der
Ledger-Abgleich Repo → DB ist für alle 8 nachverfolgten Migrationen grün.

### Befund 2 — `system_config`: `anon` hat kein SELECT (mehr)

| Gemessen | Ergebnis |
|---|---|
| Tabellen-Grant `SELECT` für `anon` | **nicht vorhanden** |
| Echter Lesezugriff als `anon` | `42501 insufficient_privilege` |
| Policy `system_config_admin_select` | vorhanden, `for select to authenticated using (is_admin(auth.uid()))` |
| Echter Lesezugriff als **Nicht-Admin** `authenticated` | 0 von 3 Zeilen |
| Gegenkontrolle: Lesezugriff als **Admin** | 3 von 3 Zeilen |

Ebenfalls geschlossen durch den P0-Nachzug, Abschnitt 5. Die Policy existiert
nicht nur im Repo, sie wirkt auch — beides einzeln nachgemessen.

### Warum hatte `anon` überhaupt SELECT?

Die Frage aus dem Briefing ("nötig oder Versehen?") lässt sich klar beantworten:
**Versehen, genauer: Supabase-Default.** Es gibt im gesamten Repo keine Stelle,
die `system_config` mit dem anon-Key liest. Alle Lesepfade wurden einzeln geprüft:

| Fundstelle | Rolle | Betroffen? |
|---|---|---|
| `admin-panel/netlify/functions/prompt-preview.js` | `service_role` | nein (RLS-frei) |
| `admin-panel/netlify/functions/trigger-elevenlabs-sync.js` | `service_role` | nein |
| `customer-dashboard/netlify/functions/customer-assistant-profile.js` | `service_role` | nein |
| `customer-dashboard/netlify/functions/customer-update-assistant.js` | `service_role` | nein |
| `admin-panel/index.html` (`.from('system_config').select('key,value')`) | `authenticated` (Admin) | ja — läuft über die Policy |
| **Schreibpfad aus einem Browser** | — | **existiert nicht** |

Es hängt also nichts an einem öffentlichen Lesezugriff. Das Kunden-Dashboard liest
`system_config` nie direkt; `core_field_steps` kommt dort über die Netlify-Function
(service_role) an.

---

## 2. Der eigentliche neue Befund: TRUNCATE kennt kein RLS

Der P0-Nachzug hat auf `system_config` gezielt nur `revoke select` ausgeführt,
nicht `revoke all`. Übrig blieben die Supabase-Defaults:

```
anon          → DELETE, INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
authenticated → dieselben + SELECT
```

Für `INSERT`/`UPDATE`/`DELETE` hält RLS das tatsächlich zurück — real nachgemessen
(alles zurückgerollt): `INSERT` als `anon` scheitert mit `42501`, `UPDATE` und
`DELETE` treffen 0 von 3 Zeilen.

**`TRUNCATE` ist die Ausnahme: darauf werden Policies gar nicht angewandt.** Das
Grant ist die einzige Hürde. Gemessen (ebenfalls zurückgerollt):

| Rolle | Tabelle | vorher |
|---|---|---|
| `anon` | `system_config` | **TRUNCATE ging durch** |
| `authenticated` | `system_config` | **TRUNCATE ging durch** |
| `authenticated` | `calls` | **TRUNCATE ging durch** |
| `anon` | `calls` | blockiert (`42501`) |

Bei `system_config` beträfe das `prompt_master_l1`, `core_field_steps` und
`default_assistant_name` — also die Grundlage jedes Assistenten-Prompts.

### Einordnung — nicht grösser machen als es ist

Über die öffentliche Angriffsfläche ist das **heute nicht erreichbar**. `anon` und
`authenticated` sind nur über PostgREST/Realtime/Storage annehmbar, und keines
davon setzt je ein `TRUNCATE` ab; der anon-Key ist ein JWT für PostgREST, kein
Datenbank-Passwort. Es ist eine Grant-Hygiene-Lücke, kein offenes Tor — aber eine,
deren einzige Schutzschicht ausgerechnet die ist, die hier nicht greift.

---

## 3. Fix

`supabase/migrations/2026-08-09_system_config_calls_residual_grants.sql`

* `system_config`: `revoke all` von `public`, `anon`, `authenticated`; danach
  gezielt `grant select` an `authenticated` (Admin-Portal) und der volle
  Schreibpfad an `service_role`. RLS und die Policy bleiben unangetastet.
* `calls`: **nur** `revoke truncate`. Ein `revoke all` hätte hier den Lesepfad des
  Dashboards und die Spalten-Allowlist mitgerissen.

Angewandt auf Produktion am 2026-08-09, im Ledger als
`system_config_calls_residual_grants`.

### Verifikation — dieselbe Methode wie beim P0-Vorfall

| Schritt | Ergebnis |
|---|---|
| **Preflight-Dry-Run**: Migrationsrumpf in einer zurückgerollten Subtransaktion auf der echten Tabelle, danach ACLs und Verhalten gemessen | 7/7 PASS, sauber zurückgerollt |
| **Post-Migration** (`..._post_migration.sql`) | **17/17 PASS** — inkl. der Gegenrichtung ("was offen bleiben muss") |
| **Gegenprobe** (Laufzeitverhalten nach der Anwendung) | 6/6 PASS: Admin liest weiter 3/3, Nicht-Admin 0, `anon` `42501`, Kunde sieht weiter seine 13 Anrufe, beide TRUNCATE-Wege jetzt `42501` |
| **Mutationstests** (Grant/Policy zurückholen, prüfen ob der Check rot wird) | 4/4 PASS |
| **Nachkontrolle** nach den Mutationen | Ist-Zustand unverändert |

Der aufschlussreichste Mutationstest: `system_config_admin_select` wurde probeweise
durch eine gleichnamige Policy mit `using (auth.uid() is not null)` ersetzt. Unter
dieser Aufweichung sähe **jeder eingeloggte Nutzer alle 3 Zeilen** — der bisherige
F5-Check hätte das *nicht* bemerkt, weil er nur Name und Existenz prüft und der
`using(true)`-Check nicht greift (der Ausdruck ist nicht wörtlich `true`). Der neu
ergänzte Ausdrucks-Check schlägt dabei korrekt an.

---

## 4. 6-Stunden-Cron (PR #835): Abdeckung vorher/nachher

**Vorher bereits abgedeckt** — die Frage aus dem Briefing lässt sich also
grösstenteils mit "ja" beantworten:

* `F5-policies`: `system_config.system_config_admin_select`, `calls.calls_select_own`,
  `calls.calls_select_admin` (Existenz)
* `F5-policies`: keine `using(true)`-Policy auf `system_config`/`calls`
* `F6-grants`: `authenticated ohne INSERT auf calls`, `anon ohne SELECT auf system_config`
* `D-schreibsperre` (Laufzeit): `authenticated darf keine calls anlegen`,
  `anon darf system_config nicht lesen`, `anon darf keine calls anlegen`
* `H-baseline`: anon-/authenticated-Grants beider Tabellen eingefroren

**Neu ergänzt** (das, was tatsächlich fehlte):

| Ebene | Prüfung |
|---|---|
| `F6-grants` | `anon`/`authenticated` ohne `TRUNCATE` auf `system_config` und `calls` |
| `F6-grants` | `anon`/`authenticated` ohne `INSERT`/`UPDATE`/`DELETE` auf `system_config` |
| `F6-grants` | Gegenrichtung: `authenticated` behält SELECT, `service_role` behält den Schreibpfad |
| `F5-policies` | `system_config_admin_select` bindet **im Ausdruck** weiter an `is_admin(auth.uid())` |
| `F5-policies` | `system_config` trägt **genau eine** Policy |
| `D3-system-config` (Laufzeit, neu) | Nicht-Admin sieht 0 Zeilen — geprüft mit Phantom-Subject **und** echtem Nicht-Admin |

Alle 15 neuen Katalog-Checks und alle 3 neuen Verhaltensproben wurden gegen die
Produktions-DB ausgeführt und sind grün.

**Bewusst nicht als Verhaltensprobe umgesetzt:** ein echter TRUNCATE-Versuch. Die
D-Proben entschärfen sich über `where false`; bei `TRUNCATE` geht das nicht. Eine
Probe, die im Fehlerfall die Tabelle leert, ist als Dauerlauf gegen Produktion
nicht vertretbar — deshalb steht TRUNCATE im Katalog, nicht im Verhaltensteil.

Die Baseline (`db-security-baseline.json`) wurde nachgezogen: `system_config` ist
aus `anonTableGrants` entfernt, bei `authenticated` auf `SELECT` reduziert,
`TRUNCATE` bei `calls` gestrichen. Damit fällt jeder neue Grant weiterhin auf.

---

## 5. Nebenfunde — dokumentiert, absichtlich **nicht** mitgefixt

Gemäss Auftragsabgrenzung ("dann dokumentieren, nicht mitfixen"):

1. **`authenticated` darf `public.users` truncieren.** Gleiche Klasse wie oben,
   andere Tabelle — real gemessen und zurückgerollt. Ebenfalls nur über eine
   direkte DB-Verbindung erreichbar, nicht über PostgREST. `customers` ist bereits
   geschützt (die P0-Härtung hat dort `revoke all` gemacht).
   *Empfehlung: in einem eigenen kleinen Schritt nachziehen, zusammen mit einer
   Durchsicht der übrigen 26 Tabellen aus der eingefrorenen anon-Baseline.*

2. **Fünf Migrationen liegen auf der Produktions-DB ohne Repo-Datei:**
   `outbox_dedupe_unique`, `prompt_fingerprint`, `elevenlabs_sync_queue`,
   `opening_hours`, `customer_voice_previews`. Der Ledger-Check des 6-Stunden-Crons
   (Richtung DB → Repo) meldet das zutreffend als **FAIL** — der Cron ist damit
   aktuell rot, und zwar unabhängig von dieser Arbeit. Das ist genau das Muster,
   vor dem der Fahrplan warnt: ein dauerhaft roter Check wird ignoriert und
   schützt dann nichts mehr. *Empfehlung: zeitnah klären und die fünf Migrationen
   nachdokumentieren.*

3. **`calls.calls_insert_service_or_admin` ist eine wirkungslose Policy.** Sie
   erlaubt Admins das Anlegen, aber das INSERT-Grant für `authenticated` ist
   zurückgenommen — gemessen: auch der Admin bekommt `42501`. Schadet nicht,
   ist aber irreführend.

4. **`public.calls` trägt drei Alt-Policies ohne Rollenbindung**
   (`"Calls: Read own + Admin"`, `"Calls: Update (Owner + Admin)"`,
   `admins_read_calls`), die über `public.users` statt über `current_customer_id()`
   gehen. Sie sind mandantengebunden und leaken nichts (geprüft), duplizieren aber
   die P0-Policies. Da Policies sich ODERn, ist jede zusätzliche Policy auf einer
   Mandantentabelle eine Stelle mehr, die man beim nächsten Umbau richtig
   verstehen muss.

5. **`authenticated` behält `DELETE` auf `calls`.** In der Baseline bewusst
   eingefroren; mangels DELETE-Policy von RLS ohnehin blockiert. Unverändert
   gelassen.

---

## 6. Nicht Teil dieser Arbeit

* Andere Tabellen als `calls` und `system_config` (siehe Nebenfunde 1 und 2).
* Der `p0-security-verification.yml`-Workflow (prüft Repo-Dateien) blieb
  unangetastet.
* Kein Eingriff in RLS-Policies — diese Migration ändert ausschliesslich Grants.
