# Geschäftswissen — die vier Freitextfelder: Diagnose und Zielbild

**Datum:** 09.08.2026 · **Nachtrag 09.08.** nach Freigabe (Abschnitt 11)
**Status:** Diagnose abgeschlossen. **J1, J2, J10, J4 und J5 sind gemergt und auf Produktion.** **J6 ist im Code umgesetzt und gegen Staging geprüft, seine Migration ist noch nicht auf Produktion** (Abschnitt 11.14). J7–J9 stehen aus; J3/F5 ist als eigener Auftrag nach J6 eingeplant, G9 danach.
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
| **G7** | **`ai_short_description` ist eine gepflegte, ungelesene Spalte — `ai_online_booking_url` war eine vollständig unbenutzte.** `ai_short_description` wird im Admin-Wizard erfasst und gespeichert, aber von `buildPromptV2()` nicht gelesen. **Korrektur (09.08., bei der J4-Umsetzung geprüft):** Für `ai_online_booking_url` stimmte „gepflegt" nicht — die Spalte kam repoweit nur in der Migration vor, die sie anlegte: kein Schreiber, kein Leser. Seit J4 ist sie das Ziel des generischen Felds `online_booking_url`. `booking_url` wird stattdessen als Branchen-Wizard-Schlüssel geführt. | `index.html:7702`, `:7930`; Spaltenliste `customers`; `prompt-builder-v2.js` (keine Treffer) | Dasselbe Muster wie D4/D5. Für das Zielbild relevant: zwei der benötigten Zielspalten existieren bereits, sie sind nur nicht angeschlossen. |

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

**Stand nach dem Nachtrag (Abschnitt 11): J1, J2, J10 und J4 sind umgesetzt. J3 ist als eigener Auftrag nach J5 eingeplant; J5–J9 stehen aus.** So geschnitten, dass jeder Schnitt einzeln lieferbar ist und J1–J2 auch dann Wert haben, wenn der Rest verschoben wird.

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

**Alle sechs Fragen sind entschieden — siehe Abschnitt 11.1 und 11.7. F4 wurde dabei gegenüber der Empfehlung unten verschärft.**

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

---

## 11. Nachtrag 09.08. — Entscheide und Umsetzung von J1/J2

### 11.1 Getroffene Entscheide

| # | Entscheid | Folge |
|---|---|---|
| **F1** | **Getrennter Speicher, wie empfohlen.** Generische Felder bekommen typisierte Spalten, nicht `ai_branch_extra`. | Bindend für J4–J6. Der Renderer und die Allowlist bleiben geteilt (Abschnitt 7). |
| **F2** | **J1 und J2 vorgezogen.** | Umgesetzt, siehe 11.2. |
| **F4** | **Preisfeld ja — aber nicht als blanker Text.** Der User hat die Frage als Rechtsfrage zurückgegeben, mit dem Hinweis, dass eine vom Agenten vorgelesene Preisangabe je nach Formulierung als verbindlicher Antrag (OR) gelten kann und damit den offenen Launch-Blocker „Haftung/Versicherung" berührt. | Siehe 11.4 — **entschieden mit Vorbehalt**, nicht abschliessend. |
| F3, F5, F6 | noch offen | Blockieren J5/J6, nicht J1–J4. |

### 11.2 Was umgesetzt ist

**J1 — G3 behoben.** Eine Branchenantwort erreicht den Prompt nicht mehr nur über die acht fest verdrahteten Regeln oder ein `{{platzhalter}}` in der Vorlage, sondern über das Vorlagenschema selbst: `branchFieldSchema()` liest `extra_steps`, `branchSchemaLines()` rendert jede beantwortete Frage mit ihrem Label und der **Bezeichnung** der gewählten Option statt des rohen Schlüsselwerts. Beide Aufrufer (`trigger-elevenlabs-sync.js`, `prompt-preview.js`) laden dafür jetzt `prompt_block,extra_steps` statt nur `prompt_block`.

Die kuratierten Sätze bleiben und haben Vorrang — sie machen aus einer Antwort eine Handlungsanweisung, was eine generische `Label: Wert`-Zeile nicht leistet. `operationalLines()` meldet neu, welche Schlüssel sie dabei verbraucht hat; nur so kann die schemagetriebene Ebene ergänzen, ohne zu doppeln. Ebenfalls übersprungen wird, was die Vorlage selbst als `{{schlüssel}}` platziert hat.

Zwei Eigenheiten der Produktionsdaten sind abgefangen:
- **`facharzt.sprechstunden_modus` hat kein `label`.** Dann steht die Optionsbezeichnung für sich, statt aus dem Schlüssel einen Kunstbegriff zu bauen.
- **Vorlagen-Optionstexte nennen wörtlich „Lara"** (z.B. „Ja – Lara nimmt Bestellungen auf"). Bei einem anders benannten Assistenten stünde damit ein fremder Selbstname in seinem eigenen Systemprompt. `withAssistantName()` setzt den tatsächlichen Namen ein.

**J2 — G1 behoben.** `neutralizePlaceholders()` kennt jetzt beide Dialekte; unausgefüllte `[…]`-Markierungen werden zur ausdrücklichen Nicht-Anweisung, genau wie `{{…}}` seit D3. Neu wird die Funktion auch auf den **Kunden-Layer** angewendet — dort liegen die aus Vorlagen kopierten Texte, und dort wurde bisher gar nicht neutralisiert. Bewusst pro Feld in `add()` und nicht auf dem fertigen Layer: `formatOperationalUpdates()` benutzt eckige Klammern als Typmarke (`- [Ferien / geschlossen] …`), die erhalten bleiben muss. Ein Test sichert genau das ab.

Der Ausdruck ist eng gefasst (keine Zeilenumbrüche, keine verschachtelten Klammern, höchstens 80 Zeichen). Er deckt alle **31** real in den Vorlagen vorkommenden Markierungen ab, ohne einen Absatz zu verschlucken, falls ein Kunde eckige Klammern regulär verwendet. **Geprüft:** kein einziger `prompt_block` der 19 Vorlagen enthält eckige Klammern — der Branchen-Layer ist von der Änderung faktisch nicht betroffen.

