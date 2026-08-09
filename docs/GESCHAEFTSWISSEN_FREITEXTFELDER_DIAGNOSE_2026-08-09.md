# Geschäftswissen — die vier Freitextfelder: Diagnose und Zielbild

**Datum:** 09.08.2026
**Status:** **Diagnose und Zielbild. Keine Umsetzung.** Abschnitt 8 listet die Schnitte, Abschnitt 9 die Entscheidungen, die ich vom User brauche.
**Prüfstand:** `main` @ `f21187e`, Produktionsdatenbank `ulcofbgrovgcvowdjrge` (Live-Abfragen, nicht aus Dokumenten übernommen). Staging (`hzqiyyqfchvfcmmbemvd`) enthält aktuell 0 Kunden.
**Grundlage:** Auftrag „Freitextfelder im Geschäftswissen — Diagnose zuerst" (09.08.), Live-Test-Fund #3 aus PR #859, `docs/ASSISTENT_TAB_IA_DIAGNOSE_2026-08-09.md` (Abschnitte 5 und 11).

---

## 0. Kurzfassung

1. **Die Vermischung ist nicht Nutzerverhalten, sondern eingebaut.** Der Screenshot aus dem Live-Test zeigt Preis, Zielgruppe und Beschreibung in einem Feld — aber der Kunde hat das nicht so eingetippt. `websiteBusinessDescription()` (`admin-runtime-launch-p0.js:93–97`) klebt zwei getrennt extrahierte Felder mit `'Zielgruppen: ' + …` zu einem Absatz zusammen, und der Preissatz stammt aus der Kurzbeschreibung des Extraktors. Es gibt für „Zielgruppe" und „Preis" schlicht kein Zielfeld. Beleg in 3.1/3.2.

2. **Die Stichprobe „mehrere Testkunden" ist nicht erhebbar — 1 von 4 Kunden hat überhaupt Inhalt.** Statt daraus etwas hochzurechnen, habe ich die zweite, viel grössere Stichprobe genommen, die es tatsächlich gibt: die **76 Vorlagentexte** (19 Vorlagen × 4 Felder) in `industry_templates`. Sie sind vom Team selbst geschrieben und beschreiben, was in diesen Feldern stehen *soll*. Methodik in Abschnitt 1.

3. **Gemessen an dieser Stichprobe ist die Vermischung systematisch, nicht zufällig.** „Standort und reguläre Öffnungszeiten" trägt in den 19 Vorlagen bis zu **sechs** Informationstypen (Adresse 19/19, Zeiten 19/19, Notfallnummer 7/19, Anfahrt/Parking 5/19, Einsatzgebiet 2/19, Vorbereitung 3/19). „Häufige Fragen und Buchungshinweise" trägt drei (Aufnahme-Checkliste 15/19, echte FAQ 19/19, Preisaussagen 13/19). Die Zahlen stehen in Abschnitt 3.3.

