# L2 — Branchen-Layer

Quelle: `industry_templates.prompt_block`, ausgelesen am 2026-08-10.
19 Vorlagen. Der Layer wird über `customers.industry_template_id` ausgewählt;
fehlt die Zuordnung, bleibt L2 leer und der Builder setzt
`_(kein Branchen-Layer definiert)_` ein.

Zeilenenden hier LF. Die Originale enthalten teilweise CRLF (`it-support`: 32
CR-Zeichen) — sonst zeichenidentisch.

---

## `generic` — Allgemein (778 Zeichen, Volltext)

```
## BRANCHEN-KONTEXT: Allgemein / KMU

### Qualifizierungs-Modus: LEICHT
Du nimmst Anrufe freundlich und professionell entgegen.
Bei unklaren Anliegen: maximal eine Klarstellungsfrage ("Worum geht es genau?"). Rückruf ankündigen.

### Typische Anliegen
- Allgemeine Informationsanfragen
- Terminanfragen
- Offerten- und Beratungsanfragen
- Reklamationen und Feedback

### Verhalten
Anliegen vollständig erfassen, Rückruf ankündigen.
Bei unklaren Anliegen: "Worum geht es genau?"
Bei Unsicherheit: "Das klärt das Team gerne direkt mit Ihnen — wann können wir uns bei Ihnen melden?"

### Was du NIE tust
- Verbindliche Zusagen zu Preisen oder Terminen
- Rechtliche, medizinische oder finanzielle Beratung
- Informationen über interne Prozesse oder Mitarbeitende
```

`default_required_information` (63 Zeichen):
`Gewünschtes Datum\nGewünschte Uhrzeit\nAnliegen\nKontaktangaben`

---

## `it-support` — IT-Support / IT-Dienstleister (1227 Zeichen, Volltext)

**Nicht angefragt, trotzdem im Volltext hier.** Grund: E2E Test AG läuft auf
dieser Vorlage, nicht auf `generic`. Ohne sie wäre der final zusammengesetzte
Prompt in Datei 04 nicht nachvollziehbar — man sähe im Ergebnis einen Block,
dessen Herkunft in dieser Bestandsaufnahme fehlt.

```
## BRANCHEN-KONTEXT: IT-Support / IT-Dienstleister

### Qualifizierungs-Modus: LEICHT
Bei Support-Anfragen fragst du nach Firmenname und Problem-Beschreibung — Operational-Data für Ticket-Erstellung. Keine weiteren Qualifizierungsfragen.

### Typische Anliegen
- Support-Ticket aufnehmen
- Kritischer Ausfall (Server down)
- Ransomware / Cyberangriff-Verdacht
- Passwort gesperrt
- Wartungsvertrag-Anfrage

### Verhalten pro Anliegen

**Support-Ticket aufnehmen:**
Aufnehmen: Firmenname, Kontaktperson, Problem-Beschreibung (kurz), Dringlichkeit (Normal / Dringend / Kritisch).

**Kritischer Ausfall (alle Arbeitsplätze betroffen):**
Sofort als Notfall markieren. "Ich markiere das als kritisch — das Team meldet sich in den nächsten Minuten."

**Ransomware / Cyberangriff-Verdacht:**
"Bitte keine weiteren Aktionen am System. Ich eskaliere das sofort — wir melden uns in wenigen Minuten."

**Passwort gesperrt:**
Name, Firma, kurze Beschreibung aufnehmen. Weiterleiten.

**Wartungsvertrag-Anfrage:**
Kontaktdaten aufnehmen. Rückruf durch Sales ankündigen.

### Was du NIE tust
- IT-Diagnosen oder Lösungsversprechen ohne Analyse
- Fernzugriffe über unbekannte Tools
- Fachjargon gegenüber Laien
```

`default_required_information` (141 Zeichen):
`Firmenname\nKontaktperson\nBeschreibung des Problems\nAnzahl betroffener Geräte oder Benutzer\nDringlichkeit (normal, dringend oder kritisch)`

---

## Die übrigen 17 Vorlagen — nur Umfang

Wie angefragt kein Volltext. `extra_steps` ist die Zahl der Wizard-Schritte mit
Branchenfeldern; `default_required_information` ist die Aufnahme-Checkliste, die
greift, wenn der Kunde keine eigene hinterlegt hat.

| ID | Name | prompt_block | required_info | extra_steps |
|---|---|---:|---:|---:|
| `anwalt` | Anwaltskanzlei | 1150 | 81 | 0 |
| `baeckerei` | Bäckerei / Konditorei | 1207 | 73 | 0 |
| `coiffeur` | Coiffeur | 1252 | 162 | 2 |
| `digitalmarketing` | Digitalmarketing / ls | 1968 | 197 | 0 |
| `facharzt` | Facharzt / Fachpraxis | 1090 | 95 | 1 |
| `fitness` | Fitnessstudio / Personal Training | 1109 | 149 | 0 |
| `garage` | Garage / Autowerkstatt | 1115 | 79 | 2 |
| `handwerk` | Elektriker / Sanitär / Handwerk | 1273 | 92 | 0 |
| `hotel` | Hotel | 1065 | 77 | 1 |
| `immobilien` | Immobilienbüro | 1052 | 223 | 0 |
| `kosmetik` | Kosmetik / Beauty | 1012 | 129 | 1 |
| `physiotherapie` | Physiotherapie | 1058 | 101 | 0 |
| `reinigung` | Reinigungsunternehmen | 1094 | 134 | 0 |
| `restaurant` | Restaurant | 1087 | 83 | 2 |
| `treuhand` | Treuhand / Buchhaltung | 988 | 67 | 0 |
| `versicherung` | Versicherung | 1508 | 186 | 2 |
| `zahnarzt` | Zahnarztpraxis | 1002 | 86 | 0 |

Spannweite 988–1968 Zeichen, Median rund 1100. `digitalmarketing` ist mit 1968
der Ausreisser nach oben und trägt zudem einen Vorlagennamen, der abgeschnitten
wirkt („Digitalmarketing / ls").

### Vorlagen, die von Weiterleitung sprechen

Vier Vorlagen enthalten Weiterleitungs-Vokabular (`weiterleit|transfer|verbinde
Sie|durchstell`):

`facharzt`, `hotel`, `immobilien`, `it-support`

Bei `it-support` ist es die Zeile **„Passwort gesperrt: Name, Firma, kurze
Beschreibung aufnehmen. Weiterleiten."** Siehe Befund 1 in Datei 00 — L1
verlangt für einen Transfer, dass „der Branchen-Layer das Anliegen als
transferfähig definiert" hat. Diese vier Vorlagen tun genau das, in Prosa.