**Abnahme:** 14 neue Prüfungen in `scripts/verify-prompt-builder-v2.mjs`, alle 24 bestehenden weiterhin grün. Zusätzlich grün: `verify-elevenlabs-sync-changed-fields`, `verify-customer-assistant-profile`, `verify-ai-setup-identity-preservation`, `verify-admin-customer-write-integrity`, `verify-elevenlabs-calendar-tool-provisioning`.

### 11.3 Zwei bewusste Abweichungen vom Plan

1. **`allergene_info`/`allergien_abfragen` wurden *nicht* auf einen Schlüssel gebracht**, obwohl J1 das so ankündigte. Grund: die beiden Felder haben **verschiedene Optionsvokabulare** (`notieren|hinweisen` gegenüber `immer|hinweis`). Ein Alias im Code müsste raten, welcher Wert welchem entspricht — das ist eine inhaltliche Entscheidung am Vorlagentext, keine Umbenennung. Der generische Pfad rendert `allergene_info` jetzt ohnehin korrekt mit seiner eigenen Bezeichnung, der Befund ist damit entschärft. Die Vereinheitlichung gehört zu J4 („Vorlagen bereinigen").

2. **`booking_url` wird bei `termin_modus: aufnehmen` bewusst unterdrückt.** Es ist die einzige Stelle, an der ich eine beantwortete Frage absichtlich nicht in den Prompt lasse. Grund: Das Feld ist kein freistehender Fakt, sondern gehört zur Option „direkt" („Lara nennt den Online-Buchungslink"). Ein Betrieb, der ausdrücklich selbst bestätigen will, soll den Agenten nicht nebenbei einen zweiten Buchungsweg anbieten lassen. Sauber gelöst wird das im Formular, das den Link bei dieser Wahl gar nicht erst erfragt — J6.

### 11.4 F4 — Preisfeld: Entscheid mit Vorbehalt

Der User hat mir diese Frage zum Entscheid zurückgegeben. Ich trenne sie in zwei Teile, weil nur einer davon meiner ist.