4. **Ein Teil des Inhalts gehört gar nicht in Kategorie 2.** In 14 von 19 `default_business_description` steht Agentenverhalten („Lara nimmt Reservationen entgegen…") — das ist Kategorie 3. Die Aufnahme-Checkliste in 15 von 19 `default_booking_faq` ist inhaltlich `[PROMPT_V2].requiredInformation`, das als typisiertes Feld bereits existiert. Es wird also nicht nur vermischt, es wird auch **doppelt gehalten**.

5. **Die Branchenvorlagen-Infrastruktur ist die richtige Grundlage — aber sie ist nicht so branchenspezifisch, wie ihr Name behauptet.** Von 20 verschiedenen `extra_steps`-Schlüsseln sind die drei häufigsten (`sprechstunden_modus` in **allen 7** Vorlagen, `termin_modus` in 5, `booking_url` in 4) generisch. Sie sind heute siebenfach dupliziert und fehlen den 12 Vorlagen ohne `extra_steps` vollständig. Abschnitt 4.2.

6. **Neuer, harter Fund: 23 der 39 gepflegten Branchenfelder erreichen den Prompt nie.** Der Kunde kann sie seit PR #859 im Dashboard ausfüllen, aber weder `operationalLines()` noch ein `{{Platzhalter}}` in einem `prompt_block` liest sie. `facharzt` ist der Extremfall: **0 von 4** Feldern wirken. Vollständige Tabelle in 4.3 — das ist G3 und meiner Ansicht nach der dringlichste Einzelbefund dieses Auftrags.

7. **Zweiter neuer Fund: eckige Klammern sind ein dritter, unaufgelöster Platzhalter-Dialekt.** `[Strasse, PLZ Ort]` steht in **19 von 19** `default_location_hours` und in 14 von 19 `default_booking_faq`. `neutralizePlaceholders()` (Prompt-Builder 2.2) kennt nur `{{…}}`. Genau das Muster, das mit D3 für geschweifte Klammern behoben wurde — nur eine Klammersorte weiter und im Feld, um das dieser Auftrag geht. G1 in Abschnitt 5.

8. **Zielbild: drei Schichten, ein Renderer, zwei Speicherorte.** Generische Strukturfelder und Branchenfelder benutzen **denselben Mechanismus** (schemagetriebenes Rendern, Allowlist beim Schreiben), aber **nicht denselben Speicher**. Begründung ist nicht Geschmack, sondern eine harte Sperre im Code: `ai_branch_extra` lässt sich ohne zugeordnete Branchenvorlage gar nicht beschreiben (`customer-update-assistant.js:232–235`, HTTP 409). Für 3 von 4 Kunden wäre die generische Schicht damit tot. Abschnitte 6 und 7.

---

## 1. Prüfstand und Methodik

### 1.1 Warum die Kundenstichprobe nicht trägt

Auftragspunkt 1 verlangt eine Stichprobe mehrerer Testkunden. Sie existiert nicht:

| Kunde | Status | Branche | Beschreibung | Leistungen | Standort/Zeiten | FAQ |
|---|---|---|---|---|---|---|
| E2E Test AG | invited | `it-support` | 499 Z. | 250 Z. | 116 Z. | 861 Z. |
| E2E 2 Test AG | onboarding | — | 0 | 0 | 0 | 0 |
| E2E 3 Test AG | onboarding | — | 0 | 0 | 0 | 0 |
| E2E 4 Test AG | onboarding | — | 0 | 0 | 0 | 0 |

**Fakt:** Genau ein Datensatz hat Inhalt, und dieser eine stammt nicht aus Tipparbeit, sondern aus der Website-Analyse (`ai_internal_notes` → `[WEBSITE_ANALYSIS]`, Quelle `https://voxera.ch/`). `ai_branch_extra` ist bei allen vier Kunden `null`.

Aus einem einzigen, maschinell befüllten Datensatz lässt sich **nicht** ableiten, wie Kunden diese Felder benutzen. Das sage ich hier ausdrücklich, statt es zu kaschieren.

### 1.2 Die Stichprobe, die es stattdessen gibt

Drei Quellen, alle live geprüft:

| Quelle | Umfang | Was sie beweist |
|---|---|---|
| **`industry_templates` Default-Texte** | 19 Vorlagen × 4 Felder = **76 Texte**, alle gefüllt | Was das Team selbst für den *Soll-Inhalt* dieser vier Felder hält. Diese Texte werden beim Onboarding real in die Kundenspalten kopiert (`index.html:7505–7508` → `:7699`) — sie sind nicht Dokumentation, sie sind Startinhalt. |
| **Der Website-Extraktor** | 5 Ausgabefelder (`scrape-website.js:329–333, 408–412`) | Welche Informationstypen die Automatik *unterscheidet*, bevor sie sie wieder zusammenlegt. |
| **Der eine befüllte Kunde** | 4 Felder | Bestätigt am Einzelfall, was die anderen zwei Quellen strukturell zeigen. |

Die Vorlagen sind die belastbarste Quelle: 19 unabhängig geschriebene Ausfüllungen desselben Formulars, von Autoren, die das Produkt kennen.

---

## 2. Ist-Zustand — die vier Boxen vollständig kartiert

### 2.1 Spalten, Wege, Grenzen

| Box im Kunden-UI | Spalte | Limit Kunde | Limit Admin | In den Prompt als |
|---|---|---|---|---|
| Unternehmensbeschreibung | `ai_business_description` | 6000 Z. | ungekappt | `## GESCHÄFTSPROFIL` |
| Leistungen und Angebote | `ai_services` | 6000 Z. | ungekappt | `## LEISTUNGEN` |
| Standort und reguläre Öffnungszeiten | `ai_location_hours` | 6000 Z. | ungekappt | `## STANDORT & ERREICHBARKEIT` |
| Häufige Fragen und Buchungshinweise | `ai_booking_faq` | 6000 Z. | ungekappt | `## TERMINLOGIK & FAQ` |

Belege: `customer-update-assistant.js:149–152`, `prompt-builder-v2.js:300–303`, UI in `customer-runtime-assistant-profile.js:612`.

**Beobachtung am Rand, die zum Thema gehört:** Die UI-Beschriftung und die Prompt-Überschrift sagen bei zwei von vier Feldern etwas Verschiedenes. Der Kunde füllt „Häufige Fragen und Buchungshinweise", der Agent liest „TERMINLOGIK & FAQ". Das ist keine Kosmetik — es erklärt mit, warum Terminregeln in einem FAQ-Feld landen.

### 2.2 Wer schreibt hinein

Vier Schreibpfade auf dieselben vier Spalten:

1. **Vorlagen-Defaults** beim Anlegen (`index.html:7505–7508`, gespeichert `:7699`) — kopiert `default_*` in die Kundenspalte.
2. **Website-Analyse** (`admin-runtime-launch-p0.js:169–175`) — überschreibt, wenn der Wert noch dem Default entspricht.
3. **Admin-Formular** (`index.html:8196–8231`).
4. **Kunden-Dashboard** (`customer-update-assistant.js:149–152`) — seit PR #859.

**Fakt:** Keiner der vier Pfade kennt eine Feinstruktur. Alle vier schreiben einen Textblock.

---

## 3. Diagnose — was tatsächlich vermischt wird

### 3.1 Der Live-Test-Fund, an seiner Ursache

Der Inhalt aus dem Screenshot, wörtlich aus der Datenbank (`ai_business_description`, Kunde „E2E Test AG"):

```
Voxera ist ein KI-Telefonassistent für Schweizer KMU, … und ist innerhalb von
24 Stunden einsatzbereit. Der Service kostet ab CHF 99 pro Monat ohne
Mindestlaufzeit.                                          ← Preis
Zielgruppen: Schweizer KMU aus Handwerk, Bau, Gesundheit, …  ← Zielgruppe
Test                                                        ← Handeingabe
```

Der Extraktor hatte sauber getrennt. In `ai_internal_notes` → `[WEBSITE_ANALYSIS]` liegen `short_description` und `target_groups` als **zwei** Schlüssel nebeneinander. Zusammengeklebt werden sie erst hier:

```js
// admin-panel/shared/admin-runtime-launch-p0.js:93–97
function websiteBusinessDescription(scraped) {
  const description = wizardText(scraped?.short_description);
  const targetGroups = wizardText(scraped?.target_groups);
  return [description, targetGroups ? 'Zielgruppen: ' + targetGroups : ''].filter(Boolean).join('\n');
}
```

**Fakt:** Die Vermischung ist eine Codezeile, kein Nutzerfehler. Die Zeile ist auch nicht falsch programmiert — sie tut das einzig Mögliche, weil es für `target_groups` **keine Zielspalte** gibt.

**Und der Preis?** Der stammt aus `short_description` selbst. Der Extraktor-Prompt verlangt dort „Unternehmen, Nutzen und Positionierung" (`scrape-website.js:408`) — eine Preisangabe ist Positionierung, das Modell hat korrekt gearbeitet. Auch hier: **kein Preisfeld im gesamten Datenmodell.** `grep` über `customers` findet keine Spalte mit `price`/`preis`.

### 3.2 Ein Feld ist bereits getrennt — und im Kundendialog unsichtbar

`customers.ai_short_description` existiert als eigene Spalte, wird im Admin-Wizard als „Kurzbeschreibung" gepflegt (`index.html:7930`) und gespeichert (`:7702`).

**Fakt:** `ai_short_description` wird von `buildPromptV2()` **nicht gelesen** und im Kunden-Dashboard **nicht angezeigt**. Es gibt also bereits eine getrennte Kurzbeschreibung; sie ist nur folgenlos. Dasselbe Muster wie `ai_branch_extra` vor D4 und `selected_languages` (D5).

### 3.3 Die Vermischung, quantifiziert

Auszählung über alle 19 Vorlagen (SQL mit `~*`-Mustern gegen die vier `default_*`-Spalten):

| Box | Enthaltener Informationstyp | Vorlagen | Gehört eigentlich nach |
|---|---|---|---|
| **Unternehmensbeschreibung** | Beschreibung/Positionierung | 19/19 | bleibt (Freitext) |
| | **Agentenverhalten** („Lara nimmt … entgegen") | **14/19** | Kategorie 3 / `[PROMPT_V2]` |
| | Zielgruppe | (Extraktor-Feld, keine Spalte) | eigenes Feld |
| | Preis/Konditionen | (im Kundenfall belegt) | eigenes Feld |
| **Leistungen** | Leistungsliste, eine pro Zeile | 19/19 | strukturierte Liste |
| | Preis-/Kostenangaben | 5/19 | eigenes Feld |
| **Standort & Öffnungszeiten** | Adresse | **19/19** | `street`/`zip`/`city` (existieren!) |
| | Öffnungs-/Büro-/Sprechzeiten | **19/19** | strukturiert (Wochentag + Zeitpaare) |
| | **Notfallnummer** | **7/19** | `ai_emergency_number` (existiert!) |
| | Anfahrt / Parking / ÖV | 5/19 | eigenes Kurzfeld |
| | Einsatzgebiet / Region | 2/19 | eigenes Kurzfeld |
| | Vorbereitung („Rezept mitbringen", „10 Min. früher") | 3/19 | eigenes Kurzfeld |
| **Häufige Fragen & Buchungshinweise** | **Aufnahme-Checkliste** („Reservation aufnehmen: Datum, Uhrzeit, …") | **15/19** | `[PROMPT_V2].requiredInformation` (existiert!) |
| | echte Frage-Antwort-Paare | 19/19 | bleibt, aber als Paare |
| | Preis-/Kostenaussagen | 13/19 | eigenes Feld |

**Die drei Zeilen mit „(existiert!)" sind der eigentliche Befund.** Adresse, Notfallnummer und Pflichtinformationen haben bereits typisierte Felder — und stehen trotzdem zusätzlich als Fliesstext in den vier Boxen. Das ist nicht fehlende Struktur, das ist **dreifache Haltung derselben Aussage**, und die drei Kopien können auseinanderlaufen.

Beispiel `facharzt`, alles gleichzeitig in der Produktionsdatenbank:

| Ort | Inhalt |
|---|---|
| `default_location_hours` | „Bei Notfall ausserhalb der Sprechstunden: Notfallnummer **[Nummer]**" |
| `customers.ai_emergency_number` | typisierte Spalte, Default `144` |
| `extra_steps` → `notfallnummer_lebensgefahr` | eigenes Wizard-Feld |
| `extra_steps` → `notfallnummer_dringend` | noch ein Wizard-Feld |

Vier Orte für eine Telefonnummer. Der Prompt-Builder legt zwei davon zusammen (`prompt-builder-v2.js:40–42`), der Freitext bleibt unabhängig daneben stehen.

### 3.4 Was am Feld „Häufige Fragen" wirklich offen ist — und was nicht

Der Auftrag nennt „Häufige Fragen" als Beispiel für etwas, das „von Natur aus offener" bleibt. **Das stimmt für den Inhalt, nicht für die Form.** Alle 19 Vorlagen schreiben dort dasselbe Muster:

```
– Was kostet eine Erstberatung? → [Preis oder "kostenloses Erstgespräch"], Details beim Termin.
– Wie schnell kann ich einen Termin bekommen? → In der Regel …
```

Das ist eine **Liste von Paaren**. Die Antwort ist Freitext, die Struktur ist es nicht. Auch der Extraktor produziert bereits „eine pro Zeile" (`scrape-website.js:412`). Mein Vorschlag in 6.3 behandelt FAQ deshalb als *strukturierte Liste mit freien Werten*, nicht als Fliesstext — das ist etwas anderes als „vollständig strukturieren" und etwas anderes als „so lassen".

---

## 4. Verhältnis zur Branchenvorlagen-Infrastruktur

### 4.1 Was seit PR #859 steht

| Baustein | Ort | Zustand |
|---|---|---|
| Feldschema | `industry_templates.extra_steps` (jsonb) | 7 von 19 Vorlagen, 39 Felder, 20 Schlüssel |
| Rendern (Admin) | `admin-panel/index.html`, dynamischer Schritt-Renderer | live |
| Rendern (Kunde) | `buildBranchSections()`, `customer-assistant-profile.js:215–235` | live seit I8 |
| Schreiben mit Allowlist | `branchFieldRules()` / `sanitizeBranchExtra()`, `customer-update-assistant.js:36–71` | live: nur Vorlagen-Schlüssel, Optionen geprüft, 400 Z., `{}` entfernt |
| Speicher | `customers.ai_branch_extra` (jsonb), führend | live seit E10 |
| In den Prompt | `wizardVariables()` + `operationalLines()`, `prompt-builder-v2.js` | live seit 2.2 |

**Diese Architektur ist gut und soll wiederverwendet werden.** Der Auftrag sagt das, und die Prüfung bestätigt es: schemagetriebenes Rendern plus Allowlist beim Schreiben ist genau die richtige Form, sobald Kundeneingaben zu Prompt-Variablen werden.

### 4.2 Sie ist aber zu einem Drittel gar nicht branchenspezifisch

Verteilung der 20 Schlüssel über die 7 Vorlagen:

| Schlüssel | Typ | in Vorlagen | Bewertung |
|---|---|---|---|
| `sprechstunden_modus` | radio | **7 / 7** | **generisch** — Wortlaut in `coiffeur` und `restaurant` identisch |
| `termin_modus` | radio | 5 / 7 | **generisch** — dasselbe Konzept wie `[PROMPT_V2].appointmentMode` |
| `booking_url` | text | 4 / 7 | **generisch** — es gibt bereits `customers.ai_online_booking_url` |
| `notfallnummer_dringend` | text | 3 / 7 | halb generisch, siehe 3.3 |
| `notfall_service_name` | text | 3 / 7 | halb generisch |
| `notfallnummer_lebensgefahr` | text | 2 / 7 | halb generisch |
| `spezialgebiet` | text | 2 / 7 | generisch formulierbar |
| übrige 13 (`takeaway_aktiv`, `faerbung_beratung`, `stylisten_namen`, `allergene_info`, `pannendaten_aufnehmen`, `max_gruppe_ohne_rueckruf`, `medizinische_abgrenzung`, `gaeste_typen`, `haeufigste_anliegen`, `termin_vorlaufzeit`, `allergien_abfragen`, `kinder_service`, `sprachen`) | gemischt | je 1 / 7 | **echt branchenspezifisch** |

**Fakt:** Die drei häufigsten Schlüssel sind in sieben Vorlagen dupliziert und fehlen den zwölf ohne `extra_steps` komplett. Wer heute `handwerk`, `anwalt`, `zahnarzt`, `treuhand` oder `it-support` zugeordnet bekommt, kann seinen Einsatz-Modus nicht angeben — obwohl die Frage mit der Branche nichts zu tun hat.

**Auch inhaltlich hängt `sprechstunden_modus` in der Luft:** Die Option „Nur ausserhalb der Öffnungszeiten" setzt voraus, dass die Öffnungszeiten maschinenlesbar vorliegen. Heute stehen sie als Fliesstext in `ai_location_hours`. Die Frage ist also gestellt, aber nicht beantwortbar — und genau deshalb gehören die strukturierten Öffnungszeiten und die generische Schicht in **einen** Schnitt.

### 4.3 G3 — 23 von 39 Branchenfeldern erreichen den Prompt nie

Ein Feld wirkt nur, wenn (a) `operationalLines()` seinen Schlüssel kennt (`prompt-builder-v2.js:201–212`, 7 Schlüssel fest verdrahtet) **oder** (b) der `prompt_block` derselben Vorlage `{{schlüssel}}` enthält. Beides live abgefragt:

| Vorlage | Felder | wirksam | wirkungslos |
|---|---|---|---|
| `coiffeur` | 6 | 2 (`termin_modus`, `booking_url`) | `sprechstunden_modus`, `stylisten_namen`, `faerbung_beratung`, `kinder_service` |
| `facharzt` | 4 | **0** | alle vier |
| `garage` | 6 | 3 (`termin_modus`, `pannendaten_aufnehmen`, `notfallnummer_dringend`) | `sprechstunden_modus`, `notfall_service_name`, `termin_vorlaufzeit` |
| `hotel` | 5 | 3 (`termin_modus`, `booking_url`, `sprachen`) | `sprechstunden_modus`, `gaeste_typen` |
| `kosmetik` | 6 | 3 (`termin_modus`, `booking_url`, `allergien_abfragen`) | `sprechstunden_modus`, `spezialgebiet`, `medizinische_abgrenzung` |
| `restaurant` | 6 | 3 (`termin_modus`, `booking_url`, `takeaway_aktiv`) | `sprechstunden_modus`, `max_gruppe_ohne_rueckruf`, **`allergene_info`** |
| `versicherung` | 6 | 2 (`haeufigste_anliegen`, `notfallnummer_lebensgefahr`) | `sprechstunden_modus`, `notfall_service_name`, `notfallnummer_dringend`, `spezialgebiet` |
| **Summe** | **39** | **16** | **23** |

Nur die einzigen zwei `prompt_block`-Platzhalter, die es überhaupt gibt, sind `{{notfallnummer_dringend}}` (in `garage` und `handwerk`) und `{{notfallnummer_lebensgefahr}}` (in `versicherung`). Alle anderen 16 Vorlagen enthalten keinen einzigen.

**Warum das jetzt zählt:** Vor PR #859 waren diese Felder Admin-interne Wizard-Fragen. Seit I8 füllt sie **der Kunde** in seinem Dashboard aus, sieht eine Bestätigung und muss annehmen, dass sein Assistent sich daran hält. Bei `facharzt` hält er sich an nichts davon.

**Zwei Sonderfälle, die es besonders deutlich machen:**

- `restaurant` erfasst `allergene_info`. `operationalLines()` liest `allergien_abfragen` — den Schlüssel aus `kosmetik`. Zwei Namen für dieselbe Frage, einer davon wirkungslos (`prompt-builder-v2.js:209`).
- `PLACEHOLDER_FALLBACKS` (`prompt-builder-v2.js:19–23`) definiert einen sorgfältigen Rückfalltext für `notfall_service_name`. Kein einziger `prompt_block` benutzt diesen Platzhalter. Der Rückfall kann nie greifen.

Das ist **keine Regression aus PR #859** — es ist eine Lücke, die PR #859 sichtbar gemacht hat, indem er die Felder an den Kunden gab.

---

## 5. Weitere Funde

Alle am Code oder an der Produktionsdatenbank verifiziert.

| # | Fund | Beleg | Bewertung |
|---|---|---|---|
| **G1** | **Eckige Klammern sind ein dritter, unaufgelöster Platzhalter-Dialekt.** `[Strasse, PLZ Ort]`, `[Nummer]`, `[Preis oder "kostenloses Erstgespräch"]` stehen in **19/19** `default_location_hours`, **14/19** `default_booking_faq` und 5/19 `default_services`. Diese Texte werden beim Anlegen in die Kundenspalten kopiert und von dort unverändert in den Prompt geschrieben. `neutralizePlaceholders()` behandelt ausschliesslich `{{…}}`. | `prompt-builder-v2.js:58–63`; `index.html:7505–7508` → `:7699`; SQL-Regex über alle 19 Vorlagen | **Latent, sicherheitsnah, exakt das Muster von D3.** Heute nicht ausgelöst: der einzige Kunde mit Inhalt hat seine Texte aus der Website-Analyse, nicht aus Defaults. Wird scharf, sobald ein Kunde mit Vorlage angelegt und nicht vollständig nachbearbeitet wird — also durch A3. `handwerk` würde dem Agenten sagen: „Notfalleinsätze: 24h/7 — Notfallnummer **[Nummer]**". |
| **G2** | **`calendar_settings.business_hours` ist definiert und tot.** Eine `jsonb`-Spalte mit exakt der Struktur, die strukturierte Öffnungszeiten brauchen (`{"mon":[["08:00","17:00"]], …}`), mit sinnvollem Default. **Kein einziger Leser oder Schreiber im gesamten Repo** — `calendar-tool.js` lädt `select('*')` und benutzt nur `minimum_notice_minutes`, `booking_horizon_days`, `buffer_*`, `timezone`, `appointment_title_template`. | `supabase/migrations/2026-08-01_calendar_integrations_foundation.sql:38`; `calendar-tool.js:51–73`; repoweite Suche: 1 Treffer, die Migration selbst | **Zwei Konsequenzen.** Erstens: Die Terminbuchung prüft heute **nicht** gegen Öffnungszeiten — sie bucht, was der Kalender freihat, auch sonntags um 03:00. Das ist ein eigenständiger Befund und gehört gemeldet. Zweitens: Für das Zielbild ist es ein Geschenk — die Zielstruktur für Öffnungszeiten muss nicht erfunden werden, sie liegt bereits im Schema. |
| **G3** | **23 von 39 Branchenfeldern erreichen den Prompt nie** (Abschnitt 4.3), darunter `sprechstunden_modus` in allen sieben Vorlagen. | `prompt-builder-v2.js:201–212`; SQL über `extra_steps` × `prompt_block` | **Der dringlichste Einzelbefund.** Der Kunde füllt seit I8 Felder aus, die folgenlos bleiben. Kein Datenverlust, aber ein gebrochenes Versprechen im UI. |
| **G4** | **Generische Fragen sind siebenfach in Branchenvorlagen dupliziert** (Abschnitt 4.2). Der Optionstext von `sprechstunden_modus` ist in `coiffeur` und `restaurant` Wort für Wort identisch, nur die Unterzeile nennt „Salon" bzw. „Restaurant". | SQL-Vergleich `extra_steps` | Erklärt, warum 12 Vorlagen diese Fragen gar nicht stellen. Pflegeschuld, die mit jeder neuen Vorlage wächst. |
| **G5** | **UI-Beschriftung und Prompt-Überschrift widersprechen sich.** „Häufige Fragen und Buchungshinweise" → `## TERMINLOGIK & FAQ`; „Standort und reguläre Öffnungszeiten" → `## STANDORT & ERREICHBARKEIT`. | `customer-runtime-assistant-profile.js:612` vs. `prompt-builder-v2.js:302–303` | Klein, aber ursächlich: das Feld heisst für den Kunden anders, als es für den Agenten wirkt. Terminregeln landen deshalb im FAQ-Feld. |
| **G6** | **Die Aufnahme-Checkliste steht doppelt.** 15 von 19 `default_booking_faq` beginnen mit „… aufnehmen: Name, …". Dasselbe existiert typisiert als `[PROMPT_V2].requiredInformation` und wird als eigener Prompt-Abschnitt `## PFLICHTINFORMATIONEN` gerendert. | `prompt-builder-v2.js:222–224`; SQL: 15/19 | Zwei Quellen für dieselbe Anweisung, ohne Rangfolge. Der Agent bekommt die Checkliste potenziell zweimal, mit abweichendem Wortlaut. |
| **G7** | **`ai_short_description` und `ai_online_booking_url` sind gepflegte, ungelesene Spalten.** Beide werden im Admin-Wizard erfasst und gespeichert; `buildPromptV2()` liest keine von beiden, das Kunden-Dashboard zeigt keine von beiden. `booking_url` wird stattdessen als Branchen-Wizard-Schlüssel geführt. | `index.html:7702`, `:7930`; Spaltenliste `customers`; `prompt-builder-v2.js` (keine Treffer) | Dasselbe Muster wie D4/D5. Für das Zielbild relevant: zwei der benötigten Zielspalten existieren bereits, sie sind nur nicht angeschlossen. |

---

## 6. Zielbild

### 6.1 Das Ordnungsprinzip

Nicht „Freitext vs. strukturiert" — das ist zu grob und führt zur falschen Diskussion. Drei Schichten, nach **Frageform**:

| Schicht | Frageform | Wer definiert die Felder | Wo liegen die Werte |
|---|---|---|---|
| **A — Betriebsfakten** | geschlossen: Zeit, Zahl, Adresse, Auswahl | Voxera, für **alle** Kunden gleich | typisierte Spalten |
| **B — Branchenfragen** | geschlossen oder halboffen, branchenabhängig | `industry_templates.extra_steps` | `customers.ai_branch_extra` (jsonb) |
| **C — Erzählung** | offen, mehrere Sätze | niemand — der Kunde formuliert | Textspalten, aber **thematisch eng** |

Die vier heutigen Boxen sind allesamt Schicht C, obwohl ihr Inhalt zu grossen Teilen A und B ist. Das ist der Fehler in einem Satz.

### 6.2 Feld-für-Feld

Kürzel: **A** = neue/bestehende typisierte Spalte, **B** = Vorlagen-Feld, **C** = bleibt Freitext, **✓** = Ziel existiert bereits.

| Heute in | Inhalt | Ziel | Schicht |
|---|---|---|---|
| `ai_business_description` | Was das Unternehmen tut, Positionierung | bleibt — aber ohne Zielgruppe/Preis/Agentenverhalten | **C** |
| | Zielgruppen | `ai_target_groups` (neu) — Extraktor liefert es bereits getrennt | **A** |
| | Preis/Konditionen | `ai_pricing_note` (neu), kurz, mit Warnhinweis „Preise nur nennen, wenn hier hinterlegt" | **A** |
| | „Lara nimmt … entgegen" (14/19) | gehört zu `[PROMPT_V2]`, **aus Kategorie 2 entfernen** | — |
| `ai_services` | Leistungsliste | Liste von Einträgen statt Zeilentext; Preis pro Leistung **optional** und ausdrücklich als „unverbindlich" markiert | **A** |
| `ai_location_hours` | Adresse (19/19) | `street`/`zip`/`city` ✓ — nur anzeigen und in den Prompt bringen | **A ✓** |
| | Öffnungszeiten (19/19) | `ai_opening_hours` jsonb, **exakt die Struktur von `calendar_settings.business_hours`** (G2) | **A** |
| | Notfallnummer (7/19) | `ai_emergency_number` ✓ — Duplikat aus dem Freitext streichen | **A ✓** |
| | Anfahrt/Parking/ÖV (5/19) | `ai_arrival_note` (neu), ein Kurzfeld | **A** |
| | Einsatzgebiet (2/19) | `ai_service_area` (neu), ein Kurzfeld | **A** |
| | Vorbereitung/Mitbringen (3/19) | `ai_visit_preparation` (neu), ein Kurzfeld | **A** |
| `ai_booking_faq` | Aufnahme-Checkliste (15/19) | `[PROMPT_V2].requiredInformation` ✓ — **G6 auflösen, eine Quelle** | **A ✓** |
| | Terminregeln („Gruppen ab 8 → Rückruf") | teils `appointmentMode` ✓, teils Vorlagenfeld (`max_gruppe_ohne_rueckruf`) | **A ✓ / B** |
| | Preisaussagen (13/19) | `ai_pricing_note`, siehe oben | **A** |
| | echte Frage-Antwort-Paare (19/19) | **bleibt offen — aber als Liste von Paaren**, nicht als Block | **C, strukturiert** |
| `extra_steps` | `sprechstunden_modus`, `termin_modus`, `booking_url` | **in Schicht A verschieben**, aus 7 Vorlagen entfernen, für alle 19 verfügbar | **A** |
| | die 13 echt branchenspezifischen Schlüssel | bleiben, wo sie sind | **B** |

**Bewusst Freitext, mit Begründung:**

- **Unternehmensbeschreibung** — die Positionierung eines Betriebs ist nicht in Felder zerlegbar, und der Assistent braucht sie als Erzählton. Aber: nach dem Herauslösen von Zielgruppe, Preis und Agentenverhalten ist das Feld ein enges Thema und die Vermischung hat keinen Anlass mehr.
- **Antworten in den häufigen Fragen** — der Inhalt bleibt offen. Nur das **Paar** (Frage / Antwort) wird zur Struktur. Alle 19 Vorlagen und der Extraktor schreiben ohnehin schon Paare (3.4).
- **Die vier Kurzfelder** (Anfahrt, Einsatzgebiet, Vorbereitung, Preishinweis) sind kurzer Freitext mit engem Thema — bewusst keine Dropdowns. Ein Einsatzgebiet lässt sich nicht aus einer Liste wählen.

### 6.3 Was der Kunde davon sieht

Aus vier gleich aussehenden Textareas wird ein Formular mit drei erkennbaren Teilen:

1. **„Ihr Betrieb"** — Adresse (aus bestehenden Spalten), Öffnungszeiten als Wochentagsraster, Einsatzgebiet, Anfahrt. Alles Schicht A, gilt für jeden Kunden.
2. **„Was Sie anbieten"** — Leistungen als Liste, Zielgruppen, Preishinweis, Beschreibung als *ein* Textfeld mit klarer Frage („Was macht Ihr Unternehmen aus?").
3. **„Für Ihre Branche"** — bleibt exakt wie seit I8 gebaut, nur um die drei generischen Fragen erleichtert.
4. **„Häufige Fragen"** — Paarliste mit „+ Frage hinzufügen".

**Ein Nebeneffekt, der zum North Star passt:** Beim Öffnungszeiten-Raster kann zum ersten Mal danebenstehen, was die Eingabe im Gespräch bewirkt („Ausserhalb dieser Zeiten sagt Ihr Assistent: geschlossen, und nimmt eine Nachricht auf"). Bei einem Fliesstextfeld ist das unmöglich.

---

## 7. Antwort auf Auftragsfrage 4 — gleicher Mechanismus oder getrennter Layer?

**Empfehlung: derselbe Mechanismus, getrennter Speicher.** Konkret:

| Aspekt | Generische Felder (A) | Branchenfelder (B) | gemeinsam? |
|---|---|---|---|
| Schema-Definition | neu: `core_steps` (ein Ort, gilt für alle) | `industry_templates.extra_steps` | verschieden |
| Renderer im Kunden-UI | `buildBranchSections()` verallgemeinert | dieselbe Funktion | **ja** |
| Allowlist beim Schreiben | `branchFieldRules()`/`sanitizeBranchExtra()` verallgemeinert | dieselben Funktionen | **ja** |
| Auflösung als Prompt-Variable | `wizardVariables()` | dieselbe Funktion | **ja** |
| **Speicherort der Werte** | **typisierte Spalten** | `ai_branch_extra` (jsonb) | **nein** |

**Drei Gründe, alle am Code belegt, warum der Speicher nicht geteilt werden darf:**

1. **`ai_branch_extra` ist ohne Branchenvorlage nicht beschreibbar.** `customer-update-assistant.js:232–235` antwortet mit HTTP 409 `no_industry_template`, sobald kein `industry_template_id` gesetzt ist. **3 von 4 Kunden** haben heute keine. Generische Felder in denselben Bag zu legen hiesse: Öffnungszeiten erst nach der Branchenzuordnung erfassbar. Das ist genau die Kopplung, die A3 gerade auflösen soll.
2. **Öffnungszeiten haben einen zweiten Konsumenten.** `calendar_settings.business_hours` (G2) braucht sie maschinenlesbar für die Verfügbarkeitsprüfung. Aus einem vorlagenabhängigen jsonb-Bag heraus ist das nicht sauber les- oder migrierbar; eine typisierte Spalte mit fester Struktur schon. Dasselbe gilt für `sprechstunden_modus`, das ohne maschinenlesbare Zeiten inhaltlich gar nicht funktioniert (4.2).
3. **Die Allowlist ist eine Eigenschaft des Schreibpfads, nicht des Speichers.** Ihr Zweck ist, dass nur schema-definierte Schlüssel zu Prompt-Variablen werden — das gilt für generische Felder genauso und wird durch geteilten Code erreicht, nicht durch eine geteilte Spalte. Der Schutz geht also nicht verloren.

**Was das für die 12 Vorlagen ohne `extra_steps` bedeutet:** Sie brauchen keine mehr, um brauchbar zu sein. Nach dem Verschieben der drei generischen Schlüssel decken `core_steps` die Fragen ab, die diese 12 wirklich vermissen. Übrig bleibt echte Inhaltsarbeit für einzelne Branchen — kleiner Restposten statt Blocker.

---

## 8. Vorgeschlagene Schnittfolge — nach Freigabe

**Nichts davon startet ohne Rückmeldung.** So geschnitten, dass jeder Schnitt einzeln lieferbar ist und J1–J2 auch dann Wert haben, wenn der Rest verschoben wird.

| Schnitt | Inhalt | Abhängigkeit | Modell/Effort |
|---|---|---|---|
| **J1** | **G3 beheben — Branchenantworten wirksam machen.** `sprechstunden_modus` und die 22 weiteren wirkungslosen Antworten erreichen den Prompt (generischer Abschnitt statt fest verdrahteter 7-Schlüssel-Liste in `operationalLines()`); `allergene_info`/`allergien_abfragen` auf einen Schlüssel bringen. **Kein UI, keine Migration.** | keine | Opus 5, Hoch — sicherheitsnah, verändert Prompt-Inhalt |
| **J2** | **G1 beheben — eckige Klammern neutralisieren**, im selben Muster wie D3: unaufgelöste `[…]` in kopierten Vorlagentexten werden zu einer ausdrücklichen Nicht-Anweisung. **Vorbedingung für das Nachziehen von A3**, wie D3 es war. | keine | Opus 5, Mittel — sicherheitsnah |
| **J3** | **G2 melden und entscheiden.** Kein Code: Die Terminbuchung prüft nicht gegen Öffnungszeiten. Entweder eigener Auftrag oder bewusst akzeptiert. **Muss vor J5 entschieden sein**, weil es die Zielstruktur der Öffnungszeiten bestimmt. | keine | Entscheidung |
| **J4** | **Schicht-A-Mechanismus bauen** — `core_steps`, geteilter Renderer, geteilte Allowlist. Zunächst **ohne** neue Felder, mit den drei aus `extra_steps` verschobenen Schlüsseln als erstem Inhalt. Vorlagen bereinigen. | J1 | Opus 5, Hoch |
| **J5** | **Öffnungszeiten strukturieren.** `ai_opening_hours` in der Struktur von `business_hours`, Wochentagsraster im UI, Migration bestehender Freitexte **nur mit Vorschau und Bestätigung**, nie automatisch. | J3, J4 | Opus 5, Hoch |
| **J6** | **Restliche Schicht-A-Felder** — Zielgruppen, Preishinweis, Einsatzgebiet, Anfahrt, Vorbereitung; Adresse aus `street`/`zip`/`city` anschliessen; `ai_short_description` und `ai_online_booking_url` anschliessen statt neu erfinden (G7). `websiteBusinessDescription()` schreibt danach in getrennte Felder (3.1). | J4 | Sonnet 5, Mittel |
| **J7** | **Leistungen und FAQ als Listen.** Leistungen als Einträge, FAQ als Frage-Antwort-Paare. Beides mit Rückfall auf den bestehenden Text, solange nicht migriert. | J4 | Sonnet 5, Mittel |
| **J8** | **G6 auflösen** — Aufnahme-Checkliste hat eine Quelle (`requiredInformation`), die 15 Vorlagentexte werden entsprechend gekürzt. Reine Inhaltsarbeit plus eine Rangfolge im Builder. | J7 | Opus 5, Mittel — Textarbeit |
| **J9** | **G5** — Beschriftungen und Prompt-Überschriften angleichen. | J7 | Sonnet 5, Klein |

**Reihenfolge-Begründung:** J1 und J2 beheben, dass heute vorhandene Kundeneingaben folgenlos bzw. fehlerhaft im Prompt landen. Sie brauchen weder Migration noch UI und sind unabhängig davon richtig, wie das Zielbild entschieden wird. Alles ab J4 ist die Architekturarbeit, für die dieser Auftrag die Freigabe einholt.

**Nicht Teil dieser Folge:** A3 (Branchenzuordnung nachziehen) — nur als Kontext gelesen, wie beauftragt. Anzumerken bleibt: **J2 ist eine neue Vorbedingung dafür**, im selben Sinn wie D3 es war.

---

## 9. Was ich für die Umsetzung entschieden brauche

| # | Frage | Meine Empfehlung |
|---|---|---|
| **F1** | **Getrennter Speicher für generische Felder** (typisierte Spalten) statt gemeinsamem `ai_branch_extra`? | **Ja.** Drei Belege in Abschnitt 7; der harte ist die 409-Sperre ohne Branchenvorlage, die 3 von 4 Kunden trifft. |
| **F2** | **J1 und J2 vorziehen** — unabhängig von der Architekturentscheidung, weil sie heute wirksame Fehler beheben? | **Ja.** Zusammen klein, ohne Migration, ohne UI. J2 ist ausserdem Vorbedingung für A3. |
| **F3** | **Migration bestehender Freitexte** — automatisch parsen oder Kunde bestätigt? | **Kunde bestätigt, nie automatisch.** Ein geparster Öffnungszeiten-Satz, den niemand geprüft hat, wird zur Aussage des Assistenten am Telefon. Vorschlag: Parser schlägt vor, Kunde bestätigt, Freitext bleibt bis zur Bestätigung führend. |
| **F4** | **Preisangaben überhaupt aufnehmen?** Die Sicherheitsregeln verbieten dem Agenten ausdrücklich erfundene Preise — ein Preisfeld ist der Gegenentwurf dazu. | **Ja, als `ai_pricing_note` mit engem Rahmen.** 13 von 19 Vorlagen enthalten heute schon Preisaussagen im FAQ-Feld; die Frage ist nicht *ob*, sondern ob sie an einer kontrollierten Stelle stehen. Formulierungsvorschlag im Prompt: „Nenne Preise ausschliesslich wörtlich wie hier hinterlegt; leite keine Preise ab." |
| **F5** | **G2 (Buchung ignoriert Öffnungszeiten)** — eigener Auftrag oder in J5 mitnehmen? | **Eigener Auftrag, aber vor J5 entschieden.** Es ist ein Verhaltensfehler der Terminbuchung, kein Datenmodellthema — gehört nicht in einen Feldstruktur-Schnitt. Die Zielstruktur von J5 hängt aber von der Antwort ab. |
| **F6** | **`sprechstunden_modus` und `termin_modus` aus den 7 Vorlagen entfernen** — akzeptiert, dass das bestehende Vorlagen ändert? | **Ja.** Sie sind wortgleich dupliziert (G4). Solange keine Kundenantworten existieren (`ai_branch_extra` ist bei allen 4 Kunden `null`), ist der Umzug ohne Datenmigration möglich. **Dieses Zeitfenster schliesst sich, sobald der erste Kunde Branchenfelder ausfüllt.** |

---

## 10. Grenzen dieser Diagnose

**Was Fakt ist:** alle Zahlen aus Abschnitt 3.3, 4.2, 4.3 und 5 stammen aus SQL-Abfragen gegen `ulcofbgrovgcvowdjrge` vom 09.08. und aus gelesenem Code an den genannten Stellen. Die Aussage „Feld X erreicht den Prompt nicht" ist geprüft an `operationalLines()` **und** an allen 19 `prompt_block`-Texten.

**Was nicht geprüft ist:**

- **Kein Live-Anruf.** Dass ein wirkungsloses Feld sich auch im Gespräch nicht auswirkt, ist aus dem Prompt-Aufbau abgeleitet, nicht am Telefon gemessen.
- **Kein echtes Kundenverhalten.** Wie KMU diese vier Boxen tatsächlich ausfüllen, ist mit einem einzigen, maschinell befüllten Datensatz nicht belegbar (1.1). Das Zielbild stützt sich auf die 19 Vorlagentexte — eine gute, aber indirekte Quelle. **Der stärkste nächste Erkenntnisschritt wäre ein echter Kunde**, nicht mehr Analyse.
- **G1 ist latent, nicht beobachtet.** Kein heutiger Kunde trägt Vorlagen-Defaults mit `[…]` in seinen Spalten. Der Weg dorthin ist im Code belegt (`index.html:7505–7508` → `:7699`), aber nicht an einem Datensatz beobachtet.
- **Aufwandsschätzungen** in Abschnitt 8 sind Einschätzungen, keine Messungen.
