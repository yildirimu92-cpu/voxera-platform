# Etappe 4 Teil B — Ist-Zustand-Bestandsaufnahme und Umsetzungsplan

**Datum:** 2026-08-08
**Auftrag:** Drei neue Anfragen-Detail-Features (Termin einbuchen, Rückruf-Ergebnis festhalten,
KI-Zusammenfassung korrigieren). Bestandsaufnahme und Plan, **keine Umsetzung** in diesem Schritt.
**Basis:** `main` @ 883de7c, Produktions-DB gegengeprüft (Projekt `ulcofbgrovgcvowdjrge`).

---

## Teil A — Ist-Zustand

### A1. Wo das Anfrage-Detail heute lebt

Nach Teil A gibt es genau **eine** Detail-Komponente:

| Baustein | Ort |
|---|---|
| Renderer | `customer-dashboard/index.html:37359` — `vxRenderEntryDetail(record, {hostEl, frame})` |
| Stylesheet | `index.html:36761` — `#vx-entry-detail-css`, an `.vx-dv2-shell` gebunden |
| Header (Anruf) | `index.html:37299` — `buildCallHeaderHtml()` |
| Aktionszeile | `index.html:37117` — `buildActionRowHtml()` |
| Body (Anruf) | `index.html:37185` — `buildCallBodyHtml()` |
| Header/Body (Aufgabe) | `index.html:37330` / `37256` |
| Aktions-Ableitung | `index.html:12011` — `vxBuildOperationalRowActions()` |

Aufbau des Anfrage-Bodys von oben nach unten:

1. **Karte „Anliegen"** (`37197`–`37204`) — KI-Zusammenfassung in der Newsreader-Serife,
   Kopfzeile links „Anliegen", rechts der Metatext **„Automatisch erstellt"**, darunter der Block
   „Nächster Schritt" aus `inferActionMeta()` (`37093`).
2. Akkordeon **Audio & Transkript** (nur wenn vorhanden).
3. Akkordeon **Notiz** — Textarea + Speichern über `vxDv2SaveNote()`.
4. Akkordeon **Verlauf** — lazy über `vxDv2LoadHistory()`.
5. **Schrittpfad** (`37233`–`37250`) — nur bei `planned`: „Eingegangen → \<Aktion\> geplant → Erledigt".

Die Aktionszeile kennt heute genau fünf Aktionen (`mapAction()`, `37138`):
`done` (Erledigen), `call` (Anrufen), `followup`/`schedule-callback` (Rückruf planen),
`edit-due` (Fälligkeit), `archive` (Archivieren), plus `edit` im Aufgaben-Zweig.

**Andockstellen der drei neuen Features:**

| Feature | Andockstelle |
|---|---|
| 1 Termin einbuchen | Aktionszeile (`37378`) + neue Karte über dem Anliegen (`37197`) + Chips im Header (`37314`) |
| 2 Rückruf-Ergebnis | `vxCallDetailErledigt()` (`19163`) + Schrittpfad (`37233`) + neue Ergebnis-Karte |
| 3 KI-Korrektur | Kopfzeile und Textkörper der Anliegen-Karte (`37198`/`37199`) |

### A2. Das Lebenszyklus-Modell — der Engpass für Feature 1

`vxGetEntryLifecycleStatus()` (`index.html:11293`) ist die einzige Quelle und kennt **genau vier**
Zustände: `archived → done → planned → open`. Entscheidend: **`planned` wird allein aus
`follow_up_at`/`due_at` abgeleitet** (`11266`, `12064`, `36953`). Es gibt keinen Zustand, keine
Achse und kein Feld, an dem ein gebuchter Termin hängen könnte.

Daran hängen: die vier Filter-Pillen `offen`/`geplant`/`abgeschlossen`/`archiv` (`index.html:7588`,
Zuordnung `13748`), die Sidebar-Badge, die „Braucht dich"-Gruppierung auf Heute (`19886`), die
Sortierung (`compareFollowUpPriority`, `12284`) und die Anzeige-Normalisierung im Detail (`36931`).

### A3. Datenmodell heute (gegen Produktions-DB verifiziert)

