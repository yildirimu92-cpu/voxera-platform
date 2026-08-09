# E-Mail-Vorlagen: Neubau im aktuellen Design-System — Konzept + Referenz

**Stand:** 09.08.2026 · **Status:** freigegeben (E1–E4 entschieden), **alle zwölf Vorlagen gebaut**, Wächter läuft in der CI
**Quelle der Inventarisierung:** Make-Blueprint Szenario 09 (ID 5239089, `lastEdit` 2026-08-09T17:16Z) und Szenario 01 (ID 5109958), beide über `scenarios_get` gezogen und vollständig ausgewertet.

---

## 0. Was in diesem Dokument steht

1. [Inventar](#1-inventar) — was tatsächlich in Make liegt, in welcher Design-Generation, mit welchen Feldern
2. [Fünf Befunde](#2-fünf-befunde) — beide beauftragten Bugfixes (einer anders als vermutet) und drei ungefragte Funde
3. [Empfehlung Make vs. Repo](#3-empfehlung-make-oder-repo)
4. [Das Grundgerüst](#4-das-grundgerüst) — ein Kopf, ein Fuss, sieben Bausteine
5. [Technische Regeln für E-Mail-HTML](#5-technische-regeln)
6. [Referenz-Vorlage](#6-referenz-vorlage-offer_email) und wie sie zu prüfen ist
7. [Stand nach der Freigabe](#7-stand-nach-der-freigabe)

---

## 1. Inventar

Szenario 09 hat **13 Routen** am Router mit **13 E-Mail-Modulen**. Zwei davon (Modul 54 und 55) tragen
denselben HTML-Code (14 098 Zeichen, zeichengleich) — das ist der Grund, warum umgangssprachlich von
„14 Vorlagen“ die Rede war. Effektiv sind es **zwölf gestalterisch eigenständige Vorlagen** plus eine
interne Alarm-Mail.

| # | Route (Make-Filtername) | Modul | `mail_type` | Grösse | Generation | Genutzte Payload-Felder |
|---|---|---|---|---|---|---|
| 0 | `offer_email` | 10 | `offer_email` | 11 354 | **C** | `recipient.name`, `customer.company_name`, `offer.plan`, `.billing_cycle`, `.duration_months`, `.valid_until`, `.setup_fee`, `.monthly_price`, `.yearly_price`, `.discount_amount`, `.introduction`, `.acceptance_url`, `.avv_pdf_url` |
| 1 | `Swiss QR Billing` | 21 | `invoice_email`, `reminder_email`, `reminder_final_email` | 4 326 | **C** | `recipient.name`, `email.subject`, `email.body_text`, `invoice.invoice_number`, `.amount`, `.currency`, `.due_at`, `mail_type`, `attachments[1]` |
| 2 | `contract_expired_email` | 18 | `contract_expired_email` | 7 898 | **C** | `recipient_name`, `customer.customer_name`, `customer.plan_label`, `contract_end_date`, `assistant_name` |
| 3 | `password_changed_email` | 40 | `password_changed_email` | 7 892 | **B** | `recipient.email`, `dashboard_url` |
| 4 | `assistant_updated_email` | 41 | `assistant_updated_email` | 4 602 | **A** | `assistant.business_description`, `.instructions`, `.sync_status`, `dashboard_url` |
| 5 | `welcome_email` | 50 | `welcome` | 9 988 | **C** | `customer_name`, `email`, `activation_link`, `dashboard_url`, `voxera_number` |
| 6 | `password_reset_email` | 51 | `password_reset` | 7 860 | **B** | `recipient.email`, `activation_link` |
| 7 | `ai_change_request` | 52 | `ai_change_request` | 1 760 | **D** | `customer_name`, `customer_id`, `message`, `admin_url` |
| 8 | `contract_signed_with_pdf` | 54 | `contract_signed_email` (mit PDF) | 14 098 | **C** | `recipient.name`, `contract.customer_name`, `.plan`, `.start_date`, `.duration_months`, `.countersigned_at`, `.signed_page_url`, `.signed_pdf_url`, `.filename` |
| 9 | `countersign_email_fallback` | 55 | `contract_signed_email` (ohne PDF), `countersign_email` | 14 098 | **C** | identisch zu #8 |
| 10 | `Fallback – unbekannter mail_type` | 99 | — (Negativ-Filter) | 366 | **—** | `mail_type`, `recipient.email` |
| 11 | `Callback TRUE` | 101 | `callback_request_email` | 10 058 | **E** | `caller_name`, `caller_phone`, `call_summary`, `category`, `lead_quality`, `duration_seconds`, `callback_requested` |
| 12 | `Normal Call` | 100 | `call_notification_email` | 9 537 | **E** | identisch zu #11 |

### Die fünf Design-Generationen

| Gen. | Vorlagen | Merkmale |
|---|---|---|
| **C** — jüngste, beste | 0, 1, 2, 5, 8, 9 | Reines Tabellen-Layout, durchgehend Inline-Styles, kein `<style>`-Block, Night-Navy-Kopf `#0D1F3C`, Gold-Eyebrow `#E8C547`, Karte 600 px / Radius 16 px, Logo als gehostetes PNG. **Das ist die Basis für den Neubau** — der Neubau ist eine Verschärfung von C, keine Erfindung. |
| **B** | 3, 6 | `<style>`-Block im `<head>`, Sicherheits-Kopf in Grün `#ECFDF5`, Tabellen-Layout im Body. |
| **A** | 4 | `<style>`-Block, **Flexbox**, Kopf in Blau `#1A56DB`, Violett-Akzente `#7C3AED`/`#A78BFA` — Farben, die im Produkt gar nicht existieren. |
| **D** | 7 | Rumpf-Vorlage, 1 760 Zeichen, keine Kopf-/Fuss-Zone, interne Admin-Mail. |
| **E** | 11, 12 | `<style>`-Block mit ~70 Klassen, **Flexbox und CSS-Grid** (`display:grid` für die zweispaltigen Zeilen — fällt in Outlook komplett zusammen), `::after`-Pseudoelemente für Deko-Kreise, Kopf in Rot `#DC2626` bzw. Blau `#1A6FE8`, Karte 580 px statt 600 px, Inline-SVG-Logo statt PNG. |

### Die Abweichungen untereinander, gezählt

- **Kopffarben:** fünf verschiedene (`#0D1F3C`, `#ECFDF5`, `#1A56DB`, `#DC2626`, `#1A6FE8`) — nur die erste ist eine Voxera-Farbe.
- **Kartenbreite:** 600 px (Gen. C, B) gegen 580 px (Gen. E).
- **Kartenradius:** 16 px, 20 px, keiner.
- **Seitenhintergrund:** `#F1F5F9` (Gen. C) gegen `#F0F2F7` (Gen. E) gegen `#F5F5F7` (Gen. A) — drei Grautöne, keiner davon der Produkt-Canvas `#F7F8FA`.
- **Logo:** gehostetes PNG (Gen. C) gegen Inline-SVG (Gen. E) gegen Text ohne Zeichen (Gen. A, D).
- **Fusszeile:** vier Varianten, eine Vorlage (7) hat gar keine.
- **Gesamtzahl unterschiedlicher Hex-Werte über alle Vorlagen:** 61. Das Produkt-Tokenset kennt für dieselbe Aufgabe rund 25.
- **Violett** (`#7C3AED`, `#A78BFA`, `#5B21B6`, `#EDE9FE`, `#F5F3FF`, `#DDD6FE`, `#E9D5FF`) kommt ausschliesslich in Vorlage 4 vor und hat im Produkt-Farbsystem keine Entsprechung — das ist die deutlichste Einzeldrift im Bestand.

---

## 2. Fünf Befunde

### Befund 1 — `lead_quality`-Gross-/Kleinschreibung: **bestätigt, wie beschrieben**

Beide Anruf-Vorlagen (Module 100 und 101) enthalten zweimal:

```
{{if(1.lead_quality = "Hot"; "#FEE2E2"; if(1.lead_quality = "Warm"; "#FEF3C7"; "#EFF6FF"))}}
{{if(1.lead_quality = "Hot"; "#991B1B"; if(1.lead_quality = "Warm"; "#92400E"; "#1D4ED8"))}}
```

Geschrieben wird der Wert klein. Nachgewiesen an zwei Stellen im Repo:

- `admin-panel/netlify/functions/elevenlabs-provision-agent.js:110` — die Feldbeschreibung, mit der der
  Assistent das Feld füllt, gibt `hot` / `warm` / `cold` klein vor.
- `customer-dashboard/netlify/functions/elevenlabs-post-call.js:521` und `:1053` — der Produktcode
  vergleicht selbst über `String(...).toLowerCase() === 'hot'`, verlässt sich also ebenfalls auf klein.

Das Abzeichen fällt damit immer in den Standard-Zweig. **Aber das Gross-/Kleinschreibungsproblem ist nur
die halbe Miete** — die drei Farben sind ohnehin falsch:

Rot für „Heiss“ verstösst gegen die Vier-Familien-Regel (Rot = Dringlichkeit) und ist im Produkt bereits
korrigiert worden. `customer-design-tokens.css:454–470` hält die verbindliche Gold-Rampe:

| Stufe | Fläche | Schrift | Kontrast |
|---|---|---|---|
| Heiss | `#E8C547` | `#0D1F3C` | 9,78:1 |
| Warm | `#FBF1D8` | `#7A5C00` | 5,56:1 |
| Kalt | `#EEF2F7` | `#5B6472` | 5,32:1 |

Der Kommentar dort benennt genau diesen Fall: *„Heiss used to render in the danger red and therefore read
like an error message instead of the positive sales signal it is.“* Die E-Mail ist die letzte Stelle im
System, an der die alte rote Variante noch lebt.

**Behebung im Neubau** — Vergleich kleingeschrieben, Ausgabe deutsch beschriftet, Rampe aus dem Produkt:

```
Fläche  {{if(lower(1.lead_quality) = "hot"; "#E8C547"; if(lower(1.lead_quality) = "warm"; "#FBF1D8"; "#EEF2F7"))}}
Schrift {{if(lower(1.lead_quality) = "hot"; "#0D1F3C"; if(lower(1.lead_quality) = "warm"; "#7A5C00"; "#5B6472"))}}
Text    {{if(lower(1.lead_quality) = "hot"; "Heiss"; if(lower(1.lead_quality) = "warm"; "Warm"; if(lower(1.lead_quality) = "cold"; "Kalt"; "—")))}}
```

Der letzte Ausdruck behebt einen dritten, nicht beauftragten Nebenfehler: bisher wird der Rohwert
ausgegeben, der Kunde liest also wörtlich `hot` in seiner Mail — englisch, kleingeschrieben, mitten in
einem deutschen Satz. Bei leerem Feld erscheint ein leeres Abzeichen; neu steht dort ein Gedankenstrich.

---

### Befund 2 — `callback_requested`: **anders als vermutet, und der eigentliche Fund liegt daneben**

Das Briefing vermutete, `callback_requested` werde über den neuen Weg nicht mehr geliefert. Geprüft, und
die Lage ist eine andere:

**a) Das Feld wird geliefert.** `customer-dashboard/netlify/functions/elevenlabs-post-call.js:494` und
`:1032` senden `callback_requested: … === true` als echten Booleschen Wert. Der Empfänger dieses Aufrufs
ist aber `MAKE_CALL_INTAKE_WEBHOOK` — **Szenario 01, nicht Szenario 09**.

**b) `_lib/call-notification.js` existiert nicht.** Weder im Arbeitsverzeichnis noch in irgendeinem Zweig
der Historie (`git log --all --diff-filter=A` liefert nichts). Der im Briefing angenommene Pfad
`_lib/call-notification.js → Szenario 09` ist nicht der Weg, den das System geht.

**c) Die beiden Anruf-Routen in Szenario 09 sind tot.** Sie greifen auf
`mail_type = callback_request_email` bzw. `call_notification_email`. Diese beiden Werte stehen
- **nicht** in `config/mail-engine-contracts.json`, und
- **nicht** in der `MAIL_ENGINE_TYPES`-Liste in `_lib/mail-delivery.js:32–47`.

`mail-delivery.js` weist unbekannte Typen hart ab (`isMailEngineType` → „kein Versand“), bevor überhaupt
ein Request rausgeht. Es gibt im ganzen Repo keinen Aufrufer, der einen dieser beiden Typen setzt. Die
Routen 11 und 12 können also gar nicht erreicht werden.

**d) Die Anruf-Mails werden in Wahrheit von Szenario 01 selbst verschickt** — Module 6 und 14 dort tragen
zeichengleiche Kopien derselben zwei Vorlagen, inklusive desselben `lead_quality`-Fehlers. Und
**Szenario 01 ist abgeschaltet** (`isActive: false`, `isinvalid: true`, 13 Fehler bei 21 Läufen).

Zusammengefasst: es gibt zwei Kopien derselben zwei Anruf-Vorlagen an zwei Orten. Die eine Kopie kann
nicht erreicht werden, die andere liegt in einem abgeschalteten Szenario. **Derzeit geht keine
Anruf-Benachrichtigung raus.**

**Was das für die Betreffzeile heisst.** Der Ausdruck
`if(1.callback_requested = true; "Rückruf angefordert – Voxera"; "Neuer Anruf – Voxera")` ist in
Szenario 09 in jedem Fall falsch — und zwar unabhängig davon, ob das Feld ankommt: Route 11 *ist* bereits
die Rückruf-Route, ausgewählt über `mail_type`. Ein zweiter Test auf dasselbe Faktum kann nur schaden,
und tut es auch: fehlt das Feld, trägt die Rückruf-Mail den Betreff „Neuer Anruf“. Im Neubau steht in
jeder der beiden Vorlagen ein **fester** Betreff, ohne Bedingung. Das ist genau die im Briefing
vorgeschlagene Umstellung „über `mail_type` statt über ein Bool-Feld“ — nur dass sie sich dadurch
umsetzt, dass die Bedingung ersatzlos verschwindet.

**Was ich nicht entscheide.** Welcher der beiden Wege für Anruf-Mails künftig gelten soll — Szenario 01
wiederbeleben, oder Szenario 09 die beiden Typen zuführen (dann müssten `mail-engine-contracts.json`,
die Liste in `mail-delivery.js` und ein Aufrufer ergänzt werden) — ist eine Routing-Entscheidung und
ausdrücklich nicht Teil dieses Auftrags. Ich baue die zwei Vorlagen so, dass sie an **beiden** Orten
funktionieren: sie verwenden ausschliesslich Felder, die in beiden Payloads gleich heissen
(`caller_name`, `caller_phone`, `call_summary`, `category`, `lead_quality`, `duration_seconds`).

> **Entscheidung nötig (E1):** Soll ich die zwei Anruf-Vorlagen überhaupt mitliefern, und wenn ja — für
> Szenario 09, für Szenario 01, oder für beide (identischer Code, zweimal eingefügt)?

---

### Befund 3 — Zeilenumbrüche in der Rechnungs-Mail (nicht beauftragt, gefunden)

`admin-panel/netlify/functions/_lib/invoice-mail-copy.js` baut `body_text` mit `\n\n` zwischen den
Absätzen — vier bis fünf Absätze pro Mahnung. Vorlage 1 gibt das Feld so aus:

```html
<div style="…white-space:pre-line;">{{1.email.body_text}}</div>
```

`white-space:pre-line` trägt in Apple Mail, Gmail und Thunderbird. Die Word-Engine hinter Outlook
2016–2021 (Windows) wertet `white-space` nicht aus — dort läuft die gesamte Mahnung zu einem einzigen
Absatzblock zusammen. Im Neubau ersetze ich das durch die serverseitige Umwandlung, die in jedem Client
gleich aussieht:

```
{{replace(1.email.body_text; newline; "<br><br>")}}
```

Kein Eingriff in den Versand-Code — nur in der Vorlage.

---

### Befund 4 — Doppelte Anrede in der Rechnungs-Mail (nicht beauftragt, gefunden)

`invoice-mail-copy.js` beginnt `body_text` mit `recipientGreeting(customer)` — also bereits mit
„Guten Tag Marc Schneider“. Die Vorlage stellte dem eine eigene Zeile „Guten Tag, {{1.recipient.name}}“
voran. Jede Rechnung und jede Mahnung grüsst den Empfänger damit zweimal hintereinander.

Behoben ohne Eingriff in den Versand-Code: die Vorlage hat keine eigene Anrede mehr, `body_text` trägt
sie. Das gilt nur für diese eine Vorlage — alle anderen bekommen keinen fertigen Fliesstext geliefert
und behalten ihre Anrede.

---

### Befund 5 — Kategorie als Rohwert in der Anruf-Mail (nicht beauftragt, gefunden)

Die Anruf-Vorlagen geben `{{1.category}}` unverändert aus. Das Feld trägt den Enum-Wert, den der
Assistent setzt (`elevenlabs-provision-agent.js:105`): der Kunde liest also `rueckrufanfrage` oder
`aenderung_kuendigung` in seiner E-Mail. Derselbe Fehlertyp wie beim Rohwert `hot` im Lead-Abzeichen.

Behoben mit der Zuordnung, die im Produkt bereits existiert — `CATEGORY_LABELS` in
`customer-dashboard/index.html:13217`, dieselben acht Werte wie im Assistenten-Enum. Nicht erfunden,
übernommen, samt Rückfall auf den Rohwert bei einem unbekannten Wert (`CATEGORY_LABELS[raw] || raw`).

---

## 3. Empfehlung: Make oder Repo

**Empfehlung: Variante 1,5 — Vorlagen im Repo als Quelle der Wahrheit, Versand weiterhin über Make.
Nicht Variante 2 (jetzt).**

Die Begründung im Detail, damit die Empfehlung nachprüfbar ist statt nur behauptet:

**Warum nicht Variante 2 (Rendern im Repo, Make nur Versandweg).** Sie ist technisch die sauberste, aber
sie ist in diesem Auftrag nicht erreichbar: damit der Repo-Code das fertige HTML liefern kann, müsste
`_lib/mail-delivery.js` ein `html`-Feld mitschicken und die dreizehn Make-Routen müssten von „eigene
Vorlage“ auf „durchreichen“ umgestellt werden. Beides steht ausdrücklich unter „Nicht Teil dieses
Auftrags“. Eine Empfehlung, die als Erstes den Auftragsrahmen sprengt, ist keine.

Dazu kommt ein Punkt, der auch bei mehr Spielraum gegen sofortiges Umstellen spräche: der Versandweg ist
in diesem System bereits einmal teuer schiefgegangen. Der Kommentarkopf von `mail-delivery.js` erzählt
es — fünf unabhängige Versandimplementierungen, ein Erfolgs-Toast, der auch bei nicht versandter Mail
erschien, und eine Fehlkonfiguration, bei der `MAKE_MAIL_WEBHOOK` auf den Hook eines abgeschalteten
Szenarios zeigte und Make jeden Request mit HTTP 200 in eine Warteschlange legte, die niemand leerte.
Diesen Pfad anzufassen, während gleichzeitig zwölf Vorlagen neu gebaut werden, vermischt zwei Risiken,
die man getrennt halten will: „sieht die Mail richtig aus“ und „kommt die Mail an“.

**Warum nicht die reine Variante 1 (alles bleibt in Make).** Der Bestand ist genau das, was ohne
Versionierung entsteht: fünf Generationen, 61 Farbwerte, zwei zeichengleiche Kopien in verschiedenen
Szenarien, und ein Fehler (`lead_quality`), der zweimal unabhängig gepflegt werden müsste. Neu bauen und
wieder ohne Netz ablegen heisst, in zwölf Monaten dasselbe Briefing nochmal zu schreiben.

**Variante 1,5, konkret.** Das ist es, was mit diesem Auftrag bereits entsteht:

1. Jede Vorlage liegt als Datei unter `docs/email-templates/<mail_type>.html` — versioniert, diffbar, im
   Pull Request lesbar.
2. Zu jeder Vorlage liegt eine Vorschaudatei unter `docs/email-templates/vorschau/` mit eingesetzten
   Beispieldaten. Die lässt sich im Browser öffnen, ohne Make, ohne Testversand.
3. Der User kopiert den Inhalt der Datei in die zugehörige Make-Route. Die Zuordnung Datei → Route steht
   in `docs/email-templates/README.md`, mit Modul-ID.
4. Ein Wächter (`scripts/verify-mail-templates.mjs`, **gebaut und in der CI**, Workflow
   `.github/workflows/verify-mail-templates.yml`) prüft bei jedem PR die Regeln aus Abschnitt 5 gegen
   die Repo-Dateien: kein
   `display:flex`, kein `display:grid`, kein `<style>`-Block ausser dem erlaubten Media-Query-Block,
   `max-width:600px` vorhanden, keine Hex-Werte ausserhalb der Palette, `lead_quality` nur
   kleingeschrieben verglichen. So wandert kein bekannter Fehler ein zweites Mal ein.

Was Variante 1,5 **nicht** kann und was man wissen muss, bevor man sie wählt: sie garantiert nicht, dass
Repo und Make übereinstimmen. Wer in Make direkt editiert, driftet — der Wächter merkt es nicht, weil er
den Blueprint nicht sieht. Die Gegenmassnahme ist eine Regel, kein Skript: **Änderungen an Vorlagen
laufen über das Repo, nie direkt in Make.** Sobald diese Regel einmal gebrochen wird, ist Variante 1,5
so gut wie Variante 1.

**Wann Variante 2 fällig wird.** Drei Auslöser, jeder einzeln ausreichend: (a) eine Vorlage braucht Logik,
die Make-Ausdrücke nicht können — Schleifen über Positionen, bedingte Blöcke mit mehr als zwei Zweigen;
(b) es kommt eine zweite Sprache dazu; (c) die erste Drift zwischen Repo und Make wird bemerkt. Dann
lohnt der Umbau, und er ist dann auch ein sauber abgegrenzter eigener Auftrag: Renderer im Repo,
Make-Routen auf Durchreichen, Wächter auf Snapshot-Vergleich.

---

## 4. Das Grundgerüst

Ein Gerüst, sieben Bausteine. Jede Vorlage ist danach: Kopf + Auswahl aus den Bausteinen + Fuss. Der
Unterschied zwischen zwei Vorlagen sind der Eyebrow-Text, die Eyebrow-Farbe, die Überschrift und die
Reihenfolge der Bausteine — sonst nichts.

### Aufbau

```
Seitenfläche  #F7F8FA
└─ Karte 600 px, weiss, Rand #E4E6EA, Radius 14 px
   ├─ Markenlinie   3 px Gold #E8C547, volle Breite      ← in JEDER Mail gleich
   ├─ Kopf          Night #0D1F3C
   │                 Zeile 1: Logo + „VOXERA“ links · Eyebrow rechts (Akzentfarbe)
   │                 Zeile 2: Überschrift 26 px weiss
   │                 Zeile 3: Unterzeile 15 px #A9B6CC
   ├─ Inhalt        weiss, Polsterung 28/32 px
   │                 Anrede · Fliesstext · Bausteine
   └─ Fuss          #F7F8FA, Oberkante #E4E6EA
                     © · voxera.ch · info@voxera.ch · Datenschutz · AGB · Impressum
```

Die Gold-Markenlinie ist die E-Mail-Fassung von `--vx-ui-brand-rule` (im Produkt ein Verlauf, hier
einfarbig, weil Outlook keine Verläufe kann). Sie ist **ornamental** und in jeder Mail identisch — damit
gehorcht sie der stehenden Regel aus dem Design-System („markieren, nicht füllen“; ein Gold-Element pro
Fläche, festes Aussehen).

### Die Akzentfarbe — vier erlaubte Werte, sonst keine

Das Briefing wünscht „eine Akzentfarbe“ pro Vorlage. Damit das nicht wieder in fünf Kopffarben endet,
ist der Akzent scharf begrenzt: **er färbt ausschliesslich den Eyebrow-Text im Kopf.** Der Kopf selbst
bleibt in jeder Mail Night. Die vier zulässigen Werte kommen aus den vier Farbfamilien und sind gegen
Night gemessen:

| Familie | Wert auf Night | Kontrast | Wofür |
|---|---|---|---|
| Gold — Marke/Premium | `#E8C547` | 9,78:1 | Offerte, Willkommen, Vertrag unterzeichnet |
| Grün — Abschluss | `#34D399` | 8,55:1 | Passwort geändert |
| Rot — Dringlichkeit | `#FCA5A5` | 8,66:1 | Letzte Mahnung, Vertrag abgelaufen, Rückruf angefordert |
| Neutral | `#A9B6CC` | 8,02:1 | Rechnung, Zahlungserinnerung, Passwort zurücksetzen, Assistent aktualisiert, interne Mails |

Grün und Rot erscheinen hier heller als die Produktwerte `#059669` / `#DC2626`, weil diese auf Night
unter 4,5:1 fallen. Es sind dieselben Familien, auf die dunkle Fläche aufgehellt — dieselbe Mechanik, mit
der das Produkt `--vx-action-primary-on-night` begründet.

### Zuordnung Akzent je `mail_type`

| `mail_type` | Eyebrow | Akzent |
|---|---|---|
| `offer_email` | OFFERTE | Gold |
| `welcome` | WILLKOMMEN | Gold |
| `contract_signed_email` | VERTRAG | Gold |
| `invoice_email` | RECHNUNG | Neutral |
| `reminder_email` | ZAHLUNGSERINNERUNG | Neutral |
| `reminder_final_email` | LETZTE MAHNUNG | Rot |
| `contract_expired_email` | VERTRAGSENDE | Rot |
| `password_changed_email` | SICHERHEIT | Grün |
| `password_reset` | SICHERHEIT | Neutral |
| `assistant_updated_email` | ASSISTENT | Neutral |
| `ai_change_request` (intern) | ÄNDERUNGSANFRAGE | Neutral |
| Fallback-Alarm (intern) | ALARM | Rot |
| `call_notification_email` | NEUER ANRUF | Neutral |
| `callback_request_email` | RÜCKRUF | Rot |

### Die sieben Bausteine

| # | Baustein | Zweck | Wo im Bestand |
|---|---|---|---|
| B1 | **Detail-Karte** | Beschriftung/Wert-Paare, ein- oder zweispaltig | in 8 von 12 Vorlagen, in 4 Ausführungen |
| B2 | **Hinweisbox** in vier Tonalitäten | Hinweis, Erfolg, Warnung, Gefahr | in 6 Vorlagen, in 3 Ausführungen |
| B3 | **Aktions-Knopf** | eine primäre Aktion, Night, plus sichtbarer Klartext-Link darunter | in 9 Vorlagen, in 4 Ausführungen |
| B4 | **Schritt-Liste** | nummerierte Anleitung | in 2 Vorlagen (Willkommen, Vertrag) |
| B5 | **Betrags-Tabelle** | Positionen + Summenzeile auf Night | in 1 Vorlage (Offerte) |
| B6 | **Kennzahl-Block** | eine grosse Zahl auf Night mit Gold-Beschriftung (Voxera-Nummer, Weiterleitungscode) | in 1 Vorlage (Willkommen) |
| B7 | **Lead-Abzeichen** | Heiss/Warm/Kalt in der Gold-Rampe | in 2 Vorlagen (Anruf) |

Dazu zwei Kleinteile ohne eigene Nummer: Trennlinie und Fussnote.

**Alle sieben sind gebaut und einzeln anzusehen:** `docs/email-templates/bausteine.html` — im Browser
öffnen, keine Beispieldaten nötig.

### Typo-Leiter

Abgeleitet aus `customer-design-tokens.css`, mit **einer bewussten Abweichung**: der Fliesstext steht auf
16 px statt der Produkt-Basis 15 px. Grund ist Grundsatz 15 — die Zielgruppe ist nicht digital-affin, und
E-Mail wird häufiger auf dem Telefon und häufiger von älteren Augen gelesen als das Dashboard. 16 px ist
die verbreitete Untergrenze für E-Mail-Fliesstext. Das ist die einzige Grössenabweichung; alle übrigen
Stufen sind Produktwerte.

| Rolle | Grösse/Gewicht | Farbe | Kontrast auf Weiss |
|---|---|---|---|
| Eyebrow | 11 / 700, `letter-spacing:.16em`, Versalien | Akzent | siehe oben (auf Night) |
| Kopf-Überschrift | 26 / 700 (mobil 22) | `#FFFFFF` | 16,43:1 |
| Kopf-Unterzeile | 15 / 400 | `#A9B6CC` | 8,02:1 (auf Night) |
| Anrede | 20 / 700 | `#0D1F3C` | 16,43:1 |
| Fliesstext | **16** / 400, `line-height:1.7` | `#3D4A60` | 8,95:1 |
| Beschriftung | 11 / 700, `.10em`, Versalien | `#5B6472` | 5,98:1 |
| Wert | 16 / 600 | `#0D1F3C` | 16,43:1 |
| Hinweisbox-Text | 15 / 400 | je Tonalität | 4,84–5,98:1 |
| Fussnote | 14 / 400 | `#5B6472` | 5,98:1 |
| Fusszeile | 12 / 400 | `#5B6472` | 5,98:1 |

Die Fusszeile war im Bestand `#94A3B8` bei 11,5 px — **2,56:1**, deutlich unter jeder Schwelle. Das ist
mit dem Neubau behoben, ohne dass es beauftragt war.

### Farbpalette der Vorlagen (vollständig, 31 Werte)

Alle Werte stammen aus `customer-dashboard/shared/customer-design-tokens.css`. Die einzige Ausnahme ist
`#3D4A60`, und die ist keine neue Farbe: es ist Night bei 80 % Deckkraft über Weiss, ausgerechnet, weil
E-Mail-Clients `rgba()` nicht überall tragen.

```
Night          #0D1F3C   Kopf, Überschriften, Werte, Knopf
Gold           #E8C547   Markenlinie, Eyebrow Marke, Lead „Heiss“
Blau           #1A6FE8   Links
Fläche         #F7F8FA   Seite, Fuss
Fläche weich   #F1F4F9   Detail-Karte
Weiss          #FFFFFF   Karte
Rand           #E4E6EA   Kartenrand, Trennlinien
Rand weich     #EEF1F6   Innenränder
Text           #0D1F3C · Fliesstext #3D4A60 · Beschriftung/Fuss #5B6472
Auf Night      #FFFFFF · gedämpft #A9B6CC · Grün #34D399 · Rot #FCA5A5
Hinweis   Fläche #EEF4FF  Rand #BFDBFE  Schrift #1558BF  Balken #1A6FE8
Erfolg    Fläche #ECFDF5  Rand #A7F3D0  Schrift #047857  Balken #059669
Warnung   Fläche #FFFBEB  Rand #FDE68A  Schrift #B45309  Balken #D97706
Gefahr    Fläche #FEF2F2  Rand #FECACA  Schrift #C0362C  Balken #DC2626
Lead      Heiss #E8C547/#0D1F3C · Warm #FBF1D8/#7A5C00 · Kalt #EEF2F7/#5B6472
```

> **Entscheidung nötig (E2):** Die vier Tonalitäten der Hinweisbox sind eine *funktionale* Kategorie,
> keine fünfte Farbfamilie — dieselbe Argumentation, mit der F7 Blau als „interaktiv“ eingeordnet hat.
> Ich habe das so entschieden, weil ohne Warnung/Gefahr keine Mahnung und keine Sicherheitsmail
> gestaltbar ist. Bitte bestätigen oder widersprechen; falls widersprochen, laufen Warnung und Gefahr
> beide auf die Rot-Familie und Erfolg auf Grün, und die Tonalitäten reduzieren sich von vier auf drei.

---

## 5. Technische Regeln

Verbindlich für alle Vorlagen. Der vorgeschlagene Wächter prüft genau diese Liste.

1. **Tabellen-Layout, kein Flexbox, kein Grid.** Jede Tabelle trägt
   `role="presentation" cellpadding="0" cellspacing="0" border="0"`. Betrifft im Bestand die
   Generationen A und E — die Anruf-Vorlagen nutzen `display:grid` für ihre zweispaltigen Zeilen, was in
   Outlook zu einer einzigen Spalte zusammenfällt.
2. **Inline-Styles für alles, was das Layout trägt.** Gmail entfernt `<head>`-Styles in einem Teil der
   Ansichten. Der `<style>`-Block enthält deshalb **ausschliesslich** Media-Queries für mobile
   Polsterung — die Mail muss vollständig richtig aussehen, wenn er ersatzlos entfällt.
3. **Keine Web-Fonts.** DM Sans und Plus Jakarta Sans sind nicht ladbar. Stapel:
   `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`.
   Das ist eine sichtbare Abweichung vom Produkt und lässt sich nicht beheben.
4. **`max-width:600px`** plus festes `width="600"` — Outlook ignoriert `max-width`, braucht das Attribut.
5. **Keine `rgba()`-Farben, keine Verläufe, keine `box-shadow`,** keine `::before`/`::after`. Alle vier
   fallen in Outlook aus; `::after` wird im Bestand für Deko-Kreise verwendet.
6. **Flächenfarben doppelt setzen:** `bgcolor="#…"` als Attribut *und* `background-color` im Style.
   Outlook liest das Attribut, moderne Clients den Style.
7. **Bilder nur mit `width`/`height`-Attribut, `alt` und `style="display:block;border:0;"`.** Das Logo
   ist ein gehostetes PNG (Supabase Public Bucket) — Inline-SVG (Generation E) zeigt Outlook nicht an.
8. **Jeder Knopf bekommt darunter den Klartext-Link.** Wer den Knopf nicht als Knopf erkennt oder in
   einem Client liest, der Hintergrundfarben unterdrückt, kommt trotzdem ans Ziel. Grundsatz 15.
9. **Preheader-Zeile** als erstes Element im `<body>`, versteckt — sonst zieht sich der Client die erste
   sichtbare Textzeile in die Vorschau, und das ist heute in mehreren Vorlagen „VOXERA“.
10. **Dark Mode:** `<meta name="color-scheme" content="light">` und
    `<meta name="supported-color-schemes" content="light">`. Damit lassen Apple Mail und iOS die Mail in
    Ruhe. **Ehrlich dazu:** Gmail für Android invertiert trotzdem, und dagegen gibt es kein zuverlässiges
    Mittel. Die Gestaltung ist deshalb so gebaut, dass eine Invertierung sie nicht zerstört: alle Flächen
    tragen explizite Farben, es gibt keine transparente Fläche, keinen weissen Text auf ungefärbtem
    Grund. Der Night-Kopf bleibt in jedem Fall dunkel.
11. **Keine Prozentbreiten unter 100 % ausser in Zweispaltern**, dort `width="50%"` als Attribut.
12. **Keine `<div>` als Layout-Träger** — nur innerhalb einer `<td>` für Textblöcke.

---

## 6. Referenz-Vorlage: `offer_email`

**Datei:** `docs/email-templates/offer_email.html` — der Code, der in Make-Route 0, Modul 10 gehört.
**Vorschau:** `docs/email-templates/vorschau/offer_email.vorschau.html` — dieselbe Datei mit
eingesetzten Beispieldaten, im Browser zu öffnen.
**Bausteinkatalog:** `docs/email-templates/bausteine.html` — alle sieben Bausteine in allen Tonalitäten.

`offer_email` ist als Referenz gewählt, weil sie sechs der sieben Bausteine braucht (alle ausser der
Schritt-Liste) und weil sie die geschäftlich wichtigste Mail ist — was hier trägt, trägt überall.

### Was sich gegenüber dem Bestand ändert

| | vorher | nachher |
|---|---|---|
| Seitenfläche | `#F1F5F9` | `#F7F8FA` (Produkt-Canvas) |
| Kartenradius | 16 px | 14 px (`--vx-ui-card-radius`) |
| Markenlinie | keine | 3 px Gold über dem Kopf |
| Fliesstext | 15 px `#475569` | 16 px `#3D4A60` |
| Fusszeile | 11,5 px `#94A3B8` (2,56:1) | 12 px `#5B6472` (5,98:1) |
| Knopf | nur Knopf | Knopf + Klartext-Link darunter |
| Preheader | keiner | „Ihre persönliche Offerte, gültig bis …“ |
| Rabattzeile | dauerhaft sichtbar, „—“ bei 0 | verschwindet bei 0 |
| Betragsformat | `formatNumber(…; 2; "."; "'")` | unverändert (Schweizer Format ist korrekt) |
| Payload-Felder | unverändert | unverändert — **kein neues Feld nötig** |

Die Felderliste bleibt exakt gleich. Das gilt für alle zwölf Vorlagen: der Neubau ändert die Gestaltung,
nicht den Vertrag.

### Wie zu prüfen ist

1. Die Vorschaudateien unter `docs/email-templates/vorschau/` im Browser öffnen — Desktop, dann
   Fenster auf ~390 px verschmälern. `offer_email` und `contract_signed_email` sind die dichtesten.
2. `docs/email-templates/bausteine.html` öffnen — stimmt das Vokabular? Besonders: Hinweisbox-Tonalitäten
   (Entscheidung E2) und Lead-Abzeichen in Gold statt Rot.
3. Näher an der Wahrheit, und durch nichts zu ersetzen: eine Vorlage in ihr Make-Modul einsetzen und
   eine Testmail an sich selbst schicken. Outlook und Gmail lassen sich im Browser nicht beurteilen.

---

## 7. Stand nach der Freigabe

Alle zwölf Vorlagen sind gebaut, jede mit Vorschaudatei, jede vom Wächter geprüft. Die Zuordnung
Datei → Route → Modul steht in [`email-templates/README.md`](email-templates/README.md), dort auch die
vier zu ändernden Betreffzeilen.

| Datei | Bausteine | Besonderheit |
|---|---|---|
| `offer_email.html` | B1, B2, B3, B5 | Rabattzeile erscheint nur bei `discount_amount > 0` |
| `invoice_email.html` | B1, B2 | drei `mail_type` in einer Datei; Befund 3 und 4 behoben |
| `contract_expired_email.html` | B1, B2, B3 | Akzent Rot |
| `password_changed_email.html` | B1, B2, B3 | Akzent Grün |
| `password_reset.html` | B1, B2, B3 | Akzent Neutral |
| `assistant_updated_email.html` | B1, B2, B3 | Freitextfelder einspaltig |
| `welcome.html` | B1, B2, B3, B6 | zwei Schritte, Weiterleitungscode als Kennzahl-Block |
| `contract_signed_email.html` | B1, B2, B3, B4 | geht in Modul 54 **und** 55 |
| `ai_change_request.html` | B1, B3 | intern |
| `fallback_alarm.html` | B1, B2 | intern |
| `call_notification_email.html` | B1, B3, B7 | Szenario 09 **und** 01; Befund 1 und 5 behoben |
| `callback_request_email.html` | B1, B2, B3, B7 | Szenario 09 **und** 01; Befund 1, 2 und 5 behoben |

### Der Wächter

`scripts/verify-mail-templates.mjs`, Workflow `.github/workflows/verify-mail-templates.yml`. Prüft die
Regeln aus Abschnitt 5 plus die Palette und die beiden Bugfix-Regeln. Mit Gegenprobe gebaut: die sechs
Regeln, die einem Fund aus Abschnitt 2 entsprechen, wurden einzeln verletzt und schlagen einzeln an —
`display:flex`, `white-space:pre-line`, eine Farbe ausserhalb der Palette, `lead_quality = "Hot"`, eine
Bedingung auf `callback_requested`, fehlende Vorschaudatei.

Was der Wächter **nicht** kann: er sieht den Make-Blueprint nicht und merkt deshalb nicht, wenn jemand
direkt im Make-Editor ändert. Das bleibt die offene Flanke von Variante 1,5 und hängt an der Regel
„nie direkt in Make editieren“.

### Offen

- Die vier Betreffzeilen in Make ändern (Tabelle im README) — nur der User kann das.
- Zwölf Dateien in die Module einsetzen und je einen Testlauf fahren; Outlook und Gmail lassen sich nur
  am echten Versand beurteilen, nicht im Browser.
- Die zwei Anruf-Vorlagen greifen in Szenario 09 erst, wenn der Szenario-01-Migrations-Branch gemergt
  und deployed ist. Bis dahin zählt die Kopie in Szenario 01 — und die läuft erst wieder, wenn Szenario
  01 aktiviert ist. Das ist eine Routing-Frage und bleibt ausserhalb dieses Auftrags.

Nicht angefasst, wie vereinbart: `_lib/mail-delivery.js`, die Routing-Logik,
`config/mail-engine-contracts.json`, und keine neuen Mail-Typen.

---

## Entscheidungen

| | Frage | Entschieden am 09.08.2026 |
|---|---|---|
| **E1** | Anruf-Vorlagen: Szenario 09, 01 oder beide? | **Beide.** Solange der Szenario-01-Branch nicht gemergt ist, versendet 01; danach 09. Eine Datei bedient beide. |
| **E2** | Vier Hinweisbox-Tonalitäten als funktionale Kategorie? | **Ja**, konsistent zur F7-Auflösung für Blau. |
| **E3** | Make oder Repo? | **Variante 1,5** — Repo als Quelle, Make als Versandweg, Regel „nie direkt in Make editieren“. |
| **E4** | Fliesstext 16 px statt Produkt-15 px? | **Ja**, Grundsatz 15. Einzige Grössenabweichung. |
