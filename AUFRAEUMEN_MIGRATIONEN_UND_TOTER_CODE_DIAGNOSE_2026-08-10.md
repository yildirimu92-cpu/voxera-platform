# Diagnose: Migrations-Verzeichnis vereinheitlichen + toter/unerreichbarer Code

**Datum:** 2026-08-10
**Auftrag:** Aufräumarbeit, Diagnose ohne Umsetzung. (1) Bestandsaufnahme beider
Migrations-Verzeichnisse mit Zielbild und Migrationsplan. (2) Produktweite,
systematische Suche nach totem/unerreichbarem Code in Customer Dashboard und
Admin Portal, mit Vertrauensgrad pro Fund.
**Stand:** `fbe70d1` (main), Branch `claude/aufraemarbeit-t7bdmm`.
**Nichts gelöscht, nichts verschoben.** Dieses Dokument ist die einzige Änderung.

**Belegbasis:** vollständige Git-Historie (Shallow Clone per `git fetch
--unshallow` auf 4 826 Commits vervollständigt); `supabase_migrations.schema_migrations`
und lesende Katalogabfragen gegen die Produktions-DB `ulcofbgrovgcvowdjrge`;
statische Auswertung von 40 939 Zeilen `customer-dashboard/index.html`, 17 109
Zeilen `admin-panel/index.html`, 30 Shared-CSS/JS-Dateien im Customer Dashboard
und 33 im Admin Portal; Ausführung von `verify-migration-table-hardening.mjs`
gegen beide Verzeichnisse.

Aussagen sind nach AGENTS.md als **Fakt**, **Wahrscheinlich** oder
**Unverifiziert** gekennzeichnet.

---

## Kurzurteil

| Thema | Befund | Dringlichkeit |
| --- | --- | --- |
| Migrations-Verzeichnisse | Beide **aktiv beschrieben**, keines tot. Keine Namenskollision. Der eigentliche Sortierschlüssel ist nicht das Verzeichnis, sondern das Ledger | mittel |
| **Ledger-Namensdrift** | Der Repo↔DB-Abgleich steht **in beide Richtungen rot** — 4 + 6 Meldungen, **alle reine Namensdrift**, inhaltlich ist alles angewandt (gegen Produktion nachgemessen) | **hoch (Prozess)** |
| Verschiebe-Falle | Ein naives `git mv` von `supabase/sql/` nach `supabase/migrations/` macht **zwei heute grüne Security-Checks rot** (44 + 56 Meldungen) | hoch, wenn umgesetzt wird |
| Tote CSS-Klassen | Customer Dashboard: **800 von 1 825** Klassen ohne jede Laufzeitnutzung, **1 453 von 4 087 Regeln** (~4 550 Zeilen). Admin Portal: **77 von 682** (~131 Zeilen) | niedrig (kosmetisch), hoch als Lesbarkeitsschuld |
| Funktionen ohne Aufrufer | Customer Dashboard **143 von 1 545**, Admin Portal **35 von 815** | mittel |
| **Verschattete Funktionen** | 2 Fälle, bei denen eine tote Fassung eine lebende überschreibt — u. a. ein neutralisierter Stub, der **eine andere Rückgabeform** hat als der Gewinner | **hoch (Fehlerklasse)** |
| Die drei Beispiele aus dem Auftrag | **Alle drei bereits erledigt** — siehe Abschnitt B.6 | erledigt |

Der wichtigste Einzelfund ist **nicht** die Menge des toten Codes, sondern die
Ledger-Namensdrift: der einzige Check, der Repo und Datenbank gegeneinander
hält, steht aus einem harmlosen Grund rot. Ein dauerhaft roter Security-Check
verliert seine Signalwirkung genauso wie ein dauerhaft grüner — das ist
wörtlich die Fehlerklasse, die `docs/VERIFY_SKRIPTE_DIAGNOSE_2026-08-09.md` für
den Vorgängerbefund beschreibt.

---

# Teil A — Migrations-Verzeichnisse

## A.1 Bestandsaufnahme (Fakt)

| Verzeichnis | Dateien | Zeitraum (erste/letzte Anlage) | Namensschema |
| --- | --- | --- | --- |
| `supabase/migrations/` | **33** | 2026-05-24 … 2026-08-10 | `YYYY-MM-DD_slug.sql` |
| `supabase/sql/` | **67** | 2026-04-02 … 2026-08-09 | `YYYY-MM-DD_slug.sql` |
| `supabase/verification/` | 20 | — | Preflight / Post-Migration / Rollback + Baseline-JSON |

Das Briefing nennt 58 Dateien in `supabase/sql/`; **es sind heute 67.** Der
Bestand ist seit der letzten Zählung weiter gewachsen — zuletzt am 2026-08-09
(`2026-08-08_call_summary_correction.sql`, `2026-08-09_elevenlabs_sync_log_prev_values.sql`).

**Kollisionen — geprüft, keine gefunden (Fakt):**

- kein Basename kommt in beiden Verzeichnissen vor
- kein Slug (Dateiname ohne Datumspräfix) kommt in beiden vor
- vier Datumspräfixe treten in beiden auf (2026-08-01, -06, -08, -09) — das
  belegt **parallele Nutzung**, keine Ablösung

**Beide Verzeichnisse werden weiterhin beschrieben (Fakt):**

| | letzter schreibender Commit |
| --- | --- |
| `supabase/sql/` | `ada53ec` 2026-08-09 „N6: Weiterleitungs-Sync entschied nach Feldnamen statt nach Wirkung" |
| `supabase/migrations/` | `6d9e92f` 2026-08-10 „Geschäftsprofil entschlacken" (#905) |

**Keines der beiden ist faktisch tot.** Die Annahme aus dem Briefing, eines
könnte bereits stillgelegt sein, trifft nicht zu.

**Kein CLI-Link (Fakt):** `supabase/config.toml` existiert nicht, die Supabase
CLI steht in keinem `package.json`. Es gibt also keinen `supabase db push`-Pfad;
SQL wird manuell bzw. über den Connector eingespielt. Damit hat das Verzeichnis
heute **keine funktionale Bedeutung** — es ist reine Ablagekonvention. Genau
deshalb konnte die Zweiteilung so lange bestehen.

