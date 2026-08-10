# Produktpunkt — Branchenvorlage für Detailhandel/Logistik nachbauen

**Datum:** 10.08.2026 · **Entschieden von Umut am 10.08.2026**
**Art:** Produktarbeit (Datenbank + Prompt), **kein Website-Text**
**Status:** vorgemerkt, **nicht begonnen**

---

## Warum dieser Punkt existiert

Die Website bewirbt acht Zielgruppen. Sieben davon haben im Produkt eine echte
Branchenvorlage, aus der der Assistent seine branchentypischen Anliegen, Rückfragen und
Formulierungen zieht. **Detailhandel/Logistik hat keine.** Ein Kunde aus dieser Branche
landet heute auf `generic` — er bekommt also die allgemeine Vorlage, während die Website ihm
eine auf seine Branche zugeschnittene Lösung verspricht.

Entscheidung: Die Vorlage wird nachgebaut, damit die beworbene Branche auch wirklich bedient
wird. Damit fällt gleichzeitig die Ausweich-Formulierung auf der Branchenseite weg — die
Seite `/branchen/detailhandel-logistik/` kann dann dasselbe versprechen wie die anderen
sieben.

**Abgrenzung:** Dieser Punkt ist bewusst getrennt vom Website-Relaunch. Er berührt keine
Website-Datei. Er kann unabhängig vom Relaunch umgesetzt werden — er muss nur *vor* dem
Go-Live der Branchenseite fertig sein, sonst verspricht die Seite erneut etwas, das das
Produkt nicht hält.

---

## Eine Entscheidung vorab: eine Vorlage oder zwei?

Detailhandel und Logistik sind als Zielgruppe zusammengefasst, aber die Anrufe überschneiden
sich kaum:

| | typische Anrufe |
|---|---|
| **Detailhandel** | Ist Artikel X vorrätig? · Zurücklegen/reservieren · Bestellstatus · Umtausch und Garantie · Öffnungszeiten · Lieferung nach Hause |
| **Logistik** | Wo ist meine Sendung? · Abholung beauftragen · Liefertermin verschieben · Transportschaden melden · Offerte für einen Transport |

Eine gemeinsame Vorlage müsste beides abdecken und würde dadurch so allgemein, dass sie sich
kaum noch von `generic` unterscheidet — womit der Punkt sein Ziel verfehlt.

**Empfehlung: zwei Vorlagen** — `detailhandel` und `logistik`. Der Mehraufwand gegenüber
einer ist klein (die Struktur ist dieselbe, nur die Texte unterscheiden sich), der
Qualitätsgewinn deutlich. Die Website-Branchenseite bleibt eine Seite und deckt beide ab.

**Falls nur eine gebaut wird:** dann `detailhandel` — die grössere und für ein KI-Telefon
naheliegendere Zielgruppe. Die Branchenseite müsste dann konsequenterweise nur Detailhandel
bewerben und Logistik streichen, statt es weiter zu versprechen.

*Diese Entscheidung ist offen und gehört an den Anfang der Umsetzung.*

---

## Was genau gebaut werden muss

Verifiziert gegen die Produktionsdatenbank am 10.08.2026 (Projekt `ulcofbgrovgcvowdjrge`).
Die Tabelle ist `public.industry_templates` und enthält aktuell **19 Zeilen** — `generic` als
Rückfall plus **18 echte Branchenvorlagen**, alle `active = true`.

### Zu befüllende Spalten

| Spalte | Typ | Umfang im Bestand | Inhalt |
|---|---|---|---|
| `id` | text, PK | — | `detailhandel` (bzw. `logistik`) |
| `name` | text | — | Anzeigename im Branchen-Auswahlfeld, z. B. „Detailhandel / Ladengeschäft" |
| `sort_order` | int | Zehnerschritte, aktuell bis 170 | 180 / 190 anhängen |
| `active` | bool | alle `true` | `true` |
| `default_business_description` | text | 272–424 Zeichen | Was der Betrieb macht |
| `default_services` | text | 211–348 | Leistungen, die am Telefon vorkommen |
| `default_location_hours` | text | 161–326 | Standort- und Öffnungszeiten-Gerüst |
| `default_booking_faq` | text | 209–575 | **Nur echte Regeln und Auskünfte** — siehe Warnung unten |
| `default_fallback_escalation` | text | 241–374 | Wann an einen Menschen übergeben wird |
| `default_response_constraints` | text | 164–379 | Was der Assistent nicht sagen oder zusagen darf |
| `default_required_information` | text | 63–223 | Aufnahme-Checkliste, eine Angabe pro Zeile |
| `prompt_block` | text | 778–1968 | Der eigentliche Branchenblock im Prompt |
| `extra_steps` | jsonb | 0–2 Einträge | Zusätzliche Wizard-Felder, nur falls nötig |
| `required_fields` | jsonb | — | analog zum Bestand |

### Zwei Fallen, die im Bestand schon einmal zugeschlagen haben