**`calls`** — 60 Spalten, davon relevant:
`call_summary`, `call_summary_short`, `next_action`, `follow_up_at`, `notes_customer_voxera`,
`callback_requested`, `dashboard_status`, `read_at`, `completed_at`, `archived_at`,
`elevenlabs_conversation_id`, `transcript`/`transcript_json`, `recording_*`.

**Es gibt keine Spalte für Termine, keine für ein Nachfass-Ergebnis und keine für eine
korrigierte Zusammenfassung.** Ebenso keine E-Mail-Spalte (relevant für die Bestätigungsmail).

Zwei Abweichungen gegenüber `supabase/sql/2026-04-08_core_tables_schema_sot.sql`:

* `follow_up_at` ist real **`timestamptz`**, das SOT-Dokument sagt `date` — SOT ist hier veraltet.
* `created_at`/`updated_at` sind **`timestamp without time zone`** (Altlast). Neue Zeitfelder
  sollten das nicht wiederholen.

**`customer_tasks`** (die manuellen Aufgaben): `due_at date` **und** `due_time text` getrennt,
`completed_at`, `archived_at`, `source_call_id`, `note`/`notes`. Keine Ergebnisfelder.

**`calendar_settings`** existiert vollständig (Öffnungszeiten, Terminlänge, Puffer, Mindestvorlauf,
Horizont, `feature_enabled` default `false`).

**`calendar_booking_audit`** existiert — aber **ohne jeden Bezug zum Anruf**: kein `call_id`, keine
`conversation_id`, nur `request_id`, `external_event_id` und ein `details jsonb`.

### A4. Die Kalender-Strecke ist deutlich weiter als angenommen

| Baustein | Status |
|---|---|
| `netlify/functions/calendar-tool.js` | **fertig** — `availability`/`book`/`reschedule`/`cancel`, Bearer+HMAC, Idempotenz über `request_id`, Puffer/Mindestvorlauf/Horizont, Mandanten-Prüfung, Ownership-Check (`calendar_event_not_managed_by_voxera`) |
| `calendar-agent-tool.js` | **fertig** — stabile `request_id` aus `conversation_id` + `agent_turns` |
| `_lib/calendar-providers.js` | **fertig** — Google + Microsoft |
| Prompt-Anbindung | **fertig** — Buchungsanweisung wird angehängt, sobald `feature_enabled` und `active_provider` gesetzt sind (`docs/elevenlabs-calendar-tool-provisioning.md`, Schritt 5) |
| Einstellungs-UI | **vorhanden** — `shared/customer-runtime-calendar-settings.js:127`, Häkchen „Buchungen durch Assistent erlauben" = `feature_enabled` |
| Doppelte Sperre | `CALENDAR_INTEGRATION_ENABLED` + `CALENDAR_ROLLOUT_CUSTOMER_IDS` (`_lib/calendar-rollout.js`) **und** `calendar_settings.feature_enabled` |

**Zwei Korrekturen gegenüber der Kommandozentrale:**

1. Der Modus-Schalter existiert im Kern bereits — als Häkchen, nicht als zwei benannte Modi.
   Es fehlt die Benennung („Nur Anfrage" / „Direkt buchen"), nicht die Mechanik.