## A.2 Der eigentliche Sortierschlüssel ist das Ledger, nicht das Verzeichnis

**Fakt.** `supabase_migrations.schema_migrations` auf Produktion trägt heute
**27 Einträge** (abgefragt am 2026-08-09). Die Zuordnung zu Repo-Dateien:

| Herkunft der Repo-Datei | Anzahl |
| --- | --- |
| `supabase/migrations/` | 21 |
| **`supabase/sql/`** | **3** — `customer_effective_greeting`, `call_summary_correction`, `elevenlabs_sync_log_prev_values` |
| keine passende Datei (Namensdrift, siehe A.3) | 6 |

Dazu kommen **11 Dateien** in `supabase/migrations/`, die vor der Anlage des
Ledgers (2026-08-08) entstanden sind und in
`supabase/verification/db-security-baseline.json` unter `preLedgerMigrations`
ausdrücklich als „nicht nachweisbar" geführt werden. Die übrigen 56 Dateien in
`supabase/sql/` liegen ebenfalls vor dem Ledger (ab 2026-04).

**Das Ledger führt bereits das Zielformat**: 14-stellige Versionen wie
`20260809142631`. Keine einzige Repo-Datei benutzt dieses Schema. Für ein
Zielbild ist das der entscheidende Punkt — siehe A.4.

## A.3 Neuer Befund: der Ledger-Check steht in beide Richtungen rot — reine Namensdrift

`checkLedger()` in `scripts/verify-db-security-invariants.mjs:250` vergleicht
Repo und Ledger. Der Vergleichsschlüssel ist der Dateiname ohne Datumspräfix
(`nameOf()`). Die Prüflogik nachgebaut und gegen den heutigen Stand gerechnet:

**Richtung 1 — „Repo-Migration ab 2026-08-08 ist auf der DB angewandt": 4 FAIL**

| Repo-Datei | Ledger-Name, unter dem sie angewandt wurde |
| --- | --- |
| `2026-08-09_admin_notification_settings.sql` | `admin_notification_settings_20260809` |
| `2026-08-09_notification_mode_gating.sql` | `notification_mode_gating_20260809` |
| `2026-08-09_revoke_browser_grants_rls_no_policy.sql` | `revoke_browser_grants_rls_no_policy_20260809` |
| `2026-08-09_core_field_layer_j6.sql` | **zwei** Zeilen: `core_field_layer_j6_columns_and_checks` + `core_field_layer_j6_schema` |

**Richtung 2 — „keine DB-Migration ohne Repo-Datei": 6 FAIL** — dieselben sechs
Ledger-Namen, plus `harden_customers_notification_backup_20260809`.

**Inhaltlich ist alles angewandt. Gegen Produktion nachgemessen (Fakt):**

| Prüfung | Ergebnis |
| --- | --- |
| Tabelle `public.admin_notification_settings` | existiert |
| Spalten `customers.ai_pricing_mode`, `ai_public_address` (J6) | existieren |
| Tabelle `public.customers_notification_backup_20260809` | existiert |
| Browser-Grants auf den 8 per `revoke_browser_grants…` gesperrten Tabellen | **0** verbleibend |
| Default `customers.notification_active` | gesetzt |

**Bewertung:** Es fehlt nichts auf der Datenbank. Der Check meldet einen
Namensunterschied, keinen Substanzverlust. Trotzdem ernst: solange er aus
bekannten, harmlosen Gründen rot steht, ist ein **neuer** Befund nicht mehr
davon zu unterscheiden.

**Wichtig für den Plan:** `core_field_layer_j6` ist **1 Datei ↔ 2 Ledger-Zeilen**.
Eine Umbenennung der Datei kann das nicht auflösen. Es braucht eine
ausdrückliche Zuordnung, keine Namensangleichung. *(Wahrscheinlich, nicht
verifiziert: die Migration wurde in zwei Schritten eingespielt, weil der
Schema-Teil vom Spalten-Teil getrennt lief.)*

## A.4 Zielbild

**Ein Verzeichnis: `supabase/migrations/`. Ein Namensschema: das des Ledgers.**

Begründung:

1. `supabase/migrations/` ist der Name, den die Supabase CLI und Supabase
   Branching erwarten. `supabase/sql/` hat keinen Konsumenten außer Menschen
   und Verify-Skripten.
2. Das Ledger führt bereits 14-stellige Versionen. Wenn die Datei
   `20260809172215_admin_notification_settings.sql` heißt, ist der
   Vergleichsschlüssel **der Dateiname selbst** — die Fehlerklasse aus A.3
   verschwindet strukturell statt per Pflege.
3. `STAGING_PRODUKTION_TRENNUNG_KONZEPT_2026-08-08.md` führt die
   Zusammenführung bereits als Teil von Posten V1 (Baseline-Migration) und als
   Vorbedingung für Option 1 und Option 4.

**Zwei Entscheidungen, die ich nicht allein treffen kann — Rückfrage:**

- **(E-a) Umbenennung auf 14-stellige Versionen: jetzt oder später?**
  *Empfehlung: jetzt, aber nur für die 27 im Ledger nachgewiesenen Dateien* —
  für die ist die Version belegt. Für die 73 Vor-Ledger-Dateien wäre jede
  Version erfunden; die behalten `YYYY-MM-DD_` bis zur Baseline.
- **(E-b) Baseline-Dump (V1 aus dem Staging-Konzept) im selben Zug?**
  *Empfehlung: nein, separat beauftragen.* Der Dump ist 1–1.5 Tage und
  beantwortet eine andere Frage (Reproduzierbarkeit), nicht diese
  (Einheitlichkeit).

## A.5 Die Verschiebe-Falle — quantifiziert (Fakt)

**Ein `git mv supabase/sql/*.sql supabase/migrations/` macht zwei heute grüne
Checks rot.** Beide Skripte klammern `supabase/sql/` ausdrücklich und begründet
aus:

**(1) `verify-migration-table-hardening.mjs`** prüft jede in `supabase/migrations/`
angelegte Tabelle auf RLS + Browser-Zugriffsregelung in derselben Datei. Der
Kopfkommentar (Zeile 19–23) schließt `supabase/sql/` aus, weil dessen Tabellen
nachträglich durch die P0-Foundation gehärtet wurden und eine Rückdatierung nur
Rauschen erzeugt.

