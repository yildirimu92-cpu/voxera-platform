# Assistent-Tab — Informationsarchitektur: Diagnose und Zielgliederung

**Datum:** 09.08.2026
**Status:** Diagnose und Empfehlung. **D3 und F7 sind am 09.08. freigegeben und umgesetzt** (siehe Nachtrag unten); alles Übrige wartet weiterhin auf Freigabe.
**Prüfstand:** `main` @ `ed1d95e`, Produktionsdatenbank `ulcofbgrovgcvowdjrge` (Live-Abgleich, nicht aus Dokumenten übernommen).
**Grundlage:** `docs/ASSISTENT_TAB_NORTH_STAR_2026-08-08.md`, `docs/ETAPPE_6_BRIEFINGS_2026-08-08.md`, Auftrag „Assistent-Tab — Informationsarchitektur überarbeiten" (09.08.).

---

## 0. Kurzfassung

1. **Das North-Star-Dokument ist inhaltlich gültig, in seinem Ist-Zustands-Teil aber überholt.** S1–S4 sind gebaut und gemergt; die dort beschriebenen Symptome F1–F4 existieren nicht mehr. Gültig bleiben das Zielbild („Der Steckbrief spricht"), F5 (doppelte Karten-Logik) und F7. Abschnitt 1 listet auf, welche Sätze im Dokument beim Lesen zu ignorieren sind.

2. **Die Vier-Kategorien-Struktur ist richtig — aber ihre Sortierachse ist nicht „Verbindlichkeit", sondern Änderungsfrequenz.** Das ist kein Wortstreit: Verbindlichkeit ist eine zweite, unabhängige Achse (wer darf ändern), und genau ihr Fehlen erzeugt das heutige Problem. Empfehlung: vier Kategorien beibehalten, aber jede Kategorie sagt zusätzlich, **woher ihr Inhalt kommt und wer ihn ändern darf**. Damit fällt S5 (Layer-Sichtbarkeit) mit dieser Umgliederung zusammen statt daneben zu stehen.

3. **Die drei gleichrangigen Unterbereiche sind nicht das Problem, sie sind das Symptom.** Sie versprechen drei gleichwertige Bearbeitungsflächen. Tatsächlich ist genau *eine* ein Formular (Geschäftsprofil), eine ist ein Erfassungsdialog (Aktuelle Infos) und eine ist eine gemischte Statusseite mit vier Bearbeitungsinseln. Abschnitt 3 zeigt die Feldkarte dazu.

4. **Die 19 Branchenvorlagen beantworten die Frage „was sollen KMUs unterschiedlicher Branchen eintragen können" bereits weitgehend** — inklusive der branchenspezifischen Zusatzfelder, die in `industry_templates.extra_steps` als fertiges Feldschema (Typ, Label, Hinweis, Optionen) hinterlegt sind. Es sollten **keine neuen Felder für Branchenspezifik entworfen werden**; es fehlt die Sichtbarkeit, nicht der Inhalt. Details in Abschnitt 5.

5. **A3 (Branchenzuordnung) hat eine harte technische Vorbedingung, die bisher nirgends notiert ist.** Drei Vorlagen (`handwerk`, `garage`, `versicherung`) enthalten Platzhalter wie `{{notfallnummer_dringend}}`, die der Prompt-Builder **nicht auflöst**. Wer heute einen Handwerksbetrieb zuordnet, schickt dem Agenten wörtlich „Notfall-Nummer nennen: `{{notfallnummer_dringend}}`". Latenter Fehler, weil aktuell nur `it-support` zugeordnet ist — er wird durch A3 aktiviert. Siehe D3.

6. **F7 ist entscheidbar und die Antwort steht im Code schon.** Blau ist keine fünfte Bedeutungsfamilie, sondern eine funktionale Kategorie (interaktiv/Zustand). Der Token-Pass hat das bereits umgesetzt: Primäraktionen sind Night, Blau trägt Links, Fokus, Auswahl, Fortschritt, Info. Der Widerspruch ist reine Dokumentationsschuld — mit einer Ausnahme, die echt ist: **„ungelesen" steht in der Regel unter Rot, ist aber überall in Blau gebaut.** Abschnitt 6 löst beide Hälften.

7. **Sieben neue Funde**, alle am Code oder an der Live-Datenbank verifiziert (Abschnitt 7). Zwei davon sind echte Regressionen aus S1, einer ist der Platzhalter-Fund aus Punkt 5, einer ist eine doppelte Datenhaltung für genau die Branchendaten, um die es hier geht.

---

## 1. Ist das North-Star-Dokument noch aktuell?

**Teilweise. Als Zielbild ja, als Ist-Zustands-Beschreibung nein.** Seit dem 08.08. sind alle vier launch-kritischen Schritte gebaut:

| Schritt | Commit / PR | Wirkung auf das Dokument |
|---|---|---|
| S2 Kopfbereich | `13c726f`, PR #841 | **F1 behoben.** Begrüssungssatz ist sichtbar (`heroCard()`), Quelle `ai_effective_greeting` → `ai_greeting` → Platzhalter. |
| S3 Ton & Anrede | `bf33624`, PR #845 | **F2 behoben, A1 enthalten.** Editor im Kopfbereich, `plan_config.allow_custom_tone` wird gelesen **und** serverseitig durchgesetzt (`customer-update-assistant.js:121–126`). |
| S4 Dringlichkeit | `ee79a82`, PR #839 | **F3 behoben.** `urgentCard()` zeigt Notfallnummer und Weiterleitungen read-only; Änderungsanfrage läuft über `ai-change-request-create`. |
| S1 Alt-Block | `ba92830`, PR #846 | **F4 und die verwaiste Karte behoben.** −1181 Zeilen. |

**Was im Dokument beim Lesen zu ignorieren ist:** Abschnitt 1.1 (Vier-Quellen-Tabelle mit Alt-Screen), 1.2 (Kartenbeschreibung der Ansicht 1), 1.3 (verwaiste Karte), F1–F4 in 1.4, sowie die Zeilenangaben im Anhang für `index.html`.

**Was unverändert gilt:** das Zielbild in Teil 2 (2.1 North Star, 2.3 A–F), die Design-Sprache in 2.4, die Prompt-Architektur in 1.5, F5 (nachgeprüft, siehe D6), F7 (siehe Abschnitt 6), sowie die Aufträge A2, A3, A4.

**Eine Einordnung, die das Dokument nicht treffen konnte:** S2–S4 haben die Symptome behoben, aber die Gliederung nicht angefasst — sie haben dem Screen drei weitere Karten hinzugefügt. Der Assistent-Tab hat heute **sieben Karten in einer Ansicht** statt fünf. Der aktuelle Auftrag ist damit nicht die Korrektur eines Fehlers, sondern der fällige zweite Schritt: erst wurde die Substanz zurückgeholt, jetzt braucht sie eine Ordnung.

---

## 2. Ist-Zustand — vollständige Kartierung

### 2.1 Ansicht 1 „Assistent" (`renderAssistant()`, `customer-runtime-assistant-profile.js:386`)

Sieben Karten, in dieser Reihenfolge im DOM:

| # | Karte | Inhalt | Bearbeitbar? | Quelle |
|---|---|---|---|---|
| 1 | **Kopfbereich** „So meldet sich Ihr Assistent" | Begrüssungssatz (Stimmenrolle), Meta-Zeile `Stimme · Anrede · Ton`, „Anhören", aufklappbarer Ansprache-/Ton-Editor, **eine** Statuszeile | Anrede: alle Pläne · Ton: `allow_custom_tone` · Begrüssung: nein (bewusst) | `greeting`, `assistant`, `technical_status` |
| 2 | **Stimme** | Aktuelle Stimme + Aufklapper „Andere Stimme wählen" (Filter, Kacheln, Bestätigungsdialog) | `voice_selection_enabled` | `get-available-voices` |
| 3 | **Name und Auftreten** | Namensfeld + Speichern; darunter Lesezeilen *Kommunikationsstil*, *Ansprache*, *Assistent bereit* | Name: `allow_custom_assistant_name` · Rest: nein | `assistant` |
| 4 | **Fähigkeiten** | Sechs abgeleitete Fähigkeiten mit Status | nein (korrekt) | `capabilities`, injiziert von `customer-runtime-assistant-status.js` |
| 5 | **Geschäftswissen** | Pill „x von 4 Bereichen", Lesezeilen *Unternehmen / Leistungen / Öffnungszeiten*, Button „Geschäftsprofil öffnen" | nein (verlinkt) | `business_profile` |
| 6 | **Wenn es dringend wird** | Notfallnummer (rot), Weiterleitungsziel 1/2, Erklärsatz, „Änderung melden" + Anliegen-Vorlagen + Freitext | nein, aber Meldeweg | `urgent` |
| 7 | **Betriebsstatus** | `<details>` „Technische Details" — **erscheint nur bei Abweichung** | nein | `technical_status` |

### 2.2 Ansicht 2 „Geschäftsprofil"

Eine Karte, vier Textareas (`ai_business_description`, `ai_services`, `ai_location_hours`, `ai_booking_faq`), ein Speichern-Button. Unverändert gegenüber dem North-Star-Befund: sauber, aber ein Formular ohne Rückmeldung, was die Eingabe im Gespräch bewirkt.

### 2.3 Ansicht 3 „Aktuelle Infos"

Zwei Karten: links „Aktiv und geplant", rechts „Neue aktuelle Änderung" (6 Vorlagen, Zeitraum, empfohlene Gesprächslogik, Vorschau-Satz, zwei `<details>` für Feinjustierung, fixierte Regeln). Weiterhin der beste Teil des Screens — es ist der einzige Bereich, der zeigt, *was die Eingabe im Gespräch bewirkt*.

### 2.4 Die Feldkarte — was den Agenten erreicht und was der Kunde davon sieht

Grundlage: alle Felder, die `buildPromptV2()` tatsächlich liest (`prompt-builder-v2.js:178–265`), abgeglichen gegen `customer-assistant-profile.js` (Anzeige) und `customer-update-assistant.js` (Schreibrechte).

| Feld / Quelle | Erreicht den Agenten | Im Kunden-UI sichtbar | Vom Kunden änderbar |
|---|---|---|---|
| `assistant_name` | ja | ja | ja, `allow_custom_assistant_name` |
| `voice_id` | ja (Rolle m/w) | ja | ja, `voice_selection_enabled` |
| `ai_tone` | ja | ja | ja, `allow_custom_tone` |
| `ai_address_form` | ja | ja | ja, alle Pläne |
| `ai_greeting` / `ai_effective_greeting` | ja | ja (Vorschau) | **nein — bewusst** |
| `ai_business_description` | ja | ja | ja |
| `ai_services` | ja | ja | ja |
| `ai_location_hours` | ja | ja | ja |
| `ai_booking_faq` | ja | ja | ja |
| `customer_operational_updates` | ja | ja | ja |
| `ai_emergency_number` | ja | ja | nein, Meldeweg (S4) |
| `ai_forwarding_1/2_*` | ja | ja | nein, Meldeweg (S4) |
| `ai_instructions` | ja | **nein** | nein — `BLOCKED_CUSTOMER_FIELDS` |
| `ai_fallback_escalation` | ja | nur indirekt (Fähigkeiten-Ableitung) | nein — blockiert |
| `ai_response_constraints` | ja | **nein** | nein — blockiert |
| `ai_language` | ja | **nein** | nein (`allow_custom_language`, nur Professional, ungenutzt) |
| `selected_languages` | **nein** | nein | nein — zweite, tote Quelle |
| `ai_customer_type` | ja (Wir/Ich, Begrüssungsform) | **nein** | nein (`allow_custom_customer_type`, ungenutzt) |
| `ai_person_name` | ja (Begrüssung bei Einzelperson) | **nein** | nein |
| `ai_internal_notes` → `[PROMPT_V2]` (Funktionen, Pflichtinfos, Erfolgskriterium, Terminbefugnis, Fallback) | ja | nur als abgeleitete „Fähigkeiten" | nein |
| `ai_internal_notes` → `[WIZARD]` (Termin-Modus, Buchungslink, Sprachen, häufige Anliegen, Allergien, Pannendaten, Take-away) | ja | **nein** | nein |
| `ai_branch_extra` (jsonb) | **nein** — wird von niemandem gelesen | nein | nein |
| `industry_templates.prompt_block` (Layer 2) | ja | **nein** | nein |
| `system_config.prompt_master_l1` (Layer 1) | ja | **nein** | nein (korrekt) |

**Zahl dazu:** Von 24 Eingangsgrössen des Prompts sind **10 im Kunden-UI sichtbar**, **9 änderbar** und **11 unsichtbar** — darunter mit `ai_response_constraints` ausgerechnet das Feld, das der eigene Qualitätscheck (`qualityReport()`, `prompt-builder-v2.js:168`) als **Launch-Blocker** führt.

---

## 3. Diagnose — warum die drei Unterbereiche nicht passen

Der Auftrag beschreibt das Symptom richtig: die Gliederung spiegelt nicht, wie die Felder zusammengehören. Die Ursache liegt eine Ebene tiefer.

**Die drei Unterbereiche sind nach Inhalt geschnitten, aber der Screen wird nach Zuständigkeit gelesen.** Ein sichtbarer Umschalter mit drei gleichrangigen Punkten macht ein Versprechen: hier sind drei gleichwertige Bereiche, in denen ich arbeiten kann. Tatsächlich sind es drei völlig verschiedene Interaktionsarten:

- **„Geschäftsprofil"** ist ein Formular. Man tippt, man speichert.
- **„Aktuelle Infos"** ist ein Erfassungsdialog mit Vorschau. Man wählt eine Situation, das System schlägt Regeln vor.
- **„Assistent"** ist keine der beiden. Es ist eine Statusseite mit vier eingestreuten Bearbeitungsinseln (Ton/Anrede im Kopf, Stimme im Aufklapper, Name in Karte 3, Meldeweg in Karte 6) und drei reinen Leseflächen dazwischen.

Daraus folgen die drei konkreten Beschwerden:

**(a) Zusammengehöriges steht auseinander.** Ansprache und Ton stehen im Kopfbereich (S3), dieselben zwei Werte stehen 250 Pixel tiefer nochmal als Lesezeilen in „Name und Auftreten" (D7). Der Name steht in Karte 3, obwohl er den Satz in Karte 1 erzeugt. Die Stimme steht in Karte 2, obwohl die Meta-Zeile in Karte 1 sie bereits nennt.

**(b) Der Einstiegssatz ist nirgends direkt einsehbar — das stimmt heute nicht mehr,** aber der dahinterliegende Punkt bleibt richtig: Der Kunde sieht den Satz, versteht aber nicht, **welche Felder ihn erzeugen**. Genau das ist die IA-Aufgabe: Name, Stimme, Anrede, Ton und Sprache gehören sichtbar zu diesem Satz, weil sie ihn bilden.

**(c) Was fehlt, sieht aus wie „gibt es nicht".** Elf prompt-relevante Grössen kommen im UI nicht vor. Für den Kunden ist das nicht „von Voxera verwaltet", sondern schlicht unsichtbar. Deshalb entsteht die Frage aus dem Auftrag — „was sollen KMUs unterschiedlicher Branchen eintragen können" — überhaupt: Die Antworten existieren bereits, sie sind nur nicht adressierbar.

**Die fehlende Achse ist Verbindlichkeit im Sinn von *wer darf ändern*.** Der Screen kennt heute vier verschiedene Antworten darauf — direkt änderbar / ab Business änderbar / read-only mit Meldeweg / gar nicht vorhanden — und markiert nur eine davon (den Gold-Hinweis „ab Business"). Wenn diese Achse explizit wird, ordnen sich die Felder fast von selbst, und die Vier-Kategorien-Struktur fällt mit S5 (Layer-Sichtbarkeit, E4) zusammen.

---

## 4. Bewertung der Vier-Kategorien-Struktur

### 4.1 Die Kategorien selbst: tragfähig

| Vorschlag | Bewertung |
|---|---|
| **1 Kernidentität** — Name, Stimme, Anrede, Ton, Sprache, Begrüssung als Vorschau | **Richtig und grösstenteils schon gebaut.** Fasst die heutigen Karten 1–3 zusammen und beseitigt die Doppelung D7. Ein Zusatz: `Sprache` gehört fachlich hierher, existiert im UI aber gar nicht und hat zwei Datenquellen (D5) — die Kategorie darf ohne Sprache starten, aber die Lücke sollte benannt werden. |
| **2 Geschäftswissen** — Leistungen, Standort/Öffnungszeiten, häufige Fragen | **Richtig, deckt sich 1:1 mit der heutigen Ansicht 2.** Hier gehört die Branchenspezifik hinein (Abschnitt 5). |
| **3 Grenzen und Eskalation** | **Richtig als Anzeigekategorie, aber sie mischt zwei Schreibregeln.** Weiterleitung/Notfall sind read-only aus Betriebsgründen (N6: Änderung erreicht den Agenten erst beim nächsten Sync). `ai_response_constraints` / `ai_instructions` sind read-only aus Sicherheitsgründen (`BLOCKED_CUSTOMER_FIELDS`). Für den Kunden ist beides „nicht selbst änderbar, aber meldbar" — als **Regelblatt** funktioniert die Kategorie, als Formular nicht. Das ist auch die Antwort auf „branchenabhängig unterschiedlich scharf": die Schärfe kommt aus der Branchenvorlage, nicht aus einem Kundenfeld. |
| **4 Aktuell** | **Richtig und bereits entschieden** (E3/S6: als Band statt Reiter). Die Trennung temporär/dauerhaft ist die einzige, die der Screen heute schon sauber macht. |

**Antwort auf die Auftragsfrage:** Ja, die Vier-Kategorien-Struktur passt. Ich schlage keine andere Gliederung vor, sondern zwei Präzisierungen.

### 4.2 Präzisierung 1 — die Sortierachse benennen

Der Vorschlag sagt „sortiert nach Verbindlichkeit". Tatsächlich sortiert er nach **Beständigkeit**: Identität ändert sich fast nie, Wissen gelegentlich, Grenzen selten aber sicherheitsrelevant, Aktuelles wöchentlich. Das ist eine gute Achse und sie sollte so benannt werden — „Verbindlichkeit" liest sich sonst wie „Priorität" und kollidiert mit der zweiten Achse:

**Achse A (Reihenfolge auf dem Screen): Beständigkeit.** Kernidentität → Geschäftswissen → Grenzen → Aktuell.
**Achse B (Beschriftung innerhalb jeder Kategorie): Herkunft und Änderbarkeit.** Drei Zustände, mehr nicht:

- **Von Ihnen gesetzt** — direkt änderbar (ggf. mit Gold-Plan-Hinweis).
- **Von Voxera gesetzt** — nicht änderbar, mit einem Satz warum. Enthält Layer 1 (Sicherheitsregeln) und die betrieblich bestätigten Felder (Weiterleitung, Notfall) mit dem bestehenden Meldeweg.
- **Aus Ihrer Branche** — kommt aus der Vorlage, nicht änderbar, Wechsel über Meldeweg.

Damit ist E4 („nur Kategorien, nie Prompt-Wortlaut") erfüllt, S5 ist keine separate Etappe mehr, und die vierte, heute unbeschriftete Antwort („gar nicht vorhanden") verschwindet, weil jedes prompt-relevante Feld genau einem der drei Zustände zugeordnet wird.

### 4.3 Präzisierung 2 — vier Kategorien sind keine vier Reiter

**Empfehlung: der Assistent-Tab wird ein Screen mit vier Abschnitten, plus zwei Drill-ins.** Der Umschalter entfällt vollständig.

```
Assistent                                        ← .vx-appbar, jetzt mit Zurück-Pfeil in den Drill-ins
┌──────────────────────────────────────────────────────────┐
│ AKTUELL ABWEICHEND VOM NORMALBETRIEB    (nur wenn aktiv) │  ← Kategorie 4, Band
└──────────────────────────────────────────────────────────┘
┌─ So meldet sich Ihr Assistent ───────────────────────────┐
│ Begrüssungssatz (Stimmenrolle, Vorschau + Erklärung)     │  ← Kategorie 1
│ Name · Stimme · Anrede · Ton · (Sprache)   [Anhören]     │     Von Ihnen gesetzt
│ eine Statuszeile                                          │
└──────────────────────────────────────────────────────────┘
┌─ Was Ihr Assistent weiss ────────────────────────────────┐
│ 4 Bereiche + Branchen-Zusatzfelder    [Bearbeiten →]     │  ← Kategorie 2, Drill-in
│ Ihre Branche: <Vorlage> / noch nicht zugeordnet          │     Von Ihnen + Aus Ihrer Branche
└──────────────────────────────────────────────────────────┘
┌─ Grenzen und Eskalation ─────────────────────────────────┐
│ Notfallnummer (rot) · Weiterleitungen                    │  ← Kategorie 3, Regelblatt
│ Was der Assistent nicht beantwortet (Kategorien)          │     Von Voxera + Aus Ihrer Branche
│ Immer gültig — von Voxera gesetzt                        │
│                                     [Änderung melden]     │
└──────────────────────────────────────────────────────────┘
┌─ Was Ihr Assistent kann ─────────────────────────────────┐
│ Fähigkeiten (unverändert)                                │
└──────────────────────────────────────────────────────────┘
```

**Warum kein Umschalter:**

- E3 hat bereits 3 → 2 entschieden. Der Weg von 2 auf 0 ist kleiner als der von 3 auf 2, weil beide verbleibenden Unterbereiche echte Formulare sind — also genau das, wofür der Drill-in-Mechanismus schon existiert (`customer-runtime-screen-navigation.js`, History-Eintrag + Zurück-Pfeil + Wisch-Geste).
- Die in Etappe 2 bewusst gemachte Ausnahme „Assistent-Root bleibt pfeillos, weil die drei Unterbereiche ein sichtbarer Tab-Switch sind" fällt damit weg. Der Assistent-Tab verhält sich wie jeder andere Screen.
- Vier Kategorien als vier Reiter wären eine Verschlechterung: mehr Navigation, um dieselben Inhalte zu erreichen, und die Kategorien 1/3/4 haben zu wenig Inhalt für eine eigene Seite.

**Was das gegenüber S6 bedeutet:** Diese Empfehlung **ersetzt S6**, sie kommt nicht dazu. S6 war „Aktuelle Infos als Band, Umschalter 3 → 2"; der Vorschlag hier ist „vier Abschnitte, Umschalter 3 → 0, zwei Drill-ins". Wird die Empfehlung angenommen, entfällt S6 als eigener Schritt.

### 4.4 Der Einstiegssatz — Umsetzung der bereits getroffenen Entscheidung

Nicht mehr zur Diskussion (Berater-Session 09.08.), hier nur die Konsequenz für die Gliederung: Der Satz bleibt **Vorschau, kein Eingabefeld**, und bekommt in Kategorie 1 eine kurze Erklärung, warum. Vorschlag für den Wortlaut, ohne Juristendeutsch:

> „Dieser Satz entsteht automatisch aus Name, Ansprache und Sprache und enthält den gesetzlich nötigen Hinweis auf die Aufzeichnung. Ändern Sie die Felder darunter — der Satz zieht mit."

Das ist zugleich die Antwort auf N7/A4: Sobald der Satz sichtbar erklärt, dass er mitzieht, wird eine eingefrorene `ai_greeting` (die es nicht tut) zu einem sichtbaren Widerspruch statt zu einer stillen Abweichung. **Empfehlung: A4 in dieselbe Umsetzung ziehen** — wenn `ai_greeting` gesetzt ist und vom neu erzeugten Satz abweicht, zeigt der Kopfbereich das an und bietet „auf Standard zurücksetzen". Das ist kleiner als die im Briefing angedachte Automatik und braucht keine Entscheidung über Überschreibregeln.

---

## 5. Branchenspezifik — was die 19 Vorlagen schon abdecken, und wie A3 hineinpasst

### 5.1 Was tatsächlich in `industry_templates` steht

19 Zeilen, alle `active = true`, alle mit gefülltem `prompt_block`. Pro Vorlage sieben inhaltliche Felder:

| Spalte | Inhalt | Zielkategorie |
|---|---|---|
| `default_business_description` | Beschreibungstext der Branche | **2** |
| `default_services` | typische Leistungen | **2** |
| `default_location_hours` | typische Erreichbarkeitsangaben | **2** |
| `default_booking_faq` | Aufnahme-Checkliste + häufige Fragen mit Antworten | **2** |
| `default_instructions` | Gesprächshaltung, z.B. „Patienten sind oft besorgt … KEINE medizinischen Antworten" | **3** |
| `default_fallback_escalation` | Eskalationsstufen, z.B. „Gasleck: Fenster öffnen, Gebäude verlassen, Notruf 118" | **3** |
| `default_response_constraints` | harte Verbote, z.B. „keine verbindlichen Kostenangaben ohne Besichtigung" | **3** |
| `prompt_block` | der eigentliche Layer 2: Qualifizierungs-Modus, typische Anliegen, Verhalten pro Anliegen | **3** (nur als Kategorie, nie im Wortlaut — E4) |
| `extra_steps` (jsonb) | **branchenspezifische Zusatzfelder als fertiges Feldschema** | **2** |

**Damit ist die Auftragsfrage weitgehend beantwortet:** Kategorie 2 und 3 brauchen keine neu erfundenen Felder. Kategorie 3 ist inhaltlich zu **100 %** Branchenvorlage plus die zwei betrieblichen Felder (Notfallnummer, Weiterleitung) — es gibt darin nichts, was der Kunde frei formulieren müsste.

### 5.2 `extra_steps` — die eigentliche Fundgrube

Sieben der 19 Vorlagen (`facharzt`, `versicherung`, `garage`, `hotel`, `restaurant`, `coiffeur`, `kosmetik`) tragen bereits ein vollständiges, gerendertes Feldschema: Schrittgruppen mit Titel und Unterzeile, darin Felder mit `type` (`radio`/`text`/`textarea`), `label`, `hint`, `placeholder`, `options`. Beispiele:

- **Facharzt:** Sprechstunden-Modus (24/7 / ausserhalb / Backup), Notfallnummer Lebensgefahr, Ärztlicher Notfalldienst, Name des Notfalldienstes.
- **Garage:** Einsatz-Modus, eigene Pannennummer, Verhalten bei Pannenmeldung, Termin-Modus, übliche Wartezeit.
- **Restaurant:** Reservations-Handling, Online-Reservationslink, Gruppengrösse ohne Rückruf, Take-away, Umgang mit Allergien.
- **Hotel:** Sprach-Modus, typische Gästegruppen, Reservationsanfragen, Buchungs-Link.

Das ist exakt „was soll ein KMU dieser Branche eintragen können" — bereits durchdacht, formuliert und mit Hinweistexten versehen. **Es existiert nur im Admin-Onboarding-Wizard** (`admin-panel/index.html:7322 ff.`, dynamischer Schritt-Renderer). Der Kunde sieht es nie und kann es nach dem Onboarding nicht mehr ändern.

**Empfehlung für Kategorie 2:** Das Geschäftsprofil-Formular bekommt einen zweiten, **vorlagengesteuerten Abschnitt** „Für Ihre Branche", der aus `extra_steps` gerendert wird. Kein neues Feldschema, kein neuer Renderer-Entwurf — die Definition existiert, der Admin-Renderer ist die Vorlage. Zwei Bedingungen:

1. **Die Werte müssen den Agenten erreichen.** Heute liest der Prompt-Builder ausschliesslich `ai_internal_notes` → `[WIZARD]`; die dafür angelegte Spalte `ai_branch_extra` liest niemand (D4). Vor einer Kunden-Bearbeitung muss geklärt sein, welche der beiden die Wahrheit ist — sonst schreibt der Kunde in eine Spalte, die nicht im Prompt landet.
2. **12 der 19 Vorlagen haben noch keine `extra_steps`** (u.a. `handwerk`, `anwalt`, `treuhand`, `it-support`, `zahnarzt`). Für sie zeigt der Abschnitt nichts — das ist ein ehrlicher Zustand, aber Inhaltsarbeit, die als eigener Punkt geführt werden sollte.

### 5.3 A3 (Branchenzuordnung) — zusammengedacht statt getrennt

**Ist-Stand, live geprüft:** 4 Kunden, davon 1 mit `industry_template_id` (`it-support`, Kunde „E2E Test AG"). Im gesamten Kunden-Dashboard — Frontend wie Functions — kommt das Wort `industry` **kein einziges Mal** vor. Der Kunde erfährt nirgends, ob und welche Branche für ihn hinterlegt ist.

**Die neue Struktur gibt A3 seinen natürlichen Platz.** Drei Bausteine, alle klein:

1. **Anzeige.** `customer-assistant-profile.js` liefert zusätzlich `industry: { id, name, assigned }` — ein `maybeSingle()` auf `industry_templates` neben den bestehenden Abfragen. In Kategorie 2 und 3 erscheint eine Zeile „Ihre Branche: *Elektriker / Sanitär / Handwerk*" bzw. „Ihre Branche: noch nicht zugeordnet — Ihr Assistent arbeitet ohne branchenspezifische Regeln." Das macht die tatsächliche Lücke sichtbar, statt sie zu kaschieren (North Star, 2.3 C).
2. **Änderungspfad.** Existiert bereits: `CHANGE_PRESETS` in `customer-runtime-assistant-profile.js:202` führt „Branche wechseln" als erste von vier Vorlagen. Der Meldeweg über `ai-change-request-create` ist seit S4 verankert und wird im Admin-Portal bearbeitet.
3. **Nachziehen der Zuordnung.** Bleibt Betriebsarbeit (3 Kunden), aber **nicht mehr blind**: Sobald die Anzeige steht, ist erkennbar, wer ohne Layer 2 läuft.

**Die Vorbedingung, die bisher fehlte:** Baustein 3 darf nicht vor D3 laufen (siehe unten). Eine Zuordnung zu `handwerk`, `garage` oder `versicherung` liefert dem Agenten heute unaufgelöste Platzhalter.

---

## 6. F7 — gelöst

### 6.1 Der Befund, nachgemessen

| Frage | Antwort am Code |
|---|---|
| Ist Blau tokenisiert? | Ja. `--vx-color-brand: #1A6FE8` (`customer-design-tokens.css:27`), zusätzlich `--vx-color-info`, `--vx-ui-choice-accent`, `--vx-ui-tab-accent`, `--vx-ui-field-border-focus`, `--vx-ui-spinner-head`. |
| Wie oft im Einsatz? | 125 Fundstellen im Kunden-Dashboard, davon 112 in `index.html`. |
| Trägt Blau eine geschäftliche Bedeutung? | Nein. Es trägt Links, Fokusring, aktive Chips/Filter, Auswahlzustände, Fortschritt/Spinner, Info-Badges und „ungelesen/neu". |
| Trägt Blau noch primäre Aktionen? | **Nein, seit dem Token-Pass.** `--vx-action-primary: var(--vx-color-night)` mit genau einer benannten Ausnahme (`--vx-action-primary-on-night`, Blau auf Navy-Grund). |

**Damit ist E1 nicht nur entschieden, sondern gebaut.** Die Vier-Familien-Regel und der Code widersprechen sich nur noch im Text der Kommandozentrale.

### 6.2 Die Hälfte des Widerspruchs, die echt ist

Die Regel im Tab „Design-System" lautet „Rot = Dringlichkeit/**ungelesen**". Gebaut ist ungelesen **überall in Blau**: `.vx-ni.is-unread::before` (Benachrichtigungen), `.vx-heute-row.is-unread` (Heute), `.vx-requests-item.is-unread` (Anfragen). Die Notifications-Diagnose im selben Tab sagt es sogar ausdrücklich: „dezentes Unread-Styling in Blau (Rot bewusst für Dringlichkeit reserviert)". Die Regel ist an dieser Stelle schlicht veraltet.

### 6.3 Vorgeschlagene Formulierung — beide Hälften in einem Satz

> **Vier Bedeutungsfamilien und eine funktionale Kategorie.**
> **Night-Navy** = Marke und primäre Aktion. **Rot** = Dringlichkeit im engen Sinn: Notfallnummer, Live-Anruf, echter Fehlerzustand. **Gold** = Lead-Qualität und Plan-/Badge-Akzent. **Grün** = Abschluss.
> **Blau (`--vx-color-brand`) ist keine Bedeutungsfamilie, sondern die funktionale Kategorie „interaktiv und Zustand":** Links, Fokusring, aktive Auswahl, Chips, Fortschritt, Info-Hinweise und **ungelesen/neu**.
> Prüffrage bei jeder neuen Farbverwendung: *Sagt die Farbe etwas über das Geschäft (dann eine der vier Familien) oder über die Bedienung (dann Blau)?*
> „Ungelesen" wechselt damit von Rot zu Blau — Rot bleibt für „jetzt dringend" reserviert und verliert seine Wirkung nicht durch Alltagsgebrauch.

### 6.4 Was daraus an Arbeit folgt — wenig

- **Kein Repaint.** Der Assistent-Tab ist regelkonform: Blau erscheint an `.vx-ops-details summary` (Link) und `.vx-ops-preview` (Info), Rot ausschliesslich an der Notfallnummer (`.vx-ap-urgent-emergency .vx-ap-urgent-number`, `--vx-color-danger`).
- **Eine echte Ausnahme:** `.vx-ops-btn.danger` („Zurückziehen" bei Aktuelle Infos) ist rot (`#b91c1c` auf `#fef2f2`, hartkodiert) — und zwar für eine **rückgängig machbare** Aktion. Das verstösst gegen die neue Regel *und* gegen die Interaktions-Richtlinien (rückgängig machbare Aktionen ohne Warnfarbe, dafür mit Undo). Beim Zusammenführen der Kategorie 4 auf denselben Screen wird das sichtbar. Empfehlung: neutral setzen, Undo bleibt.
- **Zwei hartkodierte Werte** in `customer-assistant-components.css:797/801–802` (`#1a6fe8`, `#b91c1c`/`#fef2f2`) auf Tokens ziehen.
- **Nachtrag in der Kommandozentrale**, Tab „Design-System": obige Formulierung ersetzt den bisherigen Absatz. Optional, im Muster des bestehenden Serifen-Wächters: ein CI-Wächter, der neue Rot-Verwendungen ausserhalb der sanktionierten Liste meldet.

**Damit ist F7 abgeschlossen und braucht keine weitere Sitzung.**

---

## 7. Neue Funde

Alle am Code oder an der Produktionsdatenbank verifiziert.

| # | Fund | Beleg | Bewertung |
|---|---|---|---|
| **D1** | **`loadAssistentRequests()` ist tot, reisst aber eine lebende Funktion mit.** Die Funktion wird bei jedem Öffnen des Assistent-Tabs aufgerufen (`index.html:25689`), bricht aber sofort ab: `document.getElementById('assistent-requests-list')` existiert seit S1 nicht mehr. Alles danach ist unerreichbar — darunter der **einzige** Aufruf von `vxUpdateMehrPlanLabel()`. | `index.html:14038`, `:25689`, `:15574`; das Zielelement `#mehr-plan-label` existiert weiterhin (`:7887`) | **Echte Regression aus S1.** Die Einstellungen zeigen unter „Abonnement & Add-ons" dauerhaft den Platzhalter „Ihr aktueller Plan" statt „Business · CHF 249/Mt". Klein zu fixen, aber ausserhalb des Assistent-Tabs sichtbar. |
| **D2** | **`VX_BRANCH_CONFIG` ist verwaist.** Eine Tabelle über alle 19 Branchen mit `hasEmergency`/`hasForwarding` je Branche — kein einziger Aufrufer. | `index.html:14351`, keine weiteren Treffer | S1-Rest. **Inhaltlich aber wertvoll:** Es ist genau die Zuordnung „welche Branche braucht eine Notfallnummer", die Kategorie 3 braucht. Nicht ersatzlos löschen — Inhalt in die Branchenvorlage überführen und dann löschen. |
| **D3** | **Branchen-Platzhalter werden nie aufgelöst.** `handwerk` und `garage` enthalten `{{notfallnummer_dringend}}`, `versicherung` enthält `{{notfallnummer_lebensgefahr}}`. `buildPromptV2()` löst über `resolve()` nur die 14 bekannten Variablen auf; Wizard-Schlüssel sind nicht dabei. | `prompt-builder-v2.js:203–219, 246`; SQL-Abgleich über alle 19 `prompt_block` | **Sicherheitsnah und latent.** Der Agent bekäme wörtlich „Notfall-Nummer nennen: `{{notfallnummer_dringend}}`". Heute unwirksam, weil nur `it-support` zugeordnet ist. **Harte Vorbedingung für A3.** |
| **D4** | **Branchendaten werden doppelt gespeichert, gelesen wird die schlechtere Kopie.** Der Admin-Wizard schreibt die Antworten sowohl nach `customers.ai_branch_extra` (jsonb) als auch als `[WIZARD] {…}`-Zeile in `ai_internal_notes` (Freitext). Der Prompt-Builder liest **nur** die Freitext-Variante; `ai_branch_extra` liest niemand. | `admin-panel/index.html:7703` (jsonb) und `:7745–7747` (Notiz-Zeile); `prompt-builder-v2.js:180` | Zwei Quellen für dieselbe Aussage — dasselbe Muster wie `ai_language`/`selected_languages`. Muss geklärt sein, **bevor** Branchenfelder kundenseitig bearbeitbar werden. |
| **D5** | **Sprache fehlt im Kunden-UI und hat zwei Quellen.** `ai_language` erreicht den Agenten, `selected_languages` wird geschrieben und gelesen, aber vom Prompt-Builder ignoriert. Im Kunden-Dashboard kommt Sprache nur in `customerMeta.language` vor — ohne jede Anzeige seit S1. | `prompt-builder-v2.js:185, 197–202`; `index.html:13107`, `:16310` | Bekannt aus dem North Star, hier bestätigt. Betrifft Kategorie 1 direkt: Der Vorschlag listet Sprache als Kernidentität. |
| **D6** | **F5 besteht unverändert.** `customer-runtime-assistant-status.js` erzeugt die Fähigkeiten-Karte samt Umschalter; `simplifyCapabilities()` in `customer-runtime-unified-navigation.js:295` entfernt ihn per MutationObserver wieder. `simplifyTechnicalStatus()` ist inzwischen komplett wirkungslos, weil die Status-Datei `.vx-nav-status-details` bereits selbst erzeugt und die Funktion darauf früh aussteigt. | `customer-runtime-assistant-status.js:115–150`; `customer-runtime-unified-navigation.js:294–336` | Bestätigt S7. **Wird durch die Umgliederung ohnehin angefasst** — S7 sollte darin aufgehen statt danebenzustehen. |
| **D7** | **Ansprache und Ton stehen doppelt auf dem Screen.** Die Meta-Zeile im Kopfbereich zeigt „Stimme X · Sie-Form · warm-professionell"; die Karte „Name und Auftreten" wiederholt dieselben zwei Werte als Lesezeilen *Kommunikationsstil* und *Ansprache*. | `customer-runtime-assistant-profile.js:359` vs. `:406` | Entstanden, weil S2/S3 den Kopfbereich ergänzt haben, ohne die Altkarte zu entlasten. Genau der Fall, den Kategorie 1 auflöst. |

---

## 8. Vorgeschlagene Schnittfolge — nach Freigabe

Bewusst so geschnitten, dass jeder Schritt einzeln lieferbar ist. **Nichts davon startet ohne Rückmeldung.**

| Schritt | Inhalt | Abhängigkeit | Modell/Effort |
|---|---|---|---|
| **I1** | **Kategorie 1 zusammenführen.** Kopfbereich, Stimme und „Name und Auftreten" werden ein Block; D7 verschwindet; Erklärsatz zur Begrüssung (4.4); A4-Abweichungshinweis mitnehmen. | keine | Sonnet 5, Medium |
| **I2** | **Kategorie 3 als Regelblatt.** „Wenn es dringend wird" wird zu „Grenzen und Eskalation": Notfall/Weiterleitung wie heute, plus Layer-1-Kategorien in Klartext (E4), plus Branchenzeile. Enthält S5. | I1 (gemeinsame Dateien) | Opus 5, Medium — Textarbeit |
| **I3** | **Kategorie 4 als Band, Umschalter entfernen.** Aktuelle Infos oben als Band, Geschäftsprofil und Erfassungsformular werden Drill-ins mit Zurück-Pfeil. **Ersetzt S6.** | I1 | Sonnet 5, Medium |
| **I4** | **Branchenanzeige (A3, Baustein 1+2).** `industry` im Profil-Endpoint, Anzeige in Kategorie 2/3, Wechsel über den bestehenden Meldeweg. | I2 | Sonnet 5, Medium |
| **I5** | **D3 beheben** — Wizard-Schlüssel im Branchen-Layer auflösen oder Platzhalter aus den drei Vorlagen entfernen. **Vor** dem Nachziehen der Zuordnung (A3, Baustein 3). | keine, aber Vorbedingung für A3 | Opus 5, Medium — sicherheitsnah |
| **I6** | **D1/D2 aufräumen** — toter Aufruf raus, `vxUpdateMehrPlanLabel()` an einen lebenden Pfad hängen, `VX_BRANCH_CONFIG` nach Inhaltsübernahme löschen. | keine | Sonnet 5, Medium |
| **I7** | **F7 nachtragen** — Kommandozentrale Design-System, `.vx-ops-btn.danger` neutralisieren, zwei hartkodierte Werte auf Tokens. | keine | Sonnet 5, Klein |
| **I8** | **Kategorie 2 mit Branchenfeldern** (`extra_steps`-gesteuerter Abschnitt). **Erst nach Klärung von D4.** | D4, I4 | Opus 5, Medium |

**Nicht in dieser Folge:** A2 (Layer-Reihenfolge im Master-Prompt, Sicherheitsthema, eigener Auftrag), Zusatzfloskel für die Begrüssung, Mehrsprachigkeit des Dashboards, `extra_steps` für die 12 Vorlagen ohne (Inhaltsarbeit).

---

## 9. Was ich für die Umsetzung entschieden brauche

| # | Frage | Meine Empfehlung |
|---|---|---|
| **E8** | **Umschalter 3 → 0** (vier Abschnitte auf einem Screen, zwei Drill-ins) oder 3 → 2 wie in E3/S6 beschlossen? | 3 → 0. Begründung in 4.3. Ersetzt S6. |
| **E9** | **Sprache in Kategorie 1 aufnehmen?** Sie wird im Prompt verwendet, hat zwei Datenquellen und ist laut `plan_config` Professional-only. | Ja anzeigen (read-only, „Von Voxera gesetzt"), **nicht** bearbeitbar machen. Erst D5 klären, dann über Bearbeitbarkeit reden. |
| **E10** | **`ai_branch_extra` oder `[WIZARD]`** als führende Quelle für Branchenantworten (D4)? | `ai_branch_extra` — es ist eine typisierte Spalte statt einer JSON-Zeile in einem Freitextfeld. Bedeutet: Prompt-Builder umstellen, Wizard-Doppelschreibung beenden. Betrifft I8. |
| **E11** | **A4 (eingefrorene Begrüssung)** in I1 mitnehmen oder separat lassen? | Mitnehmen, als Abweichungshinweis mit „auf Standard zurücksetzen". Kleiner als die Automatik-Variante und passt genau in Kategorie 1. |
| **E12** | **D3 vor A3** — akzeptiert, dass das Nachziehen der Branchenzuordnung wartet, bis die Platzhalter aufgelöst sind? | Ja. Andernfalls hören Anrufende bei drei Branchen einen Platzhalter statt einer Notfallnummer. |

---

## 10. Nachtrag 09.08. — D3 und F7 umgesetzt

Beide vom User freigegeben und in derselben Sitzung gebaut. **Kein Eingriff in die Informationsarchitektur** — die wartet auf E8.

### D3 — Branchen-Platzhalter werden aufgelöst

`prompt-builder-v2.js` auf **Version 2.2**. Zwei Regeln, in dieser Reihenfolge:

1. **Wizard-Antworten werden zu Prompt-Variablen** (`wizardVariables()`), datengetrieben aus `ai_internal_notes` → `[WIZARD]`. Neue `extra_steps`-Felder funktionieren damit ohne Codeänderung. Zwei Sperren: Schlüssel müssen `^[A-Za-z0-9_]+$` erfüllen (sie werden in `resolve()` zu einem RegExp — ohne Allowlist wäre das eine Injektionsstelle), und ein Wizard-Schlüssel kann keine der 14 festen Variablen überschreiben.
2. **Was danach übrig bleibt, wird neutralisiert** (`neutralizePlaceholders()`, nur auf dem Branchen-Layer): Der Platzhalter wird durch eine ausdrückliche Nicht-Anweisung ersetzt statt wörtlich stehen zu bleiben.

`notfallnummer_lebensgefahr` fällt auf `customers.ai_emergency_number` zurück — dieselbe Sache, eine Quelle. Ein Standardwert wird **nicht** erfunden: ist auch die Spalte leer, lautet die Anweisung „nenne keine Nummer".

Wirkung, gegen den echten `handwerk`-Vorlagentext geprüft:

| | vorher | nachher (ohne Wizard-Antwort) |
|---|---|---|
| Prompt-Zeile | `Notfall-Nummer nennen: {{notfallnummer_dringend}}` | `Notfall-Nummer nennen: keine eigene Notfallnummer hinterlegt; nenne keine Nummer und nimm stattdessen Kontaktdaten und Anliegen auf` |
| mit Wizard-Antwort | — | `Notfall-Nummer nennen: 0800 33 66 55` |

**Fünf neue Prüfungen** in `scripts/verify-prompt-builder-v2.mjs` (läuft in `p0-security-verification.yml`), darunter der Injektionsfall und die Zusicherung, dass im fertigen Prompt kein `{{…}}` mehr vorkommt. **Damit ist die Vorbedingung für A3 (E12) erfüllt** — die Branchenzuordnung darf nachgezogen werden.

### F7 — Regel entschieden, Code angeglichen

Die Formulierung aus Abschnitt 6.3 gilt. Im Code drei Stellen:

- `.vx-ops-btn.danger` → `.vx-ops-btn.quiet`: „Zurückziehen" ist nicht mehr rot. Rot bleibt auf diesem Screen der Notfallnummer vorbehalten. Klasse mit umbenannt, damit der Name nicht das Gegenteil des Aussehens behauptet.
- Zwei hartkodierte Werte (`#1a6fe8`, `#fef2f2`/`#b91c1c`) auf Tokens gezogen.
- Cache-Buster für die zwei geänderten Dateien gebumpt, die drei Verifier-Pins nachgezogen.

**Nicht mitgemacht, bewusst:** Der Bestätigungsdialog beim Zurückziehen (`root.confirm()`) bleibt. Die Interaktions-Richtlinien verlangen dort Undo statt Dialog — das ist eine Verhaltensänderung und gehört nicht in eine Farbentscheidung.

**Offen für den User:** Der Nachtrag im Tab „Design-System" der Kommandozentrale (Wortlaut in Abschnitt 6.3) — die Datei liegt nicht im Repo.

---

## 11. Nachtrag 09.08. — E8 entschieden, I1–I8 umgesetzt

**Entscheidung E8: 3 → 0.** Der Assistent-Tab ist eine durchgehende Seite mit vier Abschnitten; Geschäftsprofil und Aktuelle Infos sind Drill-ins. **S6 entfällt** — es ist in dieser Umsetzung aufgegangen.

### Was gebaut wurde

| Schritt | Ergebnis |
|---|---|
| **I1** | **Kernidentität.** Kopfbereich, Stimme und „Name und Auftreten" sind ein Abschnitt. Der Satz steht oben, darunter die fünf Felder, die ihn erzeugen (Name, Stimme, Ansprache, Ton, Sprache), darunter ein Editor für alle auf einmal. **D7 ist damit weg** — Ansprache und Ton stehen nicht mehr doppelt. Die Erklärung, warum der Satz kein Eingabefeld ist, steht dort, wo die Frage entsteht. |
| **I2** | **Grenzen und Eskalation.** Notfallnummer und Weiterleitung wie bisher, dazu zum ersten Mal sichtbar: was der Assistent nicht beantwortet (`ai_response_constraints`, `ai_fallback_escalation` — read-only, sie bleiben in `BLOCKED_CUSTOMER_FIELDS`) und Layer 1 als Kategorienliste. **Der Prompt-Wortlaut bleibt im Admin-Panel** (E4): die fünf Voxera-Regeln stehen als Klartext-Kategorien im Endpoint, nicht aus dem Prompt gelesen. Enthält S5. |
| **I3** | **Band statt Reiter, Drill-in statt Umschalter.** `#vx-assistant-root-switch` ist gelöscht — Markup, Erzeugung und alle 17 CSS-Regeln in drei Dateien. Die Appbar trägt jetzt den Zurück-Pfeil, und zwar über denselben History-Vertrag wie jeder andere Screen: Pfeil, Browser-Zurück und Wisch-Geste sind eine Operation. Dafür hat `customer-runtime-screen-navigation.js` eine Anmeldung für fremde Sub-Screens bekommen (`vxScreenNav.register`) — ohne sie hätte der Pfeil funktioniert und Browser-Zurück nicht. |
| **I4** | **Branchenanzeige (A3, Baustein 1+2).** Der Endpoint liefert `industry`, jede betroffene Kategorie zeigt die zugeordnete Branche oder sagt ausdrücklich, dass keine zugeordnet ist. Der Wechsel läuft über den bestehenden Meldeweg. |
| **I5** | **D3** — siehe Abschnitt 10. |
| **I6** | **D2 erledigt, D1 nicht.** `VX_BRANCH_CONFIG` ist gelöscht (Inhalt unten gesichert). **D1 bleibt bewusst liegen** — der User bearbeitet ihn im Abo-Datenbug-Fenster, weil es vermutlich derselbe Fehler ist. Zwei Fenster am selben `loadAssistentRequests()` wären genau die Kollision, die dieser Auftrag vermeiden soll. |
| **I7** | **F7** — siehe Abschnitt 10. |
| **I8** | **Branchenfelder bearbeitbar,** im Geschäftsprofil-Drill-in. Die Feldliste kommt aus `industry_templates.extra_steps`, nicht aus dem Frontend. |

### D4 gelöst (E10)

`ai_branch_extra` führt jetzt — im Prompt-Builder **und** im Dashboard, in derselben Rangfolge. Die `[WIZARD]`-Zeile in `ai_internal_notes` bleibt Rückfall für Kunden, die seit der Umstellung nicht neu gespeichert wurden. Zwei Quellen sind hinnehmbar, zwei Rangfolgen wären es nicht.

**Das war die Vorbedingung für die kundenseitige Bearbeitbarkeit — und sie hat eine zweite nach sich gezogen.** Seit Prompt-Builder 2.2 werden Branchenantworten zu Prompt-Variablen. Ein frei wählbarer Schlüssel wäre damit eine Schreibberechtigung auf den Prompt. Der Schreibpfad nimmt deshalb **nur** Schlüssel an, die die zugeordnete Vorlage definiert, prüft Auswahlwerte gegen die hinterlegten Optionen, kappt auf 400 Zeichen und entfernt geschweifte Klammern aus Freitext.

### Aus `VX_BRANCH_CONFIG` gesichert, bevor der Code gelöscht wurde

Die Tabelle beantwortete: welche Branche braucht überhaupt eine Notfallnummer, welche eine Weiterleitung. Kein Code hat sie je gelesen, aber die Zuordnung ist für A3 brauchbar:

- **Notfallnummer sinnvoll:** `versicherung`, `facharzt`, `zahnarzt`, `hotel`, `handwerk`, `it-support`, `fitness`
- **Keine Notfallnummer:** `generic`, `physiotherapie`, `garage` (Pannendienst ist eine eigene Nummer), `restaurant`, `coiffeur`, `kosmetik`, `treuhand`, `immobilien`, `reinigung`, `anwalt`, `baeckerei`, `digitalmarketing`
- **Keine Weiterleitung nötig:** `coiffeur`, `kosmetik`, `fitness`, `baeckerei`

### Gemessen statt geschätzt

Der Einwand gegen E8 war die Seitenlänge. Beide Stände im Browser gerendert, 390 × 780, derselbe Beispielkunde (Handwerksbetrieb, laufende Ferienmeldung, Branche zugeordnet, Weiterleitung konfiguriert):

| | Höhe | Bildschirme | Inhalt |
|---|---|---|---|
| **vorher** | 3326 px | 4.26 | nur der Reiter „Assistent" — Geschäftsprofil und Aktuelle Infos lagen hinter zwei weiteren Reitern |
| **nachher** | 3346 px | 4.29 | die ganze Seite inkl. Band und der neuen Kategorie „Grenzen und Eskalation" |

**20 Pixel länger, bei einer zusätzlichen Kategorie und ohne Umschalter.** Die Diagnose hatte vermutet, dass die Länge nicht aus der Umgliederung kommt; die Messung bestätigt es deutlicher als erwartet.

Ein Fund aus dem Rendern, direkt behoben: `.vx-ap-summary-row` stapelt auf Mobile Label über Wert. Für die Kernidentität — fünf kurze Werte wie „Sie", „Deutsch", „Sofia" — kostete das rund 145 px für nichts. Diese eine Zusammenfassung bleibt jetzt zweispaltig (`.vx-ap-summary--compact`), alle übrigen stapeln unverändert.

### Bewusst nicht mitgemacht

- **D6 / S7** (zwei Module streiten um Fähigkeiten- und Betriebsstatus-Karte) bleibt offen. Der Einhängepunkt ist jetzt ein ausdrücklicher Anker statt eines Kartentitel-Regex — vorher hätte die Umbenennung der Karte die Fähigkeiten still ans Ende verschoben. Die eigentliche Entflechtung ist ein eigener Schritt und stand nicht in I1–I8.
- **Der Admin-Wizard schreibt weiter beide Quellen.** Er lädt vor dem Schreiben den aktuellen Stand, überschreibt Kundeneingaben also nicht — aber die Doppelschreibung sollte fallen, sobald jemand ohnehin am Wizard arbeitet.
- **Der Bestätigungsdialog** beim Zurückziehen einer aktuellen Änderung (siehe Abschnitt 10).

### Nachträge für die Kommandozentrale

- **Tab „Seiten-Definitionen"/Assistent:** „Enthält 3 Unterbereiche" gilt nicht mehr — eine Seite, vier Abschnitte, zwei Drill-ins.
- **Tab „Design-System":** die F7-Formulierung aus Abschnitt 6.3.
- **Tab „Datenbank & Architektur":** `customers.ai_branch_extra` ist ab jetzt die führende Quelle für Branchenantworten; `ai_response_constraints` und `ai_fallback_escalation` sind im Kunden-UI lesbar, bleiben aber nicht schreibbar.
- **Tab „Offene Entscheidungen":** E8–E12 nach „entschieden".

---

## 12. Nachtrag 09.08. — fünf Funde aus dem Live-Test auf der Preview

Getestet auf `deploy-preview-859` mit echten Daten (`E2E Test AG`).

### Vorweg: die Preview hatte Produktionsrechte

Der Test hat in die Produktion geschrieben. Nachweis: `customers.updated_at = 01:47:26`, dazu drei Einträge `customer_self_edit` im `elevenlabs_sync_log` um 01:36:41, 01:47:11 und 01:47:26 — alle nach dem Preview-Deploy um 01:43, alle mit Status `success`. Der Netlify-Schritt aus `RUNTIME_CONFIG_UND_PREVIEW_ISOLATION.md` ist also **nicht aktiv**; die Preview-Functions liefen mit `SUPABASE_SERVICE_ROLE_KEY`, `ELEVENLABS_API_KEY`, Twilio und den Make-Hooks. Kein Schaden — es war der Testkunde — aber genau der Unfallpfad, den das Dokument als „heute wahrscheinlichsten" bezeichnet. **Offener Punkt beim User.**

Nebenbefund: Der eingefrorene Begrüssungssatz aus N7 existiert nicht mehr (`assistant_name` = Lara, `ai_greeting` leer). Der dafür vorgesehene Testpunkt konnte deshalb nicht anschlagen.

### Behoben

| # | Fund | Ursache | Behebung |
|---|---|---|---|
| **5** | Stimmenauswahl nicht auffindbar | **Regression aus dieser Umgliederung.** Vorher eine eigene Karte mit Aufklapper — ein Klick. Danach hinter „Anpassen" **und** darin nochmal hinter „Andere Stimme wählen" — zwei Ebenen. Verschärfend: alle vier Kunden haben `voice_id = null`, dadurch entfiel auch der „Anhören"-Knopf. | Aufklapper wieder direkt auf der Karte, eine Ebene. |
| **5b** | Kein Hinweis auf Name/Stimme-Widerspruch | — | Das Geschlecht steht in der Zeile („Sofia · Weiblich"). **Bewusst keine Namensauswertung:** aus „Lara" auf ein Geschlecht zu schliessen wäre bei Schweizer KMU-Namen eine Behauptung mit hoher Irrtumsquote. Wer die Kombination sieht, urteilt selbst. |
| **2** | „Mindestens eine Einrichtung benötigt noch Ihre Aufmerksamkeit" | Grundsatz 13 verletzt — und zwar an der Stelle, aus welcher der Grundsatz entstanden ist. | Die Zeile nennt jetzt den Bereich und den Klartext-Satz aus `technical_status`, zählt weitere Bereiche und trägt **entweder** eine Handlung (Kalender → Kalendereinstellungen) **oder** eine Erklärung („Rufnummer und Weiterleitung bestätigt Voxera — Sie müssen nichts tun."). Fünf Zustände im Browser durchgespielt. |
| **4** | „Für Ihre Branche" zu dicht, Zweck unklar; lange Liste bei „Was Ihr Assistent nicht beantwortet" | Beides meins: drei Aufzählungen ohne Zwischenüberschrift direkt untereinander (beim Testkunden 13 Punkte am Stück), und die Branchenfelder zweispaltig mit Label, Feld und Hinweis auf engstem Raum. | Zwei benannte Listen statt einer; die Voxera-Regeln eingeklappt (für jeden Kunden identisch, im Alltag der uninteressanteste Block); Branchenfelder einspaltig; Zwecksatz sagt jetzt, was die Angaben **bewirken**, statt woher sie kommen. |
| **1** | Speichern dauert lange — schneller Teil | Das Neuladen des Profils steckte mit im Wartefenster des Knopfs. | Der Knopf quittiert, sobald der Endpoint geantwortet hat; der frische Stand kommt danach. Spart eine vollständige Runde. |

### Offen

**#1, Hauptteil — eigener Auftrag, Entscheidung zuerst.** Der Speicherpfad ist: DB-Update → **HTTP-Sprung auf die Admin-Site** → vier DB-Abfragen, bis zu vier ElevenLabs-Aufrufe, ein PATCH mit ~16'700 Zeichen Prompt, Sync-Log schreiben und trimmen → zurück. Alles blockierend. Die Kette ist älter als diese Umgliederung; neu ist nur, dass der Editor Name, Ansprache und Ton zusammen speichert und man den langsamen Pfad dadurch an einer Stelle trifft, an der vorher drei kleinere Speicherungen standen. Zu entscheiden: Sync blockierend lassen (sofort ehrlich, aber langsam) oder anstossen und den Zustand in der Statuszeile führen.

**#3 Freitextfelder — eigener Auftrag, Opus/Hoch, Diagnose zuerst.** Preise, Zielgruppe und Beschreibung landen vermischt in vier Freitextkästen. Der strukturierte Weg existiert bereits (`extra_steps`), deckt aber nur 7 der 19 Branchen und dort nur wenige Felder ab. Gehört fachlich zu A3 und I8.

**Kleiner offener Punkt aus dem Screenshot:** „Andere Stimme wählen" und „Anpassen" stehen jetzt als zwei gleich aussehende Zeilen untereinander und lesen sich eher wie eine Linkliste als wie zwei Aktionen. Nicht angefasst, weil es eine Gestaltungsentscheidung ist und kein Fehler.

---

## Anhang — Prüfmethode und Dateiverweise

**Geprüft wurde gegen:** `main` @ `ed1d95e` (Code), Supabase-Projekt `ulcofbgrovgcvowdjrge` (Tabellen `customers`, `industry_templates`, `plan_config`). Alle Zahlen in diesem Dokument stammen aus diesen zwei Quellen, nicht aus der Kommandozentrale oder den Vorgänger-Dokumenten.

| Was | Wo |
|---|---|
| Rendering Assistent-/Geschäftsprofil-Ansicht | `customer-dashboard/shared/customer-runtime-assistant-profile.js` |
| Kopfbereich + Ansprache-/Ton-Editor | ebenda, `heroCard()` `:350`, `toneEditor()` `:315` |
| Dringlichkeits-Block + Meldeweg | ebenda, `urgentCard()` `:213`; `customer-runtime-case-intake.js:112–130` |
| Fähigkeiten + Betriebsstatus | `customer-dashboard/shared/customer-runtime-assistant-status.js:115–150` |
| Umschalter, Drei-Bereiche-Shell, `simplify*()` | `customer-dashboard/shared/customer-runtime-unified-navigation.js:16–19, 157–261, 269–336` |
| Aktuelle Infos | `customer-dashboard/shared/customer-runtime-operational-updates.js` |
| Profil-Endpoint (Anzeige, Rechte, Status) | `customer-dashboard/netlify/functions/customer-assistant-profile.js` |
| Schreib-Endpoint (Whitelist, Sperren, blockierte Felder) | `customer-dashboard/netlify/functions/customer-update-assistant.js:9–11, 104–127` |
| Prompt-Builder, 3 Layer, Variablenauflösung | `admin-panel/netlify/functions/_lib/prompt-builder-v2.js:178–265` |
| Layer-Quellen laden | `admin-panel/netlify/functions/trigger-elevenlabs-sync.js:28–77` |
| Branchenvorlagen-Wizard (Feldschema-Renderer) | `admin-panel/index.html:7023–7075, 7238–7260, 7322 ff., 7700–7750` |
| Farb-Tokens | `customer-dashboard/shared/customer-design-tokens.css:26–48, 70–75` |
| Assistent-CSS (Rot/Blau-Verwendung) | `customer-dashboard/shared/customer-assistant-components.css:589–592, 795–803, 866–898` |
| Tote S1-Reste | `customer-dashboard/index.html:14038, 14351, 15574, 25689` |