**1. Aufnahme-Checkliste gehört *nicht* in `default_booking_faq`.**
Genau diese Doppelung war der Befund J8/G6, der mit der Migration
`2026-08-09_required_information_single_source.sql` in **allen 19 Vorlagen** bereinigt wurde.
Die Checkliste steht ausschliesslich in `default_required_information`, formuliert als Liste
von Angaben (eine pro Zeile), nicht als Satz „… aufnehmen: …". In `default_booking_faq`
bleiben nur echte Terminregeln und Auskünfte am Telefon.

**2. Keine Terminbefugnis im Vorlagentext.**
Sätze wie „Bestätigung per Rückruf durch das Team" gehören nicht in die Vorlage. Die
Terminbefugnis ist seit J4 eine typisierte Kundenspalte (`ai_appointment_mode`) und wird als
eigener Abschnitt gerendert. Ein Vorlagensatz daneben kann der Einstellung des Kunden
**widersprechen** — deshalb wurden solche Sätze bei `facharzt`, `garage` und `generic`
ausdrücklich entfernt.

### Was die neue Zeile sonst noch berührt

- **Prompt-Fingerprint** (`admin-panel/netlify/functions/_lib/prompt-fingerprint.js:92`) liest
  `prompt_block`, `extra_steps` und `default_required_information` — eine neue Vorlage ändert
  den Fingerprint für Kunden, die sie wählen. Erwartet und unkritisch, aber beim Testen
  einplanen.
- **ElevenLabs-Sync** (`admin-panel/netlify/functions/_lib/elevenlabs-sync.js:71`) liest die
  Tabelle beim Prompt-Aufbau.
- **Branchen-Auswahlfeld** im Admin-Portal (`admin-panel/index.html:7040`) und im
  Kunden-Dashboard (`customer-dashboard/netlify/functions/customer-assistant-profile.js:639`)
  laden die Liste dynamisch — kein Code-Eingriff nötig, die neue Zeile erscheint von selbst.
- **`service-faq.js`** ist laut Kommentar „an den 19 echten Vorlagentexten kalibriert"
  (`customer-dashboard/netlify/functions/_lib/service-faq.js:16`). Bei 20 oder 21 Vorlagen
  ist zu prüfen, ob diese Kalibrierung noch trägt oder nachgezogen werden muss. **Das ist der
  einzige Punkt, der über reines Datenanlegen hinausgehen könnte.**

---

## Umsetzungsweg

1. Entscheiden: eine Vorlage oder zwei (siehe oben).
2. Texte schreiben — am besten an einer inhaltlich nahen Bestandsvorlage orientiert
   (`reinigung` für Offerten-Logik, `garage` für Auftrags-/Statusanfragen).
3. Migration nach dem Muster der bestehenden Migrationen anlegen, mit Selbstkontrolle am Ende
   (die J8-Migration ist die Vorlage dafür: sie bricht ab, statt einen halben Zustand zu
   hinterlassen).
4. Erst gegen **Staging** (`hzqiyyqfchvfcmmbemvd`) fahren, nicht direkt gegen Produktion.
5. Prompt-Vorschau im Admin-Portal prüfen: erscheinen alle Abschnitte, steht die Checkliste
   genau einmal, widerspricht nichts der Terminbefugnis?
6. Testanruf mit einem Testkunden auf der neuen Vorlage.
7. `service-faq.js`-Kalibrierung prüfen.

## Abnahmekriterien

- [ ] Neue Zeile(n) in `industry_templates`, alle Textspalten befüllt, `active = true`
- [ ] Aufnahme-Checkliste steht **nur** in `default_required_information`
- [ ] Kein Terminbefugnis-Satz im Vorlagentext
- [ ] Vorlage erscheint im Branchen-Auswahlfeld von Admin-Portal und Kunden-Dashboard
- [ ] Prompt-Vorschau vollständig und widerspruchsfrei
- [ ] Testanruf durchgeführt, branchentypisches Anliegen korrekt aufgenommen
- [ ] `service-faq.js`-Kalibrierung geprüft
- [ ] Erst danach: Branchenseite `/branchen/detailhandel-logistik/` darf live gehen

## Aufwand

**Eine Vorlage: rund 0.5 Arbeitstage. Zwei: rund 1 Arbeitstag.** Der Grossteil ist
Textarbeit, nicht Technik — die Struktur steht, die Migration ist Routine. Was den Aufwand
nach oben treiben kann, ist einzig die `service-faq.js`-Kalibrierung, falls sie tatsächlich
nachgezogen werden muss; das ist vorher nicht sicher einschätzbar.

---

## Nebenbefund beim Prüfen der Tabelle

Die Vorlage `digitalmarketing` trägt den Anzeigenamen **„Digitalmarketing / ls"**. Das
„/ ls" ergibt keinen Sinn und sieht nach einem abgeschnittenen oder verrutschten Wert aus.
Der Name steht im Branchen-Auswahlfeld und ist damit **kundensichtbar**. Kleiner, unabhängiger
Fix — hier nur vermerkt, weil er beim Nachschauen aufgefallen ist, nicht Teil dieses Punkts.