Gemessen, indem ich das Skript mit auf `supabase/sql` gesetztem
`MIGRATIONS_DIR` habe laufen lassen:

```
Ist-Zustand  (supabase/migrations): 12 Tabellen geprüft — Tabellen-Haertung verifiziert.
Simulation   (supabase/sql):        23 Tabellen geprüft — 44 Pruefung(en) fehlgeschlagen.
```

**(2) `checkLedger()` Richtung 1** liest bewusst nur `supabase/migrations/`. Der
Kommentar dort (Zeile 275–279) sagt es wörtlich: die Dateien aus `supabase/sql/`
stammen aus der Zeit vor dem Ledger und würden „reihenweise als nicht angewandt
gemeldet — ein Check, der am ersten Tag rot ist, wird abgeschaltet". Nach einem
naiven Verschieben wären das **56 zusätzliche FAIL**.

**Konsequenz für den Plan:** Das Verschieben ist nicht die Arbeit. Die Arbeit
ist, die beiden Ausnahmelisten mitzuziehen, bevor die Dateien umziehen.

## A.6 Migrationsplan — vier Etappen, nicht umgesetzt

Reihenfolge ist bindend: jede Etappe lässt die Checks grün zurück.

### E1 — Ledger-Namensdrift schließen — **umgesetzt am 2026-08-10**

> Freigegeben und umgesetzt: `ledgerAliases` in
> `supabase/verification/db-security-baseline.json`, `checkLedger()` liest die
> Zuordnung in beiden Richtungen und **prüft sie selbst** (Eintrag ohne
> Repo-Datei oder ohne Ledger-Zeile = FAIL). Gegen den echten Produktions-Ledger
> getestet: beide Richtungen grün, P0-Fehlermodus schlägt weiterhin an.
> Der ursprüngliche Vorschlag steht unverändert darunter.


**Problem:** 4 + 6 FAIL aus A.3, rein durch Namensunterschiede.

**Nicht** die Dateien umbenennen: bei `core_field_layer_j6` stehen einer Datei
zwei Ledger-Zeilen gegenüber, das lässt sich per Dateiname nicht abbilden. Und
eine Datei auf einen Namen umzutaufen, damit ein Check schweigt, wäre genau die
unbelegte Behauptung, die die Baseline-Datei an anderer Stelle ausdrücklich
ablehnt.

**Stattdessen:** eine ausdrückliche Zuordnungstabelle in
`supabase/verification/db-security-baseline.json`, analog zu
`preLedgerMigrations` — Repo-Datei → Liste der Ledger-Namen, unter denen sie
angewandt wurde, mit Begründung. `checkLedger()` liest sie in beiden Richtungen.

- Aufwand: ~1–2 h inkl. Test
- Risiko: gering. Erweitert nur die Zuordnung, verschiebt nichts.
- Ergebnis: `verify-db-security-invariants` steht wieder grün und ist wieder
  ein Signal.

**Diese Etappe lohnt sich auch dann, wenn der Rest nie umgesetzt wird.**

### E2 — Ausnahmelisten vorbereiten — **umgesetzt am 2026-08-10, mit einer Abweichung**

> **Abweichung vom Vorschlag: keine Datumsgrenze, sondern eine namentliche
> Liste** (`migratedFromSqlDir`, 64 Dateien). Beim Bauen gemessen: eine
> Datumsgrenze bei 2026-08-08 hätte auch die elf Dateien ausgeschlossen, die
> schon vorher in `supabase/migrations/` lagen — die Altbestände und diese elf
> überschneiden sich zeitlich (beide reichen bis 2026-08-06). Das hätte **acht
> heute geprüfte Tabellen-Definitionen ungeprüft gelassen**, ohne dass es
> auffällt. Die Liste ist abgeschlossen (sie wächst nie wieder) und prüft sich
> selbst. Abdeckung nachgemessen: 12 Tabellen-Definitionen vorher, 12 nachher.


- `preLedgerMigrations.files` um die 67 Dateien aus `supabase/sql/` ergänzen,
  mit demselben ausdrücklichen „nicht nachweisbar"-Vermerk.
- In `verify-migration-table-hardening.mjs` die Alt-Dateien ausnehmen: entweder
  über eine datierte Grenze (Dateien vor 2026-08-08 werden nicht geprüft) oder
  über eine namentliche Liste. *Empfehlung: datierte Grenze* — eine Liste mit
  67 Einträgen veraltet, ein Datum nicht.
- Aufwand: ~2–3 h. Beide Skripte laufen danach unverändert grün, weil noch
  nichts verschoben ist.

### E3 — Verzeichnis vereinheitlichen — **umgesetzt am 2026-08-10**

> 67 Dateien per `git mv` verschoben, alle als reine Umbenennung erkannt
> (`R100`), Historie erhalten. `supabase/sql/` existiert nicht mehr,
> `supabase/migrations/` trägt 100 Dateien. `SQL_DIR` ist aus
> `verify-db-security-invariants.mjs` restlos entfernt.


- `git mv` der 67 Dateien nach `supabase/migrations/` (mit `git mv`, damit die
  Historie mitläuft — die Historie einzelner Dateien ist intakt, siehe
  Abschnitt B.1 zur getrennten Frage der `index.html`-Historie).
- **16 Referenzzeilen in 11 Dateien** anpassen:
  `.github/workflows/verify-call-intake.yml`, `scripts/verify-admin-operations-v3.mjs`,
  `verify-case-separation.mjs`, `verify-contract-termination-operational-state.mjs`,
  `verify-db-security-invariants.mjs`, `verify-invoice-adjustments.mjs`,
  `verify-invoice-dunning-workflow.mjs`, `verify-invoice-only-swiss-billing.mjs`,
  `verify-invoice-payment-snapshots.mjs`, `verify-migration-table-hardening.mjs`,
  `verify-payment-account-settings.mjs`.