2. **Der eigentliche Bruch liegt woanders: eine Buchung erreicht die Anfrage nie.** Sie landet
   ausschliesslich in `calendar_booking_audit`. Ein `grep` über `index.html` und `shared/*.js`
   nach `calendar_booking_audit`, `external_event_id` und `calendar_settings` liefert
   **null Treffer** — das Dashboard liest diese Strecke an keiner Stelle. Zustand B
   („Termin gebucht") hat heute schlicht keine Datenquelle.

### A5. Rückruf/Nachfassen heute

* Modal: `openFollowup()` (`23139`), Speichern `saveFollowup()` (`23257`).
* Geschrieben werden über `call-save-followup` genau **drei** Felder:
  `notes_customer_voxera`, `next_action`, `follow_up_at` (`netlify/functions/call-save-followup.js:103`–`105`).
* Drei Aktionen nach dem Fix vom 08.08.: *Zurückrufen* / *Termin bestätigen* / *Offerte senden*,
  plus technischer Leerzustand. Tabellen bei `index.html:12195`–`12216`.
* Zwei Pfade: offener Eintrag → Patch am Call; **erledigter** Eintrag → **neue Aufgabe** in
  `customer_tasks` (`23289`–`23320`).
* „Erledigen" (`vxCallDetailErledigt`, `19163`) öffnet den Bestätigungsdialog und setzt
  `dashboard_status = 'closed'`. **Dazwischen wird nichts erfasst.**
* „Termin bestätigen" erzeugt heute nur eine Aufgabe vom Typ `termin` — **ohne jeden Kalenderbezug**.

Das ist die Lücke aus dem Auftrag: geplant werden kann, zurückgemeldet nicht.

### A6. KI-Zusammenfassung heute

* Anzeige: `getSummary()` → `vxGetCallSummary()` (`17606`), Kette
  `call_summary → summary → call_summary_short → ai_summary → analysis_summary`.
  Die Liste liest über einen **zweiten** Pfad: `shared/customer-call-view-model.js:105`.
* Geschrieben von `netlify/functions/elevenlabs-post-call.js`. Der Update-Pfad überschreibt
  `call_summary` auf dem gematchten Datensatz (Match über `elevenlabs_conversation_id`, sonst
  Telefon+Zielnummer im 120-Minuten-Fenster, `elevenlabs-post-call.js:372`–`395`) und setzt in
  diesem Pfad zusätzlich `dashboard_status = 'new'` (`365`).
* **Kein Schreibpfad für den Kunden** (die Funktion erlaubt nur die drei Nachfass-Felder) und
  **kein Admin-Pfad** (`grep call_summary admin-panel/index.html` → 0 Treffer).

**Konsequenz für Feature 3:** Eine Korrektur darf `call_summary` **nicht** überschreiben. Ein
verspäteter oder wiederholter Post-Call-Webhook würde sie sonst still zurücksetzen — und den
Eintrag zusätzlich auf `new` zurückstellen.

---

## Teil B — Umsetzungsplan

### B0. Drei Grundsatzentscheidungen, die alles Weitere festlegen

**E1 — Ist „Termin gebucht" ein fünfter Lebenszyklus-Zustand oder eine eigene Achse?**
*Empfehlung: eigene Achse.* Der 4er-Lebenszyklus ist Geschäftsstatus; ein gebuchter Termin kann
gleichzeitig offen **oder** erledigt sein. Als fünfter Zustand müssten CHECK-Constraint auf `calls`,
die Übergangstabelle in `call-save-followup.js:42`, die Filterzuordnung (`13748`) und die
Heute-Zählung angefasst werden — vier Stellen, die alle schon mehrfach Bugquelle waren. Das ist
dieselbe Logik wie bei der bereits getroffenen Entscheidung „Erledigt = Geschäftsstatus,
Archiv = Aufbewahrung sind unterschiedliche Achsen".

**E2 — Wo lebt der Termin: Spalten auf `calls` oder eigene Tabelle?**
*Empfehlung: eigene Tabelle `call_appointments`.* Verschieben und Stornieren haben eine Historie,
der Kalender-Audit ist bereits eine eigene Tabelle, und `calls` trägt schon 60 Spalten.
Die billigere Variante (drei Spalten auf `calls`) spart etwa einen halben Tag, verliert aber die
Verschiebe-Historie — und genau die ist für Nachvollziehbarkeit/Fakturierung das Argument.

**E3 — Buchungsmodus: `feature_enabled` umdeuten oder eigene Spalte?**
*Empfehlung: eigene Spalte `booking_mode`* (`'request_only' | 'direct_booking'`, default
`request_only`). `feature_enabled` trägt heute zwei Bedeutungen gleichzeitig (Tool aktiv **und**
Buchung erlaubt) und steuert zusätzlich, ob der Prompt-Sync die Buchungsanweisung anhängt. Zwei
benannte Modi sind ausserdem die Sprache, die die Kommandozentrale festhält.

### B1. Reihenfolge und Abhängigkeiten

Die drei Features sind **nicht gleich stark verkoppelt**:

* **Feature 3 ist vollständig unabhängig** — keine Berührung mit 1 oder 2.
* **Feature 2 ist teilabhängig von 1**: „Termin bestätigen" ist eine der drei Nachfass-Aktionen.
  Existiert Feature 1, ist ihr Ergebnis ein echter Termin statt Freitext. Baut man 2 zuerst,
  baut man das Ergebnisfeld zweimal.
* **Feature 1 ist das grösste** und das einzige mit Backend- und Agenten-Strecke.

**Empfohlene Reihenfolge: 3 → 1 → 2.**

1. **3 zuerst** — klein, isoliert, sofortiger Vertrauenseffekt. Liefert ausserdem das Muster
   „Kunde korrigiert KI-Ausgabe, Original bleibt erhalten", das Feature 2 direkt wiederverwendet.
2. **1 danach** — zieht die zweite Achse (Termin-Zustand) ins Detail ein. Jede spätere Änderung
   an Aktionszeile und Kopfzeile wird billiger, wenn diese Achse steht.
3. **2 zuletzt** — kennt dann alle drei Ausgänge (Rückruf / Offerte / Termin) und wird in einem
   Zug gebaut statt in zwei.

Vertretbare Alternative, wenn der Geschäftswert von „Termin einbuchen" vor dem Piloten am höchsten
wiegt: **1 → 3 → 2**. Nicht empfehlenswert ist **2 vor 1**.

---

### B2. Feature 3 — KI-Zusammenfassung korrigieren (~1–2 Tage)

**Datenmodell** — `calls` um drei Spalten erweitern, `call_summary` bleibt unangetastet:

```
call_summary_corrected      text
call_summary_corrected_at   timestamptz
call_summary_corrected_by   text        -- user id
```

**Lesepfad** — zwei Stellen, nicht eine:
`vxGetCallSummary()` (`index.html:17608`) und `shared/customer-call-view-model.js:105`.
In beiden rückt `call_summary_corrected` an die Spitze der Schlüsselkette; Liste, Heute und Detail
ziehen dann automatisch mit.

**Schreibpfad** — eigene Funktion `call-save-summary-correction` statt Erweiterung von
`call-save-followup`. Grund: Letztere fährt einen Status-Übergang mit (`follow_up_at` gesetzt →
`follow_up_scheduled`, `call-save-followup.js:115`–`119`), den eine Textkorrektur nicht auslösen darf.

**UI** — in der Anliegen-Karte, **kein neues Modal** (13 Dialoge sind gerade erst vereinheitlicht
worden). Der Metatext rechts in der Kopfzeile trägt den Zustand:

* unverändert → „Automatisch erstellt" + Stift-Aktion
* korrigiert → „Von dir korrigiert" + „Original ansehen"

Bearbeiten inline als Textarea nach dem Muster der Notiz-Karte, gleiche Button-Optik
(`.vx-dv2-btn-primary`, Night).

**Abnahme** — der entscheidende Test: Post-Call-Webhook nach der Korrektur erneut feuern lassen
und prüfen, dass die Korrektur steht und der Eintrag nicht auf `new` zurückspringt.

**Offene Produktfrage:** Soll die Korrektur als Signal an ElevenLabs zurückfliessen?
*Vorschlag: nein, nicht in diesem Schritt* — nur speichern und anzeigen.

---

### B3. Feature 1 — Termin einbuchen (~3–4 Tage + Aktivierung)

**(a) Modus-Einstellung**

`calendar_settings` + `booking_mode text not null default 'request_only'
check (booking_mode in ('request_only','direct_booking'))`.
UI: aus dem Häkchen „Buchungen durch Assistent erlauben"
(`customer-runtime-calendar-settings.js:127`) werden zwei benannte Optionen. Der Prompt-Sync liest
den Modus mit und hängt die Buchungsanweisung nur bei `direct_booking` an.
Lara entscheidet dabei nichts selbst — sie folgt der vorab konfigurierten Vorgabe.

**(b) Die fehlende Brücke Buchung → Anfrage**

Neue Tabelle:

```
call_appointments
  id, customer_id, call_id, status ('requested'|'booked'|'rescheduled'|'cancelled'),
  starts_at timestamptz, ends_at timestamptz, timezone,
  provider, external_event_id, event_url,
  created_by ('assistant'|'customer'), booking_audit_id, note,
  created_at, updated_at        -- RLS analog calls
```

Zum Buchungszeitpunkt existiert der Call-Datensatz oft noch **nicht** (er entsteht erst im
Post-Call-Pfad). Deshalb zweistufig:

1. `calendar-tool.js` schreibt die `conversation_id` mit in `calendar_booking_audit.details`
   (billig, auch rückwirkend nützlich).
2. `elevenlabs-post-call.js` stellt beim Anlegen/Aktualisieren des Call-Datensatzes die
   Verknüpfung her und legt die `call_appointments`-Zeile an.

**(c) Dashboard-Aktionen**

Neue Funktion `call-appointment-action` (`book`/`reschedule`/`cancel` mit `actor_type: 'customer'`),
die intern dieselbe Provider-Schicht nutzt. Achtung: `reschedule`/`cancel` prüfen heute über
`calendar_booking_audit`, dass das Event von Voxera stammt (`calendar-tool.js:147`–`157`) — für
Kundenaktionen muss derselbe Nachweis greifen.

**(d) Die zwei Detail-Zustände**

| | Zustand A — Terminanfrage | Zustand B — Termin gebucht |
|---|---|---|
| Akzent | Night | Grün |
| Karte | Wunschzeit aus dem Gespräch, über dem Anliegen | Datum/Zeit/Kalender, über dem Anliegen |
| Primäraktion | „Termin einbuchen" | — |
| Weitere Aktionen | wie heute | „Verschieben" / „Stornieren" statt „Einbuchen" |
| Chip im Header | „Terminanfrage" | „Termin gebucht" (`chipHtml(..., 'green')`) |

**Farbregel beachten:** Grün ist im System **Zustandston** (Abschluss/Erfolg) und vererbt sich
laut S6-Entscheidung nicht auf Aktionen. Also grüner Akzent an der Karte, aber „Verschieben"/
„Stornieren" bleiben neutrale bzw. Night-Buttons.

**(e) Sichtbarkeit**

Zustand B nutzt das bestehende `read_at`-Muster: kurz in „Braucht dich" zur Kenntnisnahme,
verschwindet nach dem ersten Öffnen, bleibt dauerhaft unter Filter „Geplant".
**Hier wird E1 konkret:** Der Geplant-Filter kennt heute nur `follow_up_at`. Entweder
`call_appointments.starts_at` wird zweite Quelle in `vxGetEntryLifecycleStatus()`, oder die eigene
Achse liefert einen eigenen Filterbeitrag. Das ist die teuerste Einzelstelle des Features.

**(f) Bestätigungsmail**

Checkbox „Bestätigungsmail an Kunde senden" (Standard: an) über die bestehende Make-Strecke.
**Offene Lücke:** `calls` hat **keine E-Mail-Spalte**. Entweder wird die Adresse im Buchungsdialog
erfasst, oder das Feature greift nur, wo eine Adresse vorliegt. Muss vor der Umsetzung entschieden
werden.

**(g) Aktivierung**

`feature_enabled` steht auf `false`, dazu die zwei Env-Schalter. Reihenfolge wie im
Provisioning-Dokument: erst Testkunde in `CALENDAR_ROLLOUT_CUSTOMER_IDS`, dann `*`.

---

### B4. Feature 2 — Rückruf-Ergebnis festhalten (~1–2 Tage, +½ Tag falls vor Feature 1)

**Datenmodell** — geplante Nachfassaktionen landen in **zwei** Tabellen (`calls` bei offenen,
`customer_tasks` bei erledigten Einträgen). Beide brauchen das Ergebnis, sonst ist ausgerechnet der
Fall „Nachfassen aus erledigtem Eintrag" nicht nachvollziehbar.

```
outcome       text  check in ('reached','not_reached','appointment_booked',
                              'offer_sent','no_interest','other')
outcome_note  text
outcome_at    timestamptz
outcome_by    text
```

*Alternative:* eine gemeinsame Tabelle `follow_up_outcomes` mit `entity_type`/`entity_id`.
Sauberer, wenn die Fakturierung wirklich darauf zugreifen soll — teurer in der Umsetzung.
**Diese Wahl hängt daran, ob „Fakturierung" auswerten oder nur belegen heisst.**

**UI** — **kein neues Modal**, sondern ein Schritt im bestehenden Erledigen-Fluss.
`vxCallDetailErledigt()` (`19163`) öffnet heute direkt den Bestätigungsdialog; daraus wird ein
Dialog mit Ergebnisauswahl (3–4 Chips) plus optionaler Notiz — **aber nur, wenn der Eintrag
überhaupt eine geplante Nachfassaktion hat.** Ein einfacher Anruf ohne Plan behält den
unveränderten Dialog, sonst bestraft man den Normalfall.

Zusätzlich: eine Ergebnis-Karte am erledigten Eintrag, nachträglich sicht- und änderbar — sonst
hängt die Nachvollziehbarkeit am Moment des Klicks. Der Schrittpfad (`37233`–`37250`) bekommt
einen dritten Schritt „Erledigt · \<Ergebnis\>".

Existiert Feature 1, verlinkt die Option „Termin gebucht" auf den echten Termin statt auf Freitext.

---

## Teil C — Was ich empfehle, nicht zu tun

1. **„Termin gebucht" nicht als fünften `dashboard_status`** einführen — CHECK-Constraint,
   Übergangstabelle, Filterlogik und Heute-Zählung sind vier Stellen, alle bereits Bugquelle.
2. **`call_summary` nicht überschreiben** — der Post-Call-Webhook gewinnt sonst irgendwann.
3. **Keine neuen Modals**, wo eine Karte reicht. Die Modal-Linie (S1–S11) ist gerade erst
   abgeschlossen; jeder neue Dialog kostet Dialog-Vertrag, Fokusfalle, Escape-Eintrag und z-Ebene.

---

## Teil D — Entscheidungen (getroffen am 08.08.2026)

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Reihenfolge | **3 → 1 → 2** |
| 2 | E1: Termin als eigene Achse oder fünfter Zustand? | eigene Achse |
| 3 | E2: eigene Tabelle `call_appointments` oder Spalten auf `calls`? | eigene Tabelle |
| 4 | E3: `booking_mode` als Spalte oder `feature_enabled` umdeuten? | eigene Spalte |
| 5 | Bestätigungsmail: woher kommt die Empfängeradresse? | **im Buchungsdialog erfassen** — eigene Spalte an `call_appointments`, damit die Mail auch greift, wenn Lara keine Adresse erfragt hat |
| 6 | Ergebnis: Spalten an beiden Tabellen oder gemeinsame Tabelle? | **Spalten an `calls` und `customer_tasks`** — „Fakturierung" heisst belegen, nicht auswerten. Keine Tabelle `follow_up_outcomes` |
| 7 | Fliesst die KI-Korrektur an ElevenLabs zurück? | nein, nicht in diesem Schritt |

### Umsetzungsstand

| Feature | Stand |
|---|---|
| 3 — KI-Zusammenfassung korrigieren | **umgesetzt** (siehe unten) |
| 1 — Termin einbuchen | offen |
| 2 — Rückruf-Ergebnis festhalten | offen |

**Feature 3 — was gebaut wurde**

* Migration `supabase/sql/2026-08-08_call_summary_correction.sql`: drei Spalten
  `call_summary_corrected`, `call_summary_corrected_at`, `call_summary_corrected_by` an `calls`.
  Bewusst **ohne** Erweiterung des spaltengenauen UPDATE-Rechts von `authenticated`.
* Schreibpfad `customer-dashboard/netlify/functions/call-save-summary-correction.js`:
  Service-Role, Ownership-Prüfung, schreibt ausschliesslich die drei Spalten. Leerer Text nimmt
  die Korrektur zurück.
* Lesepfad: `vxGetCallSummary()` und `customer-call-view-model.js` führen `call_summary_corrected`
  an der Spitze. Zusätzlich wurden die Vorschautexte in Anfragen-Liste, Archiv, Heute,
  Prioritätsliste, Tagesbericht, CSV-Export, Suche und E-Mail-Weiterleitung auf den kanonischen
  Getter umgestellt — vorher lasen sie `f.call_summary` direkt, die Korrektur wäre dort unsichtbar
  geblieben.
* **Nicht umgestellt, mit Absicht:** `getCallDisplayState()`, die Testanruf-Heuristik und
  `isAnalysisPending()` im View-Model. Sie fragen „hat die KI etwas geliefert" — eine Kundeneingabe
  darf dort nicht als Analyse durchgehen, sonst verschwindet „Wird ausgewertet" zu früh.
* UI: Anliegen-Karte mit zwei Zuständen, Inline-Bearbeitung, Aufklapper „Original ansehen",
  „Korrektur entfernen". Kein neues Modal.
* Abnahme: `customer-dashboard/tests/call-summary-correction.test.cjs` (17 Fälle),
  Workflow `verify-call-summary-correction.yml`.

### Abnahme Feature 3 — Stand 08.08.2026

Migration ist auf Produktion angewandt (Ledger-Eintrag `call_summary_correction`,
Projekt `ulcofbgrovgcvowdjrge`). Prüfskript:
`supabase/verification/call_summary_correction_post_migration.sql`.

| # | Prüfung | Ergebnis |
|---|---|---|
| 1 | Drei Spalten vorhanden, `_at` als `timestamptz` | **grün** |
| 2 | UPDATE-Recht `authenticated` unverändert bei vier Spalten | **grün** |
| 3 | Korrekturspalten lesbar, aber nicht vom Browser schreibbar | **grün** |
| 4a | Korrektur überlebt einen zweiten Post-Call-Webhook | **grün** |
| 4b | Eintrag springt dabei nicht auf `new` zurück | **rot — Bestandsverhalten, siehe unten** |

Zu 4a: der Webhook-Lauf überschrieb `call_summary`, `call_summary_corrected`
und `call_summary_corrected_at` blieben zeichengenau stehen. Das ist der Kern
der Entwurfsentscheidung und er hält.

Zu 4b: **das Zurückspringen hat nichts mit Feature 3 zu tun.** Beide
Payload-Builder des Webhooks setzen `dashboard_status = 'new'` bedingungslos —
`elevenlabs-post-call.js:266` (Webhook-Pfad) und `:365` (Tool-Call-Pfad). Das
passiert mit wie ohne Korrektur und trifft jeden Eintrag, dessen Webhook ein
zweites Mal eintrifft: ein abgeschlossener Vorgang wandert zurück in den
Posteingang. Die Korrektur macht diesen Bestandsfehler nur sichtbar.

Minimaler Fix (**nicht umgesetzt, Entscheidung offen**): kein Downgrade des
Lebenszyklus. Steht der Datensatz bereits auf `closed`, `archived` oder
`follow_up_scheduled`, lässt der Webhook `dashboard_status` unangetastet und
schreibt nur die Inhaltsfelder. Beide Pfade lesen den gematchten Datensatz
ohnehin schon, der Status wäre im selben Zug mitzulesen. Betrifft das
Lebenszyklus-Verhalten aller Anrufe, nicht nur korrigierte — deshalb eine
eigene Entscheidung und ein eigener Commit.

**Nicht live geprüft, mit Begründung:**

* Der Webhook wurde nicht über HTTP gefeuert — `ELEVENLABS_WEBHOOK_SECRET`
  liegt nicht in dieser Umgebung. Ausgeführt wurde der exakte Spaltensatz, den
  `buildUpdatePayloadFromData()` schreibt, gegen die echte Produktionstabelle.
  Die HMAC-Prüfung und das Payload-Mapping davor sind damit nicht abgedeckt.
* `call-save-summary-correction` wurde nicht über HTTP aufgerufen: die Function
  liegt auf dem Feature-Branch und ist noch nicht deployed. Ausgeführt wurde
  ihr Patch-Objekt unverändert.
* Die UI wurde nicht im Browser bedient — kein Deployment, keine Sitzung.

Die Testzeile trug `customer_id = NULL` und war über RLS für keinen Kunden
sichtbar; sie wurde nach dem Lauf gelöscht (Rückstandsprüfung: 0 Zeilen).

---

## Aufwand

| Feature | Schätzung |
|---|---|
| 3 — KI-Zusammenfassung korrigieren | 1–2 Tage |
| 1 — Termin einbuchen (Modus + zwei Zustände + Brücke + Aktivierung) | 3–4 Tage |
| 2 — Rückruf-Ergebnis festhalten | 1–2 Tage |
| **Summe** | **5–8 Tage** |

Die Kommandozentrale führt 4–7 Tage. Die Differenz ist **eine** Position: die fehlende Brücke
zwischen Buchung und Anfrage (A4/B3b) war in der ursprünglichen Schätzung nicht enthalten — dort
wurde angenommen, die Kalenderstrecke sei nur zu aktivieren. Aktiviert ist sie schnell; sichtbar
wird die Buchung im Anfrage-Detail dadurch nicht.