**Was ich entscheide (Produktform):** `ai_pricing_note` kommt, aber nicht als freies Textfeld. Konkret für J6:
- **Voreinstellung ist „auf Anfrage"** — ein leeres Preisfeld führt dazu, dass der Agent auf Preisfragen die Rückfrage anbietet, nicht dass er schweigt oder ableitet.
- **Typisiert statt Fliesstext:** Preisart (`ab_preis` / `fixpreis` / `auf_anfrage`), Betrag, Einheit, Gültigkeitshinweis. Damit lässt sich die Aussage im Prompt kontrolliert formulieren, statt einen Kundensatz wörtlich zu übernehmen.
- **Der Unverbindlichkeitsbaustein ist nicht abwählbar.** Sobald eine Preisangabe hinterlegt ist, hängt der Builder eine feste Formulierung an („Preise sind Richtwerte, keine verbindliche Zusage; zur Bestätigung an das Unternehmen verweisen"). Kein Kundenfeld kann sie überschreiben — dieselbe Bauform wie die `VERBINDLICHE SICHERHEITSREGELN`.
- **Keine Ableitung:** die bestehende Regel „Erfinde keine Preise" bleibt und bekommt den Zusatz, dass nur wörtlich Hinterlegtes genannt werden darf.

**Was ich nicht entscheide (Rechtsfrage):** Ob eine so formulierte, vom Agenten gesprochene Preisangabe unter Schweizer Recht als Antrag oder als blosse Einladung zur Offertstellung gilt — und ob der Disclaimer-Baustein dafür genügt — ist eine Frage an eine juristische Prüfung, nicht an mich. Ich kann die Formulierung liefern, nicht ihre Wirksamkeit beurteilen. **Empfehlung: J6 setzt das Feld technisch um, die Freischaltung im Kunden-UI hängt an derselben Prüfung wie der offene Launch-Blocker „Haftung/Versicherung".** Bis dahin ist das Feld admin-seitig pflegbar, aber nicht kundenseitig beworben.

Der Hinweis des Users hat den Entwurf verändert: mein ursprünglicher Vorschlag in Abschnitt 9 war ein kurzes Freitextfeld mit einer Prompt-Formulierung. Das hätte den Preis wörtlich aus Kundenhand in den Agentenmund gelegt. Die typisierte Form mit erzwungenem Baustein ist die Antwort auf das genannte Haftungsrisiko.

### 11.5 Neuer Befund G8 — die Rückfall-Vorschau im Admin zeigt einen Prompt ohne Sicherheitsregeln

Beim Nachziehen der Aufrufer gefunden, **nicht angefasst**, weil nicht freigegeben:

`admin-panel/index.html:16034–16087` enthält einen **zweiten, vollständigen Prompt-Bauer im Browser** (`buildCustomerLayer()`/`buildAiPrompt()`) mit eigener, abweichender Formulierung der Wizard-Zeilen. Er ist nicht der Normalfall: `admin-runtime-prompt-builder-v2.js:325–350` überschreibt `openAiPreview()` und holt den Prompt vom Server. Der Client-Bauer greift nur, wenn dieser Aufruf fehlschlägt — dann mit dem Toast „Server-Vorschau nicht verfügbar – lokale Vorschau angezeigt."

**Warum es trotzdem zählt:** Diesem Rückfall fehlen `## AUFGABEN & ERFOLGSKRITERIUM`, `## PFLICHTINFORMATIONEN`, `## TERMINBEFUGNIS`, die aktuellen Betriebsinformationen — und `## VERBINDLICHE SICHERHEITSREGELN`. Der Kommentar an der Stelle, die die Vorschau automatisch öffnet (`index.html:7793`), lautet „Auto-open prompt preview so admin can copy immediately for ElevenLabs". Ein Admin, der im Fehlerfall kopiert, überträgt einen Prompt **ohne Sicherheitsregeln** in den Agenten. Der Toast warnt, dass die Vorschau lokal ist — nicht, dass sie unvollständig ist.

**Bewertung:** eigenständiger Befund derselben Familie wie G3 (die Oberfläche zeigt etwas anderes, als produktiv gilt), aber im Rückfallpfad und mit Warnhinweis, also nicht dringlich. **Vorschlag J10:** den Client-Bauer entfernen und im Fehlerfall ehrlich „Vorschau nicht verfügbar" anzeigen, statt eine unvollständige Fassung. Nicht Teil von J1/J2.

> **Nachtrag: J10 ist umgesetzt.** Der User hat G8 als eigenen kleinen Auftrag eingeordnet und vorgezogen — begründet damit, dass fehlende Sicherheitsregeln im Rückfall-Prompt ohne entsprechenden Hinweis ein zu reales Risiko sind. Siehe 11.6.

**Anmerkung zu J1:** Der Client-Bauer kennt die neuen schemagetriebenen Zeilen nicht. Die Abweichung zwischen ihm und dem Server wächst damit — sie war aber schon vorher deutlich grösser (ganze Abschnitte fehlen), und der produktive Prompt für den Agenten kommt ausschliesslich aus `trigger-elevenlabs-sync.js`.

### 11.6 J10 — der zweite Prompt-Bauer im Browser ist entfernt

**Freigegeben und umgesetzt** als eigener kleiner Auftrag, vorgezogen vor J3–J9.

Entfernt wurden `resolvePromptVariables()`, `buildCustomerLayer()`, `buildAiPrompt()` und `buildAiGreeting()` aus `admin-panel/index.html` — 159 Zeilen, ein in sich geschlossener Cluster, der nur sich selbst und `openAiPreview()` bediente. Damit gibt es genau **eine** Quelle für den Prompt: `buildPromptV2()` auf dem Server, dieselbe Funktion, die auch der Sync benutzt.

`openAiPreview()` baut nichts mehr, sondern zeigt eine ausdrückliche Nicht-Verfügbarkeit. Der Rückfallpfad in `admin-runtime-prompt-builder-v2.js` ruft nicht mehr den lokalen Bauer auf, sondern setzt denselben Text und entfernt die Qualitätsanzeige, damit keine Restanzeige einen geladenen Zustand vortäuscht. Der Toast lautet neu „Vorschau nicht verfügbar" statt „lokale Vorschau angezeigt".

**Beim Entfernen zusätzlich gefunden:** Der Client-Bauer setzte bei fehlender Notfallnummer **`112` als Standard** ein (`index.html:16027` alt), gelesen aus `customer.notfallnummer_lebensgefahr`.

> **Korrektur (09.08., beim Staging-Lauf geprüft).** Ich hatte hier geschrieben, dieses Feld gebe es auf `customers` gar nicht und der Wert sei „immer der erfundene Standard" gewesen. **Beides war falsch.** `customers.notfallnummer_lebensgefahr` existiert, mit Spalten-Default `'144'`, und trägt bei allen vier Kunden `144`. Der `112`-Rückfall hätte also nur bei einem ausdrücklich auf `NULL` gesetzten Wert gegriffen — bei keinem heutigen Kunden. Richtig bleibt: im entfernten Pfad stand eine fest verdrahtete Ersatznummer, die niemand konfiguriert hatte. Die Schwere hatte ich überzeichnet; der Befund selbst bleibt bestehen und ist mit dem Entfernen erledigt. Der Server macht es weiterhin ausdrücklich anders: `PLACEHOLDER_FALLBACKS` verweist auf den allgemeinen Notruf, statt eine Nummer zu setzen.

**Aufgeräumt:** `state.promptMasterL1` war nach dem Entfernen ohne Leser und ist samt seiner beiden Zuweisungen entfallen. Der L1-Master-Prompt wird nur noch serverseitig gelesen.

**Abnahme:** zwei neue Prüfungen (kein lokaler Prompt-Bau in `index.html`, kein Rückfall auf ihn im Fehlerpfad), alle vier Inline-Skriptblöcke der Seite parsen syntaktisch sauber, und `verify-admin-runtime-patches`, `verify-admin-design-system-v2`, `verify-admin-operations-v3`, `verify-ai-setup-identity-preservation`, `verify-admin-customer-write-integrity` sind grün.

**Nicht geprüft:** Die Oberfläche ist nicht im Browser aufgerufen worden. Dass die Vorschau im Normalfall weiterhin den Serverprompt zeigt, ist am Code belegt (der Wrapper ist unverändert, nur sein Fehlerpfad ist ersetzt), nicht klickend verifiziert.

### 11.7 J4 — Schicht A steht

**Freigegeben und umgesetzt** samt F3, F5 und F6.

**Der Mechanismus.** Die generischen Betriebsfelder benutzen denselben Renderer und dieselbe Allowlist wie die Branchenfelder, aber einen anderen Speicher — genau die Antwort auf Auftragsfrage 4. Konkret:

| | Schicht A (generisch) | Schicht B (Branche) |
|---|---|---|
| Schema | `system_config.core_field_steps` | `industry_templates.extra_steps` |
| Form des Schemas | **identisch** (plus `column` je Feld) | — |
| Renderer Kunden-UI | `schemaField(field, 'core')` | `schemaField(field, 'branch')` |
| Renderer Prompt | `branchSchemaLines()` | dieselbe Funktion |
| Renderer Admin-Wizard | `renderWizardDynamicStep()` | dieselbe Funktion |
| Speicher | typisierte Spalten | `ai_branch_extra` |
| Voraussetzung | keine | zugeordnete Branchenvorlage |

**Warum das Schema in der Datenbank liegt und nicht im Code:** `admin-panel` und `customer-dashboard` sind zwei getrennte Netlify-Sites mit je eigenem `publish`- und Functions-Verzeichnis; es gibt keinen gemeinsamen Modulpfad. Ein JS-Modul hätte in beide Bäume kopiert werden müssen — genau die Doppelung, die dieser Auftrag beseitigt. Die Datenbank ist der einzige Ort, den beide ohne Kopie lesen.

**Die Sicherheitsteilung, die daraus folgt:** Das Schema bestimmt, **welche** Frage gestellt wird und wie sie heisst. Es bestimmt **nicht**, welche Spalte beschrieben werden darf — diese Liste (`CORE_FIELD_COLUMNS`) steht im Code. Ohne diese Trennung wäre eine Zeile in `system_config` eine Schreibberechtigung auf `plan_code`, `status` oder `elevenlabs_agent_id`. Zwei Tests sichern sie ab: ein Schema, das `plan_code` als Ziel angibt, erzeugt weder eine Prompt-Zeile noch eine Schreibregel.

**Die drei Felder.** `sprechstunden_modus` → `ai_coverage_mode` (neu), `termin_modus` → `ai_appointment_mode` (neu), `booking_url` → `ai_online_booking_url` (existierte, war unbenutzt — siehe G7-Korrektur).

**Zwei Doppelungen sind dabei verschwunden:**

1. **Terminbefugnis lag zweimal vor** — als `termin_modus` (`aufnehmen|direkt`) in fünf Branchenvorlagen und als `appointmentMode` (`none|request|direct`) in der `[PROMPT_V2]`-Zeile. Übernommen wurde das reichere Vokabular in einer typisierten Spalte; die Notiz-Zeile ist nur noch Rückfall, dieselbe Rangfolge wie bei `ai_branch_extra` seit D4/E10.
2. **Der Buchungslink stand neben der Terminbefugnis statt in ihr.** Er hängt jetzt am Abschnitt `## TERMINBEFUGNIS`, gebunden an die Präferenz der anrufenden Person („Möchte die anrufende Person lieber selbst buchen…"). Damit widerspricht er keiner der drei Befugnisse.

**Eine Entscheidung aus J1 habe ich dabei zurückgenommen.** In J1 hatte ich `booking_url` bei `termin_modus: aufnehmen` unterdrückt, damit der Agent keinen zweiten Buchungsweg anbietet. Diese Begründung trug, solange das Feld an der Option „direkt" hing. In Schicht A ist der Link ein eigenständig beantwortetes generisches Feld mit eigenem Hinweistext („Nur nötig, wenn Anrufende stattdessen selbst online buchen sollen") — wer ihn ausfüllt, meint ihn. Er wird jetzt in jeder Terminbefugnis genannt, aber nur als Angebot an die anrufende Person. Ich halte das für richtiger als die Unterdrückung; es ist eine bewusste Änderung, kein Versehen.

**Ein sicherheitsrelevanter Punkt beim Altvokabular.** `termin_modus: direkt` bedeutete in vier der fünf Vorlagen „an Online-Buchung verweisen", in `garage` dagegen „Zeiten vorgeben und direkt bestätigen". Eine Abbildung auf `direct` hätte einem Betrieb Kalender-Buchungsbefugnis gegeben, die er nie gewählt hat. Der Rückfall bildet `direkt` deshalb auf `request` ab; der Link wandert getrennt als `online_booking_url` mit. Ein Test hält das fest.

**Vorlagen bereinigt (F6).** Die drei Schlüssel sind aus den sieben Vorlagen entfernt: 39 Felder → 23, exakt die 16 Vorkommen (7 + 5 + 4). Schritte, die dabei leer liefen, entfallen mit. Die Bereinigung wurde vor dem Schreiben als reines `SELECT` gegen die Produktionsdaten geprüft.

**Keine Datenübernahme nötig — und das ist belegt, nicht angenommen:** `ai_branch_extra` ist bei allen vier Kunden `null`, keiner trägt eine `[WIZARD]`-Zeile, `ai_online_booking_url` ist überall `null`. Das in Abschnitt 9/F6 beschriebene Fenster war zum Umsetzungszeitpunkt noch offen. Für das Zeitfenster zwischen Migration und Deploy liest der Builder die drei Altschlüssel trotzdem als Rückfall.

**F3 ist im Zielbild verankert, aber noch nicht umgesetzt** — es betrifft die Öffnungszeiten-Migration und gehört damit zu J5. Freigegeben ist: Parser schlägt vor, Kunde bestätigt, der Freitext führt bis zur Bestätigung.

**Abnahme:** 8 neue Prüfungen im Prompt-Builder, 9 im Kunden-Schreibpfad (in einer Sandbox mit gestubbtem `require`, damit die Allowlist echt ausgeführt und nicht nur ihr Quelltext geprüft wird). **Alle 47 `verify-*`-Suiten des Repos laufen grün**, bis auf `verify-db-security-invariants`, die auch ohne diese Änderung fehlschlägt (sie braucht Datenbankzugang, der hier nicht gesetzt ist).

**Zwei J1-Tests wurden ersetzt, nicht gelöscht:** Sie prüften das kuratierte Verhalten von `termin_modus`/`booking_url`, das es so nicht mehr gibt. An ihre Stelle treten Tests der neuen Regel, einschliesslich der konservativen Abbildung des Altvokabulars.

> **Angehalten — siehe 11.8.** Der Staging-Lauf hat gezeigt, dass `customers.sprechstunden_modus` bereits existiert; `ai_coverage_mode` wäre eine Doppelung. Die Migration wird vor dem Anwenden überarbeitet. Der übrige Absatz gilt unverändert. Die Migration `supabase/migrations/2026-08-09_core_field_layer.sql` ist **geschrieben, aber nicht angewendet**. Ich habe sie bewusst nicht gegen die Produktionsdatenbank ausgeführt: sie legt Spalten an, ändert Vorlagendaten und ist damit kein Schritt, den ich ohne ausdrückliche Freigabe gehe. **Reihenfolge zwingend: erst Migration, dann Deploy.** Umgekehrt lesen die Netlify-Funktionen Spalten, die es noch nicht gibt, und `customers`-Abfragen schlagen fehl. Der einzige Teil, der ohne Migration weiterläuft, ist das fehlende Schema: dann bleibt der generische Abschnitt leer und der Screen zeigt genau das, was er vor J4 zeigte.

### 11.8 Staging-Lauf der J4-Migration — mechanisch sauber, inhaltlich blockiert

**Gegen `hzqiyyqfchvfcmmbemvd` ausgeführt, danach vollständig zurückgebaut** (Testkunde, Testvorlagen, Schema-Zeile, beide Spalten und beide Constraints entfernt; Staging steht wieder bei 0 Kunden, 0 Vorlagen, 0 Testspalten).

Staging hatte weder Kunden noch Vorlagen. Ein blosser Durchlauf hätte deshalb den heikelsten Teil — die Vorlagenbereinigung — gegen nichts laufen lassen. Ich habe stattdessen sechs Testvorlagen angelegt, die gezielt die Grenzfälle abbilden. Das Ergebnis der Echtdaten kannte ich bereits aus dem `SELECT`-Trockenlauf gegen die Produktion.

| Prüfung | Ergebnis |
|---|---|
| Spalten, Constraints, Kommentare | angelegt wie geschrieben |
| Schema-Zeile in `system_config` | gültiges JSON, 1 Schritt, 3 Felder, Ziele `ai_coverage_mode`, `ai_appointment_mode`, `ai_online_booking_url` |
| Schritt nur mit Kernfeldern | verschwindet vollständig (1 → 0 Schritte) |
| Schritt gemischt | Kernfelder raus, `spezialgebiet` bleibt, Schritt überlebt |
| Vorlage ohne Kernfelder | unverändert |
| `extra_steps = '[]'` und `= null` | unverändert, kein Fehler |
| Feld ohne `key` | bleibt erhalten, `termin_modus` daneben entfernt |
| **Zweiter Lauf derselben Migration** | identisches Ergebnis, kein Fehler — wiederholbar |
| Gültige Werte (`backup`, `direct`) | akzeptiert |
| Ungültiger Wert (`immer_alles`) | von `customers_ai_coverage_mode_check` abgewiesen (23514) |

Zusätzlich vorab geprüft und bestätigt: `system_config.key` ist Primärschlüssel, `on conflict (key)` also gültig. Das war eine ungeprüfte Annahme in meiner Migration.

**Der blockierende Fund.** Die Fehlermeldung des Constraint-Tests zeigte im Zeileninhalt einen Wert `rund_um_die_uhr` in einer Spalte, die ich nicht angelegt hatte. Nachgeprüft:

**`customers.sprechstunden_modus` existiert bereits** — `text`, Spalten-Default `'rund_um_die_uhr'`, bei allen vier Kunden auf genau diesem Default. Der Admin-Wizard liest sie vor (`index.html:7567`, `knownCustomerKeys`) und schreibt sie zurück (`:7736`, `praxisPatch`). Mein `ai_coverage_mode` wäre damit ein **zweites Zuhause für dieselbe Angabe** — genau die Doppelung, die dieser Auftrag beseitigt.

Das erklärt zugleich G3 genauer, als die Diagnose es konnte: `sprechstunden_modus` erreichte den Prompt nicht, weil der Wizard die Antwort in eine **eigene Spalte** schrieb, während der Builder `ai_branch_extra` und die `[WIZARD]`-Zeile liest. Geschrieben wurde sie also durchaus — nur an einen Ort, den niemand liest.

**Neuer Befund G9 — vier weitere Schlüssel haben zwei bis drei Speicherorte.** `notfallnummer_lebensgefahr`, `notfallnummer_dringend`, `notfall_service_name` und `spezialgebiet` existieren **gleichzeitig** als `customers`-Spalten (vom Admin-Wizard geschrieben) und als Felder in `extra_steps` von `facharzt`, `garage`, `versicherung` und `kosmetik` (vom Kundendashboard nach `ai_branch_extra` geschrieben). Der Prompt-Builder liest nur `ai_branch_extra`/`[WIZARD]`. Zwei Schreiber, zwei Speicher, ein Leser — dieselbe Familie wie G3 und D4. Bei der Notfallnummer sind es sogar drei Orte: `customers.notfallnummer_lebensgefahr` (bei allen vier Kunden `144`), `customers.ai_emergency_number` (ebenfalls `144`, und die einzige, die der Builder liest) und das Vorlagenfeld gleichen Namens.

**Was das für J4 bedeutet.** Der Code steht und ist getestet; nur die Spaltenwahl für ein Feld ist falsch. Zwei Wege:

| | Vorgehen | Bewertung |
|---|---|---|
| **A (Empfehlung)** | `coverage_mode` zielt auf die bestehende `sprechstunden_modus` statt auf eine neue Spalte; `ai_coverage_mode` entfällt. Zusätzlich den Spalten-Default entfernen, damit „nicht beantwortet" überhaupt darstellbar ist. | Keine Doppelung, nutzt was da ist — dieselbe Linie wie bei `ai_online_booking_url`. Eine Änderung an Migration, drei Codestellen und den Fixtures. |
| B | `ai_coverage_mode` behalten, `sprechstunden_modus` später stilllegen | Erzeugt genau die Doppelung, gegen die dieser Auftrag angetreten ist, und verschiebt die Arbeit. |

**Eine Nebenfrage, die dabei entsteht und die ich nicht allein entscheide:** Der Default `rund_um_die_uhr` steht bei allen vier Kunden. Ob ihn jemand gewählt hat oder ob er nie angefasst wurde, lässt sich am Wert nicht unterscheiden — der Wizard schreibt bei unveränderter Vorauswahl denselben Wert. Rendert Schicht A ihn in den Prompt, behauptet der Agent eine Erreichbarkeitsregel, die möglicherweise niemand gewählt hat. Sauber wäre, die vier Werte auf `NULL` zu setzen und die Frage neu stellen zu lassen; das ist aber eine Änderung an Kundendaten und deshalb eine Entscheidung des Users, keine von mir.

**Die Migration wurde deshalb angehalten und überarbeitet — Ergebnis in 11.10.**

### 11.10 Zweiter Staging-Lauf der überarbeiteten Migration

**Entscheid A umgesetzt:** `coverage_mode` zielt auf die bestehende `customers.sprechstunden_modus`; ein `ai_coverage_mode` gibt es nicht. Neu ist nur `ai_appointment_mode` — eine `termin_modus`-Spalte existiert nicht, hier lag die Doppelung zwischen Vorlagenfeld und `[PROMPT_V2]`-Zeile.

**Der Default ist weg, die vier Werte sind zurückgesetzt** (Entscheid vom 09.08.: ein unbestätigter Default darf nicht als Fakt am Telefon gelten — derselbe Grundsatz wie beim Preisfeld). Bewusst wird nur der Wert `rund_um_die_uhr` genullt: eine ausdrückliche Wahl von `ausserhalb_sprechstunde` oder `backup` bliebe stehen.

Staging spiegelte den Produktionsstand exakt (`sprechstunden_modus` text mit Default `'rund_um_die_uhr'`, `ai_online_booking_url` vorhanden, `ai_appointment_mode` nicht). Zwei Testkunden bildeten den Unterschied ab, den das Zurücksetzen treffen muss.

| Prüfung | Ergebnis |
|---|---|
| Spalten-Default entfernt | `(keiner)` |
| `ai_appointment_mode` angelegt, **kein** `ai_coverage_mode` | bestätigt |
| Beide Check-Constraints | vorhanden |
| Kunde mit Default `rund_um_die_uhr` | → `NULL` |
| **Kunde mit ausdrücklicher Wahl `backup`** | **bleibt `backup`** |
| Neu angelegter Kunde | bekommt `NULL` statt des Defaults — „noch nicht beantwortet" ist jetzt darstellbar |
| Schema-Ziele | `sprechstunden_modus`, `ai_appointment_mode`, `ai_online_booking_url` |
| Vorlagenbereinigung, alle sechs Grenzfälle | wie im ersten Lauf |
| Zweiter Durchlauf | identisch, wiederholbar |
| `sprechstunden_modus = 'immer_alles'` | abgewiesen (23514) |
| `ai_appointment_mode = 'sofort_buchen'` | abgewiesen (23514) |

**Danach vollständig zurückgebaut:** Testkunden, Testvorlagen, Schema-Zeile, Spalte und beide Constraints entfernt, der ursprüngliche Spalten-Default wiederhergestellt. Staging steht wieder exakt auf dem Ausgangsstand.

**Drei Codestellen mussten mitziehen**, sonst hätte der Admin den zurückgesetzten Default sofort wieder gesetzt: der `praxisPatch`-Schreiber, der lokale State nach dem Wizard und der Zeilen-Mapper (alle drei hatten `|| 'rund_um_die_uhr'`). `sprechstunden_modus` fällt zudem aus `knownCustomerKeys`, weil Schicht A die Spalte unter ihrem Schema-Schlüssel `coverage_mode` einliest — sonst läge dieselbe Antwort unter zwei Namen im Wizard-Datensatz. Zwei Prüfungen halten das fest.

**Auf Produktion wurde bis hierher ausschliesslich gelesen.**

### 11.11 Migration auf Produktion angewendet

**Freigegeben und ausgeführt am 09.08.**, registriert als `20260809145741 core_field_layer`. Vorher wurde der Ist-Stand gesichert und ein Rückbau-Skript hinterlegt: `supabase/verification/2026-08-09_core_field_layer_rollback.sql`.

| Prüfung nach dem Lauf | Ergebnis |
|---|---|
| Spalten-Default auf `sprechstunden_modus` | `(keiner)` |
| `ai_appointment_mode` | angelegt |
| `ai_coverage_mode` | korrekt nicht vorhanden |
| Beide Check-Constraints | vorhanden |
| Die vier Kunden | alle `NULL` |
| Schema-Ziele | `sprechstunden_modus`, `ai_appointment_mode`, `ai_online_booking_url` |
| Vorlagenfelder gesamt | **39 → 23** |
| Verbliebene `sprechstunden_modus` / `termin_modus` / `booking_url` | keine |

Die Felder je Vorlage stimmen exakt mit dem `SELECT`-Trockenlauf und beiden Staging-Läufen überein: `coiffeur` 3, `facharzt` 3, `garage` 4, `hotel` 2, `kosmetik` 3, `restaurant` 3, `versicherung` 5.

> **Der Deploy muss jetzt folgen, und zwar zeitnah.** Es entsteht keine Störung — die aktuell ausgelieferte Anwendung liest die neuen Spalten nicht. Aber der ausgelieferte Admin-Wizard schreibt `sprechstunden_modus` noch mit `|| 'rund_um_die_uhr'`. **Jeder Wizard-Speichervorgang vor dem Deploy setzt den gerade zurückgesetzten Default für diesen Kunden wieder.** Der Wert bliebe gültig (die Constraint lässt ihn zu), aber die Frage gälte wieder als beantwortet, ohne dass jemand sie beantwortet hat. Das ist der einzige zeitkritische Punkt.

### 11.12 J5 — Öffnungszeiten sind maschinenlesbar

**Umgesetzt, Migration gegen Staging geprüft, nicht auf Produktion angewendet.**

**Zielstruktur.** `customers.ai_opening_hours` (jsonb), Form **identisch mit `calendar_settings.business_hours`**: `{"mon":[["08:30","12:00"],["13:30","17:30"]],…,"sun":[]}`. Mehrere Paare pro Tag bilden die Mittagspause ab, die in den Vorlagentexten der Normalfall ist. Leere Liste heisst geschlossen, `NULL` heisst „noch nicht bestätigt". Die Gleichheit mit `business_hours` ist der Punkt: J3/F5 (Buchung gegen Öffnungszeiten prüfen) setzt darauf auf, ohne dass die Struktur nochmal wechselt.

**Damit ist auch die Lücke aus Abschnitt 4.2 geschlossen:** `sprechstunden_modus = ausserhalb_sprechstunde` hat zum ersten Mal Zeiten, auf die es sich beziehen kann.

**Entscheid F3 ist im Code getrennt umgesetzt** — das ist der Kern:
- `parseOpeningHours()` **darf raten**. Er liest aus dem Freitext einen Vorschlag und meldet ausdrücklich, welche Zeilen mit Zeitangaben er *nicht* zuordnen konnte. Ohne diese Liste suggerierte der Vorschlag eine Vollständigkeit, die er nicht hat.
- `sanitizeOpeningHours()` **darf nicht raten**. Ungültiges wird abgewiesen, nicht zurechtgebogen: Zeitformat, Ende nach Beginn, keine Überschneidungen. Überschneidungen sind kein Schönheitsfehler — aus ihnen ist „ausserhalb der Öffnungszeiten" nicht eindeutig bestimmbar.
- Der Vorschlag wird **nie gespeichert**. Er reist im Lesepfad mit, füllt auf Knopfdruck das Formular, und erst das Speichern schreibt. Bis dahin führt der Freitext.

**Im Prompt** erscheint der Abschnitt `## REGULÄRE ÖFFNUNGSZEITEN` erst, wenn bestätigte Zeiten vorliegen, und sagt seinen Vorrang ausdrücklich an: weichen Zeitangaben im Standort-Freitext ab, gelten die strukturierten. Die alten Zeiten aus dem Freitext zu entfernen wäre die Alternative gewesen — das hiesse, den Text eines Kunden ungefragt umzuschreiben.

**Der Parser ist gegen die echten Vorlagentexte geprüft**, nicht gegen erfundene Beispiele. Zwei Fehler kamen dabei heraus, die an konstruierten Fällen nie aufgefallen wären:
1. **`\b` bricht an Umlauten.** JavaScript zählt ohne `/u` Umlaute nicht als Wortzeichen, also sah `\bfr\b` in „Frühstück" eine Wortgrenze — die Frühstückszeiten eines Hotels wurden zu Freitags-Öffnungszeiten. Die Wortgrenze wird jetzt ausdrücklich über die deutschen Buchstaben gebildet.
2. **`Samstag [Zeiten oder "geschlossen"]` wurde als „Samstag geschlossen" gelesen.** Eine Behauptung, die im Vorlagentext gerade nicht steht. Unausgefüllte Markierungen werden vor dem Parsen entfernt — dieselbe Behandlung wie im Prompt seit J2.

Ausserdem gelöst: ein Komma trennt mal Segmente („Mo–Fr 08:00–12:00, Sa 09:00–13:00"), mal nur Tage, die sich eine Zeitspanne teilen („Dienstag, Mittwoch 09:00–17:00"). Unterscheidungsmerkmal ist, ob das Segment selbst eine Zeit nennt.

**Staging-Lauf.** Ein Formulierungsfehler ist dabei aufgefallen: **CHECK-Constraints dürfen in PostgreSQL keine Unterabfrage enthalten** (0A000). Die Formprüfung ist jetzt mengenwertig formuliert — nach Entfernen der sieben Tagesschlüssel muss ein leeres Objekt übrig bleiben. Geprüft und danach vollständig zurückgebaut:

| Prüfung | Ergebnis |
|---|---|
| Spalte, Constraint, Schema-Eintrag | angelegt |
| Gültiges Wochenraster | akzeptiert |
| `{"montag":…}` (falscher Schlüssel) | abgewiesen (23514) |
| `{"mon":"08:00-12:00"}` (kein Array) | abgewiesen (23514) |
| Schema-Ergänzung dreimal ausgeführt | Feld genau einmal vorhanden |
| Rückbau | Kunden 0, Schema-Zeile 0, Testspalten 0, Default wiederhergestellt |

**Ein Nebenbefund, der gemeldet gehört:** `customer-assistant-components.css` steht mit meiner Ergänzung bei **exakt 1300 Zeilen — dem Budget aus `verify-customer-design-foundation`**. Ich habe meinen Block dafür gestrafft. Die nächste UI-Ergänzung sprengt das Budget, und dann ist zu entscheiden, ob die Datei aufgeteilt oder das Budget angehoben wird. Das ist keine Sache, die nebenbei im nächsten Auftrag mitlaufen sollte.

**Ebenfalls gefangen, und zwar von der Prüfung aus PR #878:** `ai_opening_hours` fehlte zunächst in `PROMPT_RELEVANT_FIELDS`. Ohne diesen Eintrag hätte das Dashboard neue Zeiten angezeigt, während der Agent weiter die alten spricht — dieselbe Fehlerklasse wie N6. Der Wächter hat das sofort gemeldet.

### 11.13 Was nach J1–J5 unbewiesen bleibt

- **Kein Live-Anruf.** Dass die 23 Felder jetzt *wirken*, ist am gebauten Prompt geprüft, nicht am Telefon. Der Prompt enthält die Angaben nachweislich — ob das Modell sie befolgt, ist damit nicht gezeigt.
- **Kein Kunde hat heute Branchenantworten.** `ai_branch_extra` ist bei allen 4 Kunden `null`. J1 ist also an Fixtures geprüft, die den Vorlagen nachgebaut sind, nicht an echten Antworten. Der erste Kunde mit ausgefüllten Branchenfeldern ist der eigentliche Test.
- **G1 bleibt latent.** Kein heutiger Kunde trägt Vorlagen-Defaults mit `[…]`. J2 ist damit eine Vorsorge, die im Moment nichts sichtbar repariert — ihr Wert entsteht mit A3.
- **J5 ist nicht auf Produktion angewendet** und die neue Oberfläche nicht im Browser bedient. Der Parser ist an den echten Vorlagentexten geprüft, das Wochenraster nur an Quelltext- und Syntaxprüfungen. Wie es sich auf einem Telefon anfühlt, ist ungeprüft.
- **Kein Kunde hat bestätigte Öffnungszeiten.** Die Vorrangregel im Prompt ist an Fixtures belegt, nicht an einem echten Datensatz.
- **J4 ist nicht an einer laufenden Datenbank erprobt.** Die Migration ist geschrieben und ihr heikelster Teil — die Vorlagenbereinigung — als `SELECT` gegen die Produktionsdaten geprüft. Angewendet ist sie nicht. Dass Lese- und Schreibpfad gegen die neuen Spalten tatsächlich funktionieren, ist an Fixtures und Sandbox-Tests belegt, nicht an einem echten Request.
- **Das Kunden-UI und der Admin-Wizard sind nicht im Browser geklickt.** Die neue Karte „Ihr Betrieb" und der neue Wizard-Schritt sind über Quelltextprüfungen und die Syntaxprüfung aller vier Inline-Skriptblöcke abgesichert. Wie sie aussehen, ist nicht gesehen worden.
- **Der Regex-Zuschnitt ist an 31 Vorlagen-Markierungen kalibriert, nicht an Kundentexten.** Schreibt ein Kunde eckige Klammern regulär und kurz, werden sie ersetzt. Ich halte das für den richtigen Kompromiss, es ist aber eine Abwägung und keine bewiesene Nebenwirkungsfreiheit.

### 11.14 J6 — die restlichen Schicht-A-Felder, das Preisfeld und ein Fehler aus J5

**Was dazugekommen ist.** Neun neue Spalten und eine angeschlossene bestehende, alle über denselben Mechanismus wie J4/J5 (Schema in `system_config.core_field_steps`, Spalten-Allowlist im Code):

| Schlüssel | Spalte | Form |
|---|---|---|
| `short_description` | `ai_short_description` (bestand bereits) | Textfeld |
| `target_groups` | `ai_target_groups` | Textfeld |
| `service_area` | `ai_service_area` | Zeile |
| `public_address` | `ai_public_address` | Zeile mit Vorschlag |
| `arrival_note` | `ai_arrival_note` | Textfeld |
| `visit_preparation` | `ai_visit_preparation` | Textfeld |
| `pricing_mode` | `ai_pricing_mode` | Auswahl, DB-Constraint |
| `pricing_amount` / `pricing_unit` / `pricing_validity` | `ai_pricing_amount` / `_unit` / `_validity` | Zeilen, nur bei Preisart sichtbar |

**Das Preisfeld (Entscheid F4).** Vier typisierte Teile statt eines Freitextfelds; der Builder formuliert den Satz („Richtwert: ab CHF 120 pro Stunde. (Stand 2026)") und hängt einen Baustein an, den kein Kundenfeld erreicht: „Preise sind Richtwerte und keine verbindliche Zusage." Dazu eine neue Zeile in den `VERBINDLICHE SICHERHEITSREGELN`. Der Abschnitt `## PREISAUSKUNFT` steht **immer** im Prompt, auch leer — dann mit der Anweisung, keine Beträge zu nennen und eine Offerte anzubieten. Vorher gab es zur Preisfrage gar keine Regel, das Modell entschied selbst.

**Gegen den ursprünglichen Entwurf abgewichen:** Vier Spalten statt einem `jsonb`. Ein zusammengesetzter Feldtyp hätte in beiden Oberflächen einen neuen Renderer gebraucht, ohne die Angabe besser zu speichern.

**Die Rechtsfrage bleibt offen und ist nicht durch diese Umsetzung beantwortet.** Das Feld ist technisch da und die Voreinstellung ist „keine Preise nennen". Ob eine so gesprochene Angabe unter OR als Antrag gilt, gehört zur juristischen Prüfung, an der auch der Launch-Blocker „Haftung/Versicherung" hängt.

**Die Adresse (G7) wird vorgeschlagen, nicht übernommen.** `street`/`zip`/`city` sind bei allen vier Kunden gefüllt — sie stammen aber aus Offerte und Vertrag (`offer-street`, `ow-street`) und sind damit die Rechnungsadresse. Sie ungefragt als Betriebsadresse zu sprechen wäre derselbe Fehler wie der unbestätigte Default in `sprechstunden_modus`, den J4 zurücknehmen musste. Die Oberfläche bietet sie mit einem Knopf an; gespeichert wird nur, was der Kunde abschickt.

**Eine Doppelung aufgelöst.** `ai_short_description` hatte zwei Schreiber: das eigene Wizard-Feld („Kurzbeschreibung" im Website-Schritt) und ab J6 Schicht A. Welcher gewinnt, hing an der Reihenfolge im Patch-Objekt. Das alte Feld ist entfallen. Ausserdem klebte `websiteBusinessDescription()` die Zielgruppen als Zeile „Zielgruppen: …" in die Unternehmensbeschreibung (Abschnitt 3.1) — sie gehen jetzt in ihr eigenes Feld.

**Neuer Befund, im Zuge von J6 gefunden und behoben: J5 war in der Kundenoberfläche wirkungslos.** `buildBranchSections()` in `customer-assistant-profile.js` liess den Feldtyp `hours` nicht durch — die Typenliste kannte nur `radio`, `text` und `textarea`, alles andere wurde auf `text` heruntergestuft. Die Geschäftsprofil-Seite zeigte deshalb statt des Wochenrasters ein leeres Textfeld, dessen Inhalt der Schreibpfad anschliessend als ungültiges Raster abgewiesen hätte; ein gespeichertes Raster wäre als `[object Object]` erschienen. Sichtbar wurde das nicht, weil kein Kunde bestätigte Zeiten hat und die Prüfskripte den Endpoint nie mit einem Wochenraster-Feld aufgerufen haben. Der Test dazu ruft jetzt `buildBranchSections()` selbst auf statt den Quelltext zu lesen.

**Bedingte Felder.** Der Buchungslink wird nur noch gefragt, wenn überhaupt Termine vergeben werden; Betrag und Einheit nur bei gewählter Preisart. Die Bedingung (`show_if`) ist bewusst schmal — ein Schlüssel und eine Werteliste, sonst nichts — und entscheidet ausschliesslich über die Darstellung. Ein ausgeblendetes Feld behält seinen gespeicherten Wert; der Builder unterdrückt den Buchungslink zusätzlich bei Terminbefugnis „none", damit eine alte Antwort nicht durch die Hintertür weiterwirkt.

**Staging-Lauf (09.08.).** Staging trug die J4/J5-Änderungen nicht mehr (`ai_appointment_mode` und `ai_opening_hours` fehlten, `core_field_steps` war leer). Der Ausgangszustand wurde erst hergestellt, dann J6 angewendet: 4 Schritte, 14 Felder, kein Feld ausserhalb der Spalten-Allowlist, Struktur deckungsgleich mit der Migrationsdatei. Verhaltensprobe an einer Wegwerfzeile: gültige Preisangabe angenommen, `ai_pricing_mode = 'verhandelbar'` von der Constraint abgewiesen, die übrigen Spalten nehmen Text; die Probezeile wurde wieder gelöscht.

### 11.15 Was nach J6 unbewiesen bleibt

- Alles aus 11.13 gilt weiter, soweit es nicht ausdrücklich erledigt ist.
- **Der Preisbaustein ist nicht juristisch geprüft.** Das ist keine technische Lücke, sondern eine bewusst offene Frage.
- **Die neuen Felder sind nicht im Browser bedient.** Vier Unterabschnitte in einer Karte, drei davon neu — wie das auf einem Telefon wirkt, ist ungesehen.
- **Der Adressvorschlag ist an keinem echten Klick geprüft.** Dass er das Feld füllt und nichts speichert, ist an der Verdrahtung belegt.
- **`sprechstunden_zeiten` bleibt liegen.** Die Spalte existiert (jsonb, überall `null`, an genau einer Stelle im Admin gelesen) und ist damit ein viertes Zuhause für Öffnungszeiten neben `ai_opening_hours`, `ai_location_hours` und `calendar_settings.business_hours`. Gehört zu G9.
- **`ai_business_description` und `ai_short_description` bleiben zwei Felder mit derselben Quelle.** Die Website-Analyse schreibt denselben Text in beide. Der Builder fängt das ab (er stellt den Absatz nicht zweimal untereinander), die Frage, ob es beide Felder braucht, gehört zu J7.