- `SQL_DIR` in `verify-db-security-invariants.mjs` entfällt.
- Doku nachziehen (`docs/DB_SECURITY_CI_SETUP.md` Zeile 138 und 228,
  `INTERNAL_SYSTEM_DOCUMENTATION_2026-04-06.md` Zeile 31). Die Altdokumente mit
  historischen Pfadangaben (`PRODUCT_READINESS_REAUDIT_2026-04-11.md` usw.)
  bewusst **nicht** anfassen — die beschreiben einen damaligen Stand.
- Aufwand: ~3–4 h. Abnahme: alle betroffenen Verify-Skripte lokal grün.

### E4 — Umbenennung auf Ledger-Versionen — **umgesetzt am 2026-08-10**

> 25 Dateien (nicht 27 — zwei tragen je zwei Ledger-Zeilen) auf
> `<14-stellige Version>_<slug>.sql` umbenannt. Die 75 Vor-Ledger-Dateien
> behalten `YYYY-MM-DD_`: für sie wäre jede Version erfunden, und der Dateiname
> sagt das jetzt.
>
> `checkLedger()` gleicht seither **über die Version** ab — den Schlüssel, den
> Supabase selbst benutzt und der nicht auseinanderlaufen kann; der Name bleibt
> als zweiter Weg für Dateien ohne Version. Damit lösen sich drei der vier
> Zuordnungen von selbst auf. Übrig bleiben genau die zwei echten
> 1-Datei-zu-2-Ledger-Zeilen-Fälle (`notification_mode_gating`,
> `core_field_layer_j6`) — der Rest war Namensdrift und ist strukturell weg.


Nur die 27 im Ledger nachgewiesenen Dateien, Version aus dem Ledger übernommen.
Die Zuordnungstabelle aus E1 wird danach für diese Dateien überflüssig — bis auf
`core_field_layer_j6`, das zwei Zeilen behält.

- Aufwand: ~2–3 h
- Danach ist `supabase/migrations/` CLI-fähig, was Option 4 (Branching pro PR)
  aus dem Staging-Konzept erst möglich macht.

**Gesamt E1–E3: ~1 Arbeitstag. Mit E4: ~1.5.**

### Ausdrücklich nicht Teil dieses Plans

- Inhaltliche Zusammenfassung/Deduplizierung von Migrationen. Die Historie
  bleibt Datei für Datei erhalten; „nicht blind zusammenkopieren" heißt hier:
  gar nicht zusammenkopieren.
- Der Baseline-Dump (V1). Separate Beauftragung.
- Die 4 Dateien mit Suffix `_verification_queries.sql` in `supabase/sql/`
  (3 davon enthalten keinerlei DDL). *Vorschlag: nach `supabase/verification/`,
  wo die übrigen Prüfabfragen liegen — als eigener, winziger PR.*

---

# Teil B — Toter und unerreichbarer Code

## B.1 Methode und ihre Grenzen

Vier getrennte Auswertungen, jeweils über Customer Dashboard **und** Admin Portal:

1. **CSS-Klassen ohne Nutzung** — alle Klassen in Selektorposition (aus
   `<style>`-Blöcken, `.css`-Dateien und per JS injizierten Style-Strings) gegen
   einen Nutzungs-Korpus aus allem Übrigen: Markup, Renderer-Templates,
   `classList`-Aufrufe, `querySelector`, Netlify Functions.
2. **Funktionen ohne Aufrufer** — Deklarationen gegen Vorkommen im
   Laufzeit-Korpus; benannte IIFE und Callback-Ausdrücke ausgenommen.
3. **Verschattete Deklarationen** — gleicher Name zweimal auf oberster Ebene
   desselben `<script>`-Blocks.
4. **Geisterklassen** — im Markup verwendet, nirgends definiert (die Klasse von
   Fehler, zu der `.vx-ap-btn--ghost` gehörte).

**Vier Grenzen, die das Ergebnis relativieren — bitte mitlesen:**

- **Dynamisch zusammengesetzte Klassennamen.** 54 Stellen bauen Klassen zur
  Laufzeit. Die meisten interpolieren einen **vollständigen** Namen
  (`class="badge ${cls}"`), das ist für Grep unschädlich. Vier Stellen bauen
  aus Präfix + Fragment. **Ein bestätigter Fehlalarm daraus:** `.bf-dot-red`
  und `.bf-dot-amber` (`admin-panel/index.html:889-890`) erscheinen in der
  Rohliste als tot, sind aber über
  `renderTodayBlock('red', …)` / `('amber', …)` (Zeile 11843/11844) **live**.
  Für sie gilt: Grep reicht nicht, und Grep hat hier tatsächlich falsch gelegen.
- **„Seit wann tot" ist aus der Git-Historie nicht ableitbar.** **429 von 1 422**
  Commits auf `customer-dashboard/index.html` sind Voll-Ersetzungen („Add files
  via upload" / „Delete …", zuletzt mit 46 844 Einfügungen in einem Commit).
  `git log -S` datiert damit auf den Upload, nicht auf die inhaltliche
  Änderung. Die im Auftrag gewünschte Altersangabe pro Fund kann ich für diese
  Datei **nicht belastbar liefern** — das ist keine Auslassung, sondern ein
  Ergebnis. Für die Shared-Dateien und das Admin-Portal ist die Historie
  brauchbar.
- **Bewusste Untererfassung.** Wo eine CSS-Klasse denselben Namen trägt wie eine
  Element-ID (z. B. `.setup-progress-fill` neben `#setup-progress-fill`), zählt
  der Fund nicht als tot. Die Liste ist damit eher zu kurz als zu lang.
- **Nicht ausgeführt.** Alles ist statische Analyse. Kein Klicktest, keine
  Laufzeitmessung. Genau daran ist `.vx-ap-btn--ghost` seinerzeit
  vorbeigelaufen.

## B.2 Tote CSS-Klassen

| | Customer Dashboard | Admin Portal |
| --- | --- | --- |
| Klassen definiert | 1 825 | 682 |
| davon ohne jede Laufzeitnutzung | **800 (44 %)** | **77 (11 %)** |
| Regeln vollständig tot | **1 453 von 4 087** | **96 von 1 205** |
| betroffene Zeilen (Näherung) | **~4 553** | **~131** |
| nur noch von Verify-Skripten erwähnt | 17 | 1 |

Der Unterschied zwischen beiden Apps ist plausibel: das Customer Dashboard hat
mehrere Redesigns hinter sich (Design-Token-Pass, UI-Komponentenschicht,
Detail-V2), das Admin Portal nicht.

**Stichprobenprüfung.** 25 Klassen einzeln nachgeschlagen und jede Fundstelle
klassifiziert. Ergebnis für die geprüften Customer-Dashboard-Fälle: **jede**
Fundstelle stand in Selektorposition, keine im Markup. Beispiele:

| Klasse | Fundstellen | Bewertung |
| --- | --- | --- |
| `.theme-picker` | 2, beide CSS (`index.html:30480`, `:30523`) | tot |
| `.dash-kpi-val` | 11, alle CSS | tot |
| `.vxdr-banner` | 31, alle CSS | tot |
| `.dpr-action-cell` | 34, alle CSS | tot |
| `.vx-cd-title` | 4, alle CSS | tot |
| `.vx-ui-input` | 3 CSS + **1 in `verify-customer-design-foundation.mjs`** | tot im Produkt, aber ein Verify-Skript prüft auf seine Existenz |

**Die grössten zusammenhängenden Familien (Customer Dashboard):**

Familien sind überschneidungsfrei gezählt, jede Regel genau einmal:

| Familie | Regeln | Zeilen | Klassen | Was es war |
| --- | --- | --- | --- | --- |
| `dpr-*` | 282 | 1 408 | 53 | abgelöste Priority-Row-Fassung im Dashboard |
| `act-*` / `activation-*` | 217 | 270 | 149 | Reste der alten Aktivierungsstrecke (viele sehr kurze Regeln) |
| `vx-cd-*` / `vxdr-*` | 97 | 539 | 39 | zwei abgelöste Fassungen des Anruf-Detail-Kopfs |
| `dash-kpi-*` | 68 | 168 | 13 | abgelöste KPI-Kacheln |
| `vx-ui-*` | 32 | 198 | 24 | nie genutzte Varianten der Komponentenschicht (`--compact`, `--roomy`, `--flush`, Badge-Tönungen, Formularfelder) |
| `account-*` | 30 | 108 | 21 | abgelöster Konto-Screen |
| übrige | 727 | ~1 862 | — | verstreut |

Die `vx-ui-*`-Familie ist ein Sonderfall: das ist die **absichtlich** breit
angelegte Komponentenschicht (`customer-ui-components.css`). Ungenutzte
Varianten sind dort kein Versehen. **Empfehlung: belassen**, siehe C.

**Admin Portal, alle 77** (kompakt, weil überschaubar): `finance-*` (28),
`customer-card*` (10), `bf-*` (7, davon **2 Fehlalarme**: `bf-dot-red`,
`bf-dot-amber`), `overview-*` (5), `profile-*` (5), `wizard-step-*` (2),
`onboarding-checklist-*` (2), `tab-btn`, `tab-panel`, `settings-*` (3),
`vx-billing-*` (3), `modal-content`, `modal-grid-2`, `grid-4`, `card-body`,
`card-header`, `panel-title`, `section-subtitle`, `helper-text`, `status-pill`,
`spinner`, `toast-show`, `kpi-warn`, `btn-night`, `admin-settings-grid`,
`ai-global-secondary`, `vox-modal-close`, `offer-brand-logo-hook`,
`offer-doc-brand-title`, `customer-row-card`, `finance-premium-card`.

## B.3 Funktionen ohne Aufrufer

| | Customer Dashboard | Admin Portal |
| --- | --- | --- |
| Funktionen deklariert | 1 545 | 815 |
| ohne jeden weiteren Verweis | **143** | **35** |

**Gegenprobe auf String-Dispatch (Fakt).** Es gibt drei Stellen mit
`window[name]()`: `index.html:14807` (Fallback-Handler), `:20488`
(`vxSetHeuteKpiCell`) und `:36433` (fest verdrahtete Vier-Namen-Liste). Alle
drei bekommen ihre Namen als **Literale** von den Aufrufern — die Literale
stehen im Quelltext und sind mitgezählt. **Es gibt keinen Dispatch aus
berechneten Namen.** Damit ist die Grep-Grundlage hier belastbar, anders als bei
den CSS-Klassen.

Stichprobe von 11 Kandidaten einzeln nachgezählt (`toggleTranscript`,
`cancelContract`, `resendInvite`, `uploadContractWord`, `markCallReviewed`,
`vxInitRufumleitung_old`, `vxDebugEnable`, `saveFollowUp`, `uploadAvatar`,
`openManualRequestModal`, `renderDashFocusCard`): **jeweils genau 1 Vorkommen**
im gesamten Laufzeit-Korpus — die Deklaration selbst.

**Cluster (Funktionen, die räumlich zusammenliegen):**

| Ort | Anzahl | Inhalt |
| --- | --- | --- |
| `customer-dashboard/index.html:26273–28735` | **51** | Aktivierungs-/Rufumleitungsstrecke. **Achtung: nicht flächendeckend tot** — im selben Bereich sind **87** Funktionen weiterhin referenziert. Die toten liegen dazwischen. Kein Block-Löschkandidat. |
| `:23841–25586` | 11 | Modal-/Aufgaben-Helfer |
| `:10769–12520` | 16 | Zähl- und Gruppierungshelfer der Anfragenliste, u. a. `_dprToggleLock_unused` |
| `:8861–8871` | 5 | Debug-Helfer (`vxDebugEnable/Disable/Group/GroupEnd`) — **wahrscheinlich absichtlich** von Hand in der Konsole aufrufbar. Belassen. |
| `admin-panel/index.html:13326–13477` | 5 | `sendBillingPaymentLink`, `markBillingPaid`, `sendMonthlyBillingPaymentLink`, `sendYearlyBillingPaymentLink`, `markSubscriptionPaid` — **plausibel tot seit der Umstellung auf Invoice-only** (`2026-08-01_invoice_only_billing_disable_payment_links.sql`) |
| `admin-panel/index.html:6677–6793` | 3 | Onboarding-Detail-Renderer |

Zwei Funktionen tragen ihren Zustand schon im Namen: `vxInitRufumleitung_old`
(`index.html:15527`) und `_dprToggleLock_unused` (`:10769`).

## B.4 Verschattete Funktionen — der Fund mit der höchsten Priorität

**Fakt.** Zwei Funktionen sind in `customer-dashboard/index.html` **zweimal auf
oberster Ebene desselben `<script>`-Blocks** deklariert. Bei
Funktionsdeklarationen gewinnt die **spätere**; die frühere ist unerreichbar,
sieht beim Lesen aber wie die gültige aus.

| Name | tote Fassung | gültige Fassung |
| --- | --- | --- |
| `getForwardingCode` | **Zeile 26393** | Zeile 28338 |
| `copyVoxeraNumber` | **Zeile 27618** | Zeile 28735 |

`getForwardingCode` ist der ernstere Fall. Die tote Fassung ist ein
**neutralisierter Stub** und gibt eine **andere Form** zurück als der Gewinner:

```js
// Zeile 26393 — unerreichbar
function getForwardingCode(mode, voxeraNumber) {
  return { code: "", label: "" };
}

// Zeile 28338 — das ist die Funktion, die tatsächlich läuft
function getForwardingCode(type, voxeraNumber){ … return { activate: '**21*…#', deactivate: '##21#' }; }
```

Wer die Datei von oben liest, findet zuerst den Stub und schliesst daraus, die
Weiterleitungscodes seien abgeschaltet. Sie sind es nicht. Das ist keine
Kosmetik, sondern eine **Falle für die nächste Diagnose** in diesem Bereich —
und ein Verstoss gegen AGENTS.md („multiple handlers for the same action",
„add-only patches that do not remove or neutralize old logic").

Im Admin Portal: **keine** Verschattung dieser Art (geprüft).

Die 44 bzw. 23 weiteren Mehrfachnamen (`boot`, `render`, `install`, `esc`, …)
liegen in getrennten IIFE-Scopes verschiedener Runtime-Dateien und sind
**unschädlich** — kein Handlungsbedarf.

## B.5 Geisterklassen — im Markup benutzt, nirgends definiert

136 Rohtreffer, davon nach Abzug von Icon-Bibliotheken (`ph-*`) und
`contract-signed.html` (eigene Seite, eigener Style-Block) **59 zu bewerten**.
Die Kategorie muss man zweiteilen:

**(a) Reine JS-Haken — kein Befund.** Klassen, die nur als `querySelector`-Ziel
dienen und ihr Aussehen von Nachbarklassen beziehen, z. B.
`.vx-inline-qr-action` (steht immer neben `btn btn-secondary btn-sm`). Korrekt so.

**(b) Sichtbare Absicht ohne Regel — echte Funde.** Einzeln nachgeprüft, jeweils
**null** CSS-Fundstellen im gesamten Repo:

| Klasse | Stelle | Bewertung |
| --- | --- | --- |
| `.modal--wide` | `index.html:8473` | Der Commercial-Dialog verlangt eine breite Fassung, die es nicht gibt. Der Dialog rendert in Standardbreite. |
| `.dash-empty` | `index.html:21018` | Leerzustand der Dashboard-Liste ist unstilisiert |
| `.vx-ap-hours--full` | `customer-runtime-assistant-profile.js:854`, als Selektor `:881`, `:1223` | **dieselbe Familie wie `.vx-ap-btn--ghost`** — `.vx-ap-field` und `.vx-ap-field-label` sind in `customer-assistant-components.css` definiert, der `--hours`/`--full`-Modifier nicht |
| `.vx-ap-field--hours` | `customer-runtime-assistant-profile.js:857` | dito |
| `.vx-name-fallback` | `index.html:38721` (`classList.add`) | Klasse wird gesetzt, bewirkt nichts |
| `.vx-pending-item`, `.vx-pending-item-dot` | `index.html:14557` | unstilisiert |
| `.vx-settings-entry--action` | `index.html:7992` | Modifier ohne Regel |
| `.vx-handover-section--muted` | `index.html:7739` | Modifier ohne Regel |
| `.vx-dv2-info-item` | `index.html:38107` | Modifier ohne Regel |

Der Verdacht aus dem Briefing — „ähnliche Geister-Klassen existieren
wahrscheinlich noch woanders" — **bestätigt sich**, und zwar mit zwei Treffern
in genau derselben `vx-ap-*`-Familie wie der Originalfund.

Ein Sonderfall ohne Handlungsbedarf: `.btn--neutral` wurde laut Kommentar in
`index.html:1696` und laut `MODAL_INVENTAR_CUSTOMER_DASHBOARD_2026-08-08.md`
bewusst entfernt; ein `classList.remove('…','btn--neutral')` in Zeile 23753 ist
als harmloser Rest stehengeblieben.

## B.6 Die drei Beispiele aus dem Auftrag — alle bereits erledigt

Der Auftrag nennt drei konkrete Fundstellen. **Alle drei sind zum Prüfzeitpunkt
bereits behoben.** Das ist keine Kritik am Briefing — es ist der Grund, warum
die systematische Suche nötig war.

| Beispiel | Stand heute |
| --- | --- |
| **`#tab-hilfe`, doppelter Hilfe-Screen** | Entfernt. `index.html:8375` trägt den Vermerk „Der frühere zweite Hilfe-Screen (#tab-hilfe) stand hier", `:26043` „ist entfernt; die einzige lebende Hilfe-Seite ist …". `verify-customer-design-foundation.mjs:210` ist auf 7 statt 8 Screens nachgezogen. Es gibt heute genau 7 `#tab-*`-Screens und eine `#mehr-sub-hilfe`. **Keine Restfassung im Code.** |
| **`.detail-head` Night-Farbregel** | Entfernt in `a137e5db` (#885). An der Stelle steht jetzt der begründende Kommentar (`index.html:2177–2179`): „hatte hier und an drei weiteren Stellen Regeln, ohne dass die Klasse irgendwo im Markup oder in einem Renderer auftaucht — entfernt 2026-08-09". |
| **`.vx-ap-btn--ghost`** | **Null** Fundstellen im gesamten Repo. Zuletzt in `6d9e92f` (#905) angefasst. |

## B.7 Sperrgebiete — berührte Funde, die ich ausdrücklich liegen lasse

Der Auftrag nennt Make, die E-Mail-Vorlagen, Szenario 09 sowie das Toast-System
und die Benachrichtigungseinstellungen-Nacharbeiten als tabu. Betroffen sind:

- **Toast-System:** die toten Klassen `.t-success`, `.t-error`, `.t-info`,
  `.t-warning` (`index.html:1991–1994`) und `.toast-show` (Admin Portal).
  Vier davon werden zusätzlich von einem Verify-Skript erwähnt. **Nicht
  anfassen** — das System wird gerade umgebaut, und ob diese Klassen danach
  gebraucht werden, entscheidet dieser Umbau.
- **Benachrichtigungen:** `.vx-bell-btn`, `.vx-bell-shake`, `.vx-bell-wrap`,
  `.vx-sidebar-bell-badge`, `.vx-sidebar-bell-label`, die Geisterklasse
  `.browser-notif-status` und die Funktion `selectSetupNotification`.
  **Nicht anfassen.**
- Make, E-Mail-Vorlagen, Szenario 09: **nicht berührt.** Diese Diagnose hat
  keine Blueprints gelesen und keine Mail-Pfade ausgewertet.

Ausserdem ungeprüft geblieben, weil ich nicht weiss, ob dort gerade gearbeitet
wird: ob `customer-dashboard/activate.html` heute noch angebunden ist.
`ACTIVATION_ROUTING_AUDIT_2026-08-09.md` führt die Seite als „wahrscheinlich
toter Code in Produktion" und benennt zwei parallele Implementierungen desselben
Vorgangs. **Das ist ein eigener, bereits dokumentierter Vorgang — ich fasse ihn
hier nicht an und zähle ihn nicht doppelt.**

---

# C — Priorisierte Fundliste

## C.1 Sicher entfernbar — hohe Konfidenz, kleiner Diff

| # | Fund | Umfang | Warum sicher |
| --- | --- | --- | --- |
| **1** | **Verschattete `getForwardingCode` (Z. 26393) und `copyVoxeraNumber` (Z. 27618)** | ~10 Zeilen | Fakt: gleiche Ebene, gleicher Script-Block, spätere Deklaration gewinnt. Entfernen ändert das Laufzeitverhalten **nicht** — beweisbar, nicht vermutet. Höchster Nutzen pro Zeile im ganzen Bericht. |
| **2** | `vxInitRufumleitung_old`, `_dprToggleLock_unused` | 2 Funktionen | Name benennt den Zustand; je 1 Vorkommen |
| **3** | `.theme-picker`, `account-*`, `act-*`/`activation-*`, `dash-kpi-*` | 317 Regeln / ~553 Zeilen | Familien ohne Markup, stichprobenweise einzeln nachgeprüft |
| **4** | Die 4 `_verification_queries.sql` nach `supabase/verification/` | 4 Dateien | 3 davon enthalten keinerlei DDL; reine Ablage |

## C.2 Sicher, aber grösserer Diff — eigener PR je Familie

| # | Fund | Umfang |
| --- | --- | --- |
| **5** | `dpr-*`-Familie (abgelöste Priority-Row) | 282 Regeln / ~1 408 Zeilen |
| **6** | `vx-cd-*` + `vxdr-*` (zwei abgelöste Detail-Kopf-Fassungen) | 97 Regeln / ~539 Zeilen |
| **7** | Übrige tote Regeln Customer Dashboard (ohne `vx-ui-*`, siehe C.4) | 725 Regeln / ~1 855 Zeilen |
| **8** | Tote Regeln Admin Portal **ohne** `bf-dot-red`/`-amber` | 94 Regeln / ~129 Zeilen |
| **9** | Die 51 unerreichbaren Funktionen im Aktivierungsbereich | einzeln, **nicht** als Block — 87 Nachbarn leben |

## C.3 Unsicher — Rückfrage nötig, nicht ohne Antwort anfassen

| # | Fund | Offene Frage |
| --- | --- | --- |
| **10** | 17 tote Klassen, die Verify-Skripte prüfen (`vx-ui-input`, `vx-ui-field`, `vx-report-card`, …) | Ist die Komponentenschicht Vorrat (dann belassen) oder Altlast (dann Skript **und** CSS gemeinsam)? |
| **11** | Geisterklassen `.modal--wide`, `.vx-ap-hours--full`, `.vx-ap-field--hours`, `.dash-empty`, `.vx-settings-entry--action`, `.vx-handover-section--muted` | Fehlt die Regel (dann ist es ein **Darstellungsfehler**, kein Aufräumfall) oder ist die Klasse überflüssig? Nur ein Blick auf die Oberfläche beantwortet das. |
| **12** | Admin-Billing-Funktionen `sendBillingPaymentLink` & Co. | Ist Invoice-only endgültig oder sind Payment-Links reaktivierbar gedacht? |
| **13** | Entscheidungen **E-a** und **E-b** aus A.4 | Umbenennung jetzt? Baseline im selben Zug? |

## C.4 Bewusst belassen — mit Begründung

| Fund | Begründung |
| --- | --- |
| `vx-ui-*`-Varianten (26 Klassen) | Absichtlich breite Komponentenschicht. Ungenutzte Varianten sind dort Vorrat, kein Versehen. |
| `vxDebugEnable/Disable/Group/GroupEnd`, `vxClearLocalAuthAndReload` | Wahrscheinlich für den Aufruf aus der Konsole gedacht; AGENTS.md sieht ein `VX_DEBUG`-Flag ausdrücklich vor |
| `.bf-dot-red`, `.bf-dot-amber` | **Fehlalarm, nachgewiesen live** über `renderTodayBlock('red'/'amber', …)` |
| Toast- und Benachrichtigungsklassen (B.7) | anderweitig in Arbeit |
| `.btn--neutral` | bereits bewusst entfernt und dokumentiert |
| Mehrfachnamen in getrennten IIFE-Scopes (44 + 23) | kein Konflikt |
| `activate.html` | eigener, bereits dokumentierter Vorgang |

## C.5 Vorschlag für den PR-Schnitt

Neun kleine PRs statt eines grossen, jeder für sich abnehmbar:

1. **E1 — Ledger-Zuordnungstabelle.** *Unabhängig von allem anderen, macht einen
   roten Security-Check wieder grün. Wenn nur ein Punkt umgesetzt wird: dieser.*
2. Verschattete Funktionen entfernen (Fund 1)
3. `_old`/`_unused`-Funktionen (Fund 2)
4. E2 — Ausnahmelisten vorbereiten
5. E3 — Verzeichnis vereinheitlichen + 16 Referenzen
6. Tote CSS-Familie `dpr-*`
7. Tote CSS-Familie `vx-cd-*`/`vxdr-*`
8. Restliche tote CSS-Regeln, Customer Dashboard
9. Tote CSS-Regeln, Admin Portal

CSS und JavaScript nie im selben PR — die Abnahmekriterien sind verschieden.

## C.6 Was ich nicht prüfen konnte

- **Kein Laufzeittest.** Alles statisch. Für die CSS-Funde bedeutet das: sicher
  ist die Aussage „diese Klasse steht in keinem Markup", nicht „diese Regel hat
  nie gewirkt".
- **Alter der Funde** in `customer-dashboard/index.html` — siehe B.1, die
  Historie gibt es wegen 429 Voll-Ersetzungen nicht her.
- **Kein Blick auf Make, Mail-Vorlagen, Szenario 09** — Sperrgebiet.
- **Netlify Functions** (54 im Customer Dashboard, 40+ im Admin Portal) sind als
  Nutzungs-Korpus mitgelesen, aber **nicht selbst** auf toten Code untersucht.
  Eigener Auftrag, wenn gewünscht.
- Ob die Geisterklassen aus C.3/11 ein Darstellungsfehler sind, ist **nur am
  laufenden Produkt** zu klären.

---

# D — Nachtrag 2026-08-11: erster Produktivlauf des F6-Wächters

## D.1 Der Wächter hat einen Befund geliefert, den niemand gesucht hat

Der Spalten-Allowlist-Check aus Gruppe F6 lief zum ersten Mal gegen die
Produktions-Datenbank. Gesucht war eine Bestätigung; geliefert hat er einen
zweiten Befund:

```
FAIL  F6-grants  calls: authenticated-UPDATE auf exakt 4 Spalten
      callback_requested,dashboard_status,notes_customer_voxera,read_at,updated_at
```

Fünf statt vier. Die fünfte war `callback_requested` — ein Recht, das kein
Browser-Pfad braucht. Die Kundensitzung schreibt an `calls` nur `read_at`,
`dashboard_status`, `notes_customer_voxera` und `updated_at`. Gesetzt wird
`callback_requested` ausschliesslich serverseitig mit dem Service-Role-Schlüssel,
aus dem Anrufeingang (`call-intake-webhook.js:153`, `:297`,
`elevenlabs-post-call.js:300`, `:415`). Zurückgenommen mit Migration
`20260811203000_revoke_calls_callback_requested_grant.sql`; Nachmessung im
Zielsystem: vier Spalten, Check grün.

Harmlos war das Recht nicht. `callback_requested` entscheidet, ob ein Anruf als
Rückrufwunsch gilt — es steuert die Aufgabenliste, die Sortierung und künftig
den SMS-Versand. Eine Kundensitzung hätte den Rückrufwunsch eines Anrufers still
zurücksetzen können.

**Das ist das Argument für den nächsten Katalogeintrag.** Der Befund kam nicht
aus einem Audit, sondern nebenbei, beim ersten Lauf eines Checks, der für etwas
anderes geschrieben wurde. Kein Mensch hatte diese Spalte auf dem Zettel — die
Aufräum-Diagnose in Teil B hat sie nicht gefunden, weil statische Code-Suche
fehlende Aufrufer sieht, nicht überschüssige Rechte. Ein exakter Check ("genau
diese vier") findet, was eine Mindestprüfung ("mindestens diese vier")
durchwinkt. Jede weitere Tabelle mit einer Spalten-Allowlist verdient denselben
Eintrag.

## D.2 Fund 14 (neu): `onboarding_completed` — geprüft, kein Handlungsbedarf

Offen stand die Frage, ob der Browser-Aufruf toter Code ist, weil der Wizard
über eine Function schreibt. Er ist es nicht — die Frage beruhte auf einer
Verwechslung zweier Features:

1. **Kein Server-Pfad schreibt die Spalte.** `onboarding_completed` kommt in
   keiner der 54 Netlify Functions des Customer Dashboards und in keiner des
   Admin Portals vor. Der Aktivierungs-Wizard in `activate.html` ist ein anderes
   Feature als das Onboarding-Modal im Dashboard; er rührt diese Spalte nicht an.
   `customer-dashboard/index.html:15985` ist der **einzige** Schreiber im
   gesamten Repository.
2. **Der Pfad ist auf zwei Wegen erreichbar.** Automatisch über
   `vxOnboardingInit()` (`index.html:16856`, 800 ms nach jedem
   customerMeta-Rebuild, also bei jedem Poll) und manuell über
   `vxOnboardingRestart()`, verdrahtet an zwei Schaltflächen (`:8164`, `:8486`,
   Hilfe → Einrichtung).
3. **Der Pfad lief nachweislich in Produktion.** Der Kommentar bei `:15810`
   beschreibt einen real beobachteten Fehler: Das Modal öffnete sich bei jedem
   Poll erneut, weil der Schreibvorgang still scheiterte und der nächste Poll
   `onboarding_completed=false` zurücklas. Genau dieses Symptom hat am
   2026-08-07 zur Grant-Migration geführt.
4. **Das Recht ist da und gehört dazu.** Messung in der Produktions-DB:
   `customers` erlaubt `authenticated`-UPDATE auf genau vier Spalten —
   `contact_first_name`, `in_app_notification_settings`, `onboarding_completed`,
   `updated_at`. Deckungsgleich mit der Katalog-Allowlist, Check grün.

**Ergebnis: weder löschen noch ein Grant vergeben.** Beides ist bereits richtig.
Der Fund gehört nach C.4 (bewusst belassen), nicht nach C.3.
