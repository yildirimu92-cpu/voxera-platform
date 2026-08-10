# Schritt 2 — Content-Audit: Was auf voxera.ch stimmt, was nicht

**Datum:** 10.08.2026
**Grundlage:** die in `01_IST_AUFNAHME` gesicherten Aussagen, geprüft gegen den echten
Code-Stand von `voxera-platform` und die Supabase-Projekte.

**Wichtige Einschränkung:** geprüft wurden nur die **bekannten** Aussagen. Da die
Vollsicherung blockiert ist (siehe Dokument 01), kann es auf der Live-Seite weitere
fehlerhafte Aussagen geben, die hier nicht auftauchen. Dieses Audit ist **nicht
vollständig** und wird es erst, wenn der Volltext vorliegt.

**Legende**
🔴 belegt falsch · 🟠 unbelegt / riskant · 🔵 Entscheidung des Betreibers · 🟢 belegt korrekt

---

## Kurzfassung

| # | Befund | Status | Vor Launch |
|---|--------|--------|-----------|
| C1 | Aktionspreise mit abgelaufenem Datum (31.05.2026) als aktuell dargestellt | 🔴 | Pflicht |
| C2 | „Alle Daten ausschliesslich in der Schweiz verarbeitet und gespeichert" | 🔴 belegt widerlegt → 🔵 Entscheidung | Pflicht |
| C3 | „Swiss Hosted · DSGVO-konform" — Badge trägt zwei Probleme | 🟠 / 🔵 | Pflicht |
| C4 | Vergleichszahlen 62 % / 3.4 h / CHF 4'500 ohne Quelle | 🟠 | Pflicht |
| C5 | Rufumleitung „funktioniert bei allen Anbietern" | 🟠 | Pflicht |
| C6 | Inklusiv-Minuten (20/100/200) gegen die tatsächliche ElevenLabs-Kapazität | 🟠 | Pflicht |
| C7 | „Erweiterte Auswertungen (bald)" als Plan-Merkmal | 🟠 | empfohlen |
| C8 | „Einrichtung in unter 24h" | 🟠 | empfohlen |
| C9 | Aufbewahrungsfrist in der FAQ vs. tatsächliche Löschpraxis | 🟠 | Pflicht |
| C10 | Kalender-Funktionen, falls beworben — Feature ist abgeschaltet | 🟠 | prüfen |
| C11 | AVV wird vertraglich referenziert, hat aber keine öffentliche URL | 🟠 | empfohlen |
| C12 | Google Fonts vom CDN — Ladezeit + Widerspruch zur Datenschutz-Botschaft | 🟠 | beim Bau |
| C13 | Seite nur auf Deutsch, Zielgruppe „Schweizer KMU" | 🔵 | Entscheidung |
| C14 | Noch keine echten Pilotkunden — Social Proof entsprechend heikel | 🟠 | Pflicht |
| C15 | `/agb`, `/datenschutz`, `/contract-signed.html` sind unveränderlich | 🟢 Fakt | Bau-Vorgabe |

---

## C1 — Abgelaufene Aktionspreise 🔴

**Aussage auf der Seite:** Einrichtungsgebühren als Aktionspreise (CHF 390 / 540 / 790 statt
490 / 690 / 990), *„gültig bis 31. Mai 2026"*.

**Befund:** Das Datum liegt über zwei Monate in der Vergangenheit. Die Seite bewirbt damit
seit Anfang Juni 2026 eine abgelaufene Aktion als laufend. Belegt und verifiziert (Fahrplan,
Live-Prüfung 07.08. und 10.08.2026).

**Nebenbefund aus der Datenbank:** Die Tabelle `plan_config` in Supabase hat **0 Zeilen**,
obwohl 4 Kunden und 6 Verträge existieren. Preise liegen also hartkodiert im Code (Website
*und* Admin-Portal), nicht in einer gemeinsamen Quelle. Jede Preisänderung muss heute an
mindestens zwei Stellen von Hand nachgezogen werden — genau das Muster, das den
abgelaufenen Aktionspreis überhaupt erst entstehen liess.

**Zu entscheiden (Betreiber):**
1. Aktion beenden → reguläre Preise (490/690/990) ausweisen, oder
2. Aktion mit **neuem, echtem Ablaufdatum** verlängern, oder
3. Aktionspreise zu regulären Preisen machen (390/540/790) und den Aktionsrahmen streichen.

**Bau-Vorgabe unabhängig davon:** Preise und Ablaufdaten auf der neuen Seite in **eine
einzige Datenquelle** (eine Content-Datei) legen, aus der sowohl Preistabelle als auch
strukturierte Daten gespeist werden. Ein Ablaufdatum, das ohne Deploy still verstreicht,
darf es nicht mehr geben — mittelfristig gehört `plan_config` befüllt und zur echten Quelle
gemacht.

---

## C2 — „Alle Daten werden ausschliesslich in der Schweiz verarbeitet und gespeichert" 🔴 → 🔵

Das ist der schwerwiegendste Befund. Der Auftrag verlangt ausdrücklich, hier **nicht selbst
zu entscheiden**. Deshalb unten die **überprüfbaren technischen Fakten** — die Bewertung und
die Formulierungsentscheidung bleiben beim Betreiber.

**Wörtliches Zitat aus der Website-FAQ:**
> „Alle Daten werden ausschliesslich in der Schweiz verarbeitet und gespeichert."

**Was der tatsächliche Stack macht** (alles heute im Repo nachprüfbar):

| Komponente | Wo | Beleg | Trägt Anrufinhalte? |
|---|---|---|---|
| Supabase-Datenbank + Storage (Produktion) | **`eu-central-2` = Zürich, Schweiz** 🟢 | Supabase-API, Projekt `ulcofbgrovgcvowdjrge` | ja (Transkripte, Kundendaten) |
| Supabase Staging | `eu-central-2` (Zürich) 🟢 | Projekt `hzqiyyqfchvfcmmbemvd` | ja |
| **ElevenLabs — eingehender Anruf** | **USA** 🔴 | `customer-dashboard/netlify/functions/twilio-inbound-router.js:6`: `https://api.us.elevenlabs.io/twilio/inbound_call` — der **US-Endpunkt ist fest verdrahtet** | **ja — das komplette Gesprächsaudio** |
| ElevenLabs — Agents, Sprachsynthese, Gesprächsaufzeichnungen | `api.elevenlabs.io` 🔴 | u. a. `/v1/convai/conversations/{id}/audio` — die **Audioaufnahmen liegen bei ElevenLabs**, nicht bei uns | ja |
| Twilio — Telefonie | `api.twilio.com` 🔴 | mehrere Functions | ja (Verbindung/Metadaten) |
| Anthropic API | `api.anthropic.com` 🔴 | `/v1/messages`, für `ai-generate` | ja (Inhalte im Prompt) |
| Make.com | `hook.eu1.make.com` 🟠 EU, **nicht** CH | Benachrichtigungen, Vertrags-Mails | ja (Kunden-/Vertragsdaten) |
| Google Fonts CDN | USA 🟠 | `contract-signed.html:9` | nein, aber Besucher-IP |
| Netlify (Hosting + Functions) | Region nicht konfiguriert 🟠 | `netlify.toml` — kein Region-Pinning | ja (Function-Ausführung) |

**Sachstand in einem Satz:** Die **Datenbank steht tatsächlich in der Schweiz** (Zürich) —
das ist der wahre Kern der Aussage. **Die Sprachverarbeitung nicht:** Anrufaudio läuft
belegbar über einen fest einprogrammierten **US-Endpunkt** von ElevenLabs, und die
Gesprächsaufzeichnungen werden von dort abgerufen, liegen also dort. Das Wort
**„ausschliesslich"** ist damit in der jetzigen Form technisch nicht haltbar.

> Das ist der bereits bekannte, seit dem 07.08.2026 offene externe Launch-Blocker
> **„Datenresidenz-Widerspruch"**. Neu an diesem Audit ist nur, dass er nicht mehr Vermutung
> ist: `api.us.elevenlabs.io` steht wörtlich im Code, und die Supabase-Region ist
> verifiziert.

**Offene Rückfrage an den Betreiber — nicht hier entschieden:**

- **(a)** Text an die Realität anpassen — z. B. differenziert: „Ihre Daten und
  Gesprächsprotokolle werden in einem Schweizer Rechenzentrum (Zürich) gespeichert. Für die
  Sprachverarbeitung arbeiten wir mit spezialisierten Anbietern in den USA/EU zusammen" —
  wobei die Auftragsverarbeiter dann auch im Datenschutztext stehen müssen.
- **(b)** Prüfen, ob ElevenLabs einen **EU-/CH-Datenresidenz-Modus** anbietet und ob
  `api.us.elevenlabs.io` durch einen EU-Endpunkt ersetzbar ist. Erst danach lässt sich
  überhaupt sagen, welche Aussage haltbar wäre. **Das ist die einzige Option, bei der die
  bisherige Botschaft in abgeschwächter Form gerettet werden kann.**
- **(c)** Aussage ersatzlos streichen.

**Bis das entschieden ist, gilt:** Die Aussage darf in **keiner** Form auf die neue Seite —
und auch nicht in den Sales-One-Pager oder das Pitch-Deck, die dieselbe Formulierung
übernommen haben. Ich habe sie in keinem der Zielbild-Textbausteine verwendet.

---

## C3 — „Swiss Hosted · DSGVO-konform" 🟠 / 🔵

Zwei getrennte Probleme in einem Badge:

**„Swiss Hosted"** — siehe C2. Für die Datenbank zutreffend, für die Sprachverarbeitung
nicht. Ohne Präzisierung ist das Badge irreführend.

**„DSGVO-konform"** — für ein Schweizer Unternehmen mit Schweizer KMU-Kunden ist die
**DSGVO das falsche Leitgesetz**. Massgeblich ist das revidierte Schweizer
Datenschutzgesetz (**revDSG**). Die DSGVO greift nur zusätzlich, wenn EU-Personen betroffen
sind. Ein Badge, das nur die DSGVO nennt, wirkt für Schweizer Interessenten eher wie ein
kopierter Standard-Claim als wie ein Beleg für Sorgfalt.

**Vorschlag (Formulierung, keine Rechtsberatung):** „Schweizer Datenschutzrecht (revDSG)"
statt „DSGVO-konform" — und beides nur, wenn C2 geklärt ist.

---

## C4 — Vergleichszahlen 62 % / 3.4 h / CHF 4'500 🟠

Diese drei Zahlen tragen das gesamte Nutzenversprechen der Seite und sind in den
Sales-One-Pager übernommen worden. **Für keine der drei ist eine Quelle dokumentiert** — weder
auf der Seite, noch im Fahrplan, noch im Repo.

Bei Werbeaussagen mit konkreten Zahlen ist das kein Schönheitsfehler: unbelegte quantitative
Vergleichsangaben sind nach UWG angreifbar, und ein KMU-Interessent, der nachfragt, bekommt
heute keine Antwort.

**Nötig vor dem Relaunch:** Für jede Zahl entweder (a) eine zitierfähige Quelle mit Jahr und
Erhebungsbasis benennen, die dann auch als Fussnote auf die Seite kommt, oder (b) die Zahl
durch eine qualitative Aussage ersetzen. Sonderfall: Zahlen aus dem **eigenen** Betrieb
scheiden derzeit aus — es gibt noch keine echten Pilotkunden (siehe C14).

---

## C5 — Rufumleitung „funktioniert bei allen Anbietern" 🟠

Bereits im Fahrplan als offene Frage vermerkt: verifiziert mit Swisscom, Sunrise, Salt und
weiteren — oder unbestätigte Annahme? Im Repo findet sich keine Kompatibilitätsmatrix.

„Alle Anbieter" ist eine Absolutaussage, die genau einmal falsch sein muss, um beim
Onboarding eines Pilotkunden zu platzen. **Vorschlag:** durch die Anbieter ersetzen, die
tatsächlich getestet sind („getestet mit Swisscom, Sunrise und Salt — andere Anbieter auf
Anfrage"). Das ist schwächer formuliert, aber haltbar, und wirkt auf ein Schweizer KMU
glaubwürdiger als ein Pauschalversprechen.

---

## C6 — Inklusiv-Minuten gegen die tatsächliche Kapazität 🟠

Die Seite verspricht 20 / 100 / 200 Inklusiv-Minuten pro Monat und Kunde.

**Tatsächlicher Stand (Fahrplan, 10.08.2026):** Voxera ist auf dem ElevenLabs
**Agents-Starter-Plan** ($6/Monat, **75 Freiminuten pool-weit für den gesamten
Voxera-Account**, nicht pro Kunde). Das reicht rechnerisch nicht für einen einzigen
Business- oder Professional-Kunden.

Das ist streng genommen kein Website-Textfehler, sondern ein Betriebsproblem — aber es steht
hier, weil die Website das Versprechen macht. Ein Professional-Kunde, der seine 200 Minuten
nutzt, überzieht das Gesamtkontingent um ein Vielfaches. **Vor dem Relaunch klären**, sonst
bewirbt die neue Seite dieselbe nicht gedeckte Zusage in schönerem Layout.

---

## C7 — „Erweiterte Auswertungen (bald)" 🟠

Ein kostenpflichtiges Plan-Merkmal, das mit „(bald)" ausgeliefert wird, ist im Professional-
Plan (CHF 299/Monat) das teuerste Element mit dem geringsten Belegwert. Entweder es
existiert bis zum Launch, oder es gehört nicht in die Feature-Liste eines bezahlten Plans —
allenfalls in eine getrennte „geplant"-Zeile ohne Preisbezug.

---

## C8 — „Einrichtung in unter 24h" 🟠

Ein Prozessversprechen, keine Produkteigenschaft. Im Fahrplan ist der Support-Prozess für
Pilotkunden ausdrücklich als **„kein definierter Kanal, keine Reaktionszeit festgelegt"**
vermerkt. Solange niemand definiert hat, wer innerhalb welcher Zeit reagiert, ist die
24-Stunden-Zusage nicht abgesichert. Bei einem Solo-Team, das gleichzeitig entwickelt, ist
sie auch operativ ambitioniert.

**Vorschlag:** entweder mit einer echten internen Zusage hinterlegen (dann darf sie
prominent bleiben), oder auf „in der Regel innert 24 Stunden" abschwächen.

---

## C9 — Aufbewahrungsfrist in der FAQ 🟠

Die Website nennt laut Fahrplan eine Aufbewahrungsfrist-Regelung für Gespräche. Im Fahrplan
steht gleichzeitig, dass **Kunden-Offboarding und Datenlöschung operativ nirgends
beschrieben** sind („automatische Löschung nach X Tagen oder manueller Prozess?" — offen).
Dazu kommt: die Gesprächs**aufnahmen** liegen bei ElevenLabs (siehe C2) — eine Löschfrist,
die nur die eigene Datenbank betrifft, deckt die Aussage nicht ab.

Der FAQ-Volltext ist nicht gesichert; sobald er vorliegt, muss die genannte Frist gegen die
tatsächliche Löschpraxis **in allen** Systemen abgeglichen werden.

---

## C10 — Kalender-Funktionen 🟠

Google-/Microsoft-Kalendersync ist in der Datenbank vollständig angelegt
(`calendar_connections`, `calendar_settings`, `calendar_oauth_states`,
`calendar_booking_audit`), aber **per Feature-Flag deaktiviert**. Falls die Live-Seite
Kalenderanbindung oder „Termin direkt im Anruf buchen" bewirbt, beschreibt sie eine
abgeschaltete Funktion. **Aus der Sicherung zu prüfen** — bekannt ist bisher nur, dass die
Website-Demo die Rufumleitung in „Einstellungen" verortet.

---

## C11 — AVV ohne öffentliche URL 🟠

Der Signatur-Dialog im Admin-Portal lässt Kunden bestätigen, *„die AGB und die AVV von
Voxera zu akzeptieren"* und verlinkt dabei nur auf `voxera.ch/agb`
(`admin-panel/index.html:3915`). In der Dokumentenliste des Kunden-Dashboards steht der
**Auftragsverarbeitungsvertrag (AVV) v1.0 ausdrücklich mit `url: null`**
(`customer-dashboard/index.html:26167`) — er ist das einzige Dokument ohne Link.

Kunden akzeptieren also ein Dokument, das sie nicht abrufen können. Der Relaunch ist der
natürliche Moment, das zu heilen: **`/avv` neu anlegen** und aus beiden Stellen verlinken.

---

## C12 — Google Fonts vom CDN 🟠

`contract-signed.html` lädt Plus Jakarta Sans von `fonts.googleapis.com`. Zwei Nachteile:
zusätzlicher Verbindungsaufbau im kritischen Renderpfad (Core Web Vitals, siehe Zielbild),
und bei jedem Seitenaufruf geht die Besucher-IP an Google — auf einer Seite, die mit
Datenschutz wirbt, ein unnötiger Widerspruch. **Beim Bau: Schriften selbst ausliefern**
(`woff2`, `font-display: swap`, Preload der beiden tatsächlich genutzten Schnitte).

---

## C13 — Nur Deutsch bei Zielgruppe „Schweizer KMU" 🔵

Der KI-Assistent kann laut Code mit Anrufern **de/fr/it/en** sprechen. Website und Dashboard
sind nur auf Deutsch. Für „Schweizer KMU" schliesst das die Westschweiz und das Tessin
faktisch aus — und damit auch deren Suchvolumen.

Keine Korrektur, sondern eine Entscheidung. **Empfehlung fürs Zielbild:** Launch auf
`de-CH`, aber die URL- und `hreflang`-Struktur so bauen, dass `/fr/` und `/it/` später ohne
Umbau danebengestellt werden können (Details im Zielbild).

---

## C14 — Social Proof ohne Kunden 🟠

Im System sind laut Fahrplan **4 Kunden, aber noch keine echten Pilotkunden** live; der
Pilotstart hängt an drei externen Blockern. Der Sales-One-Pager wurde bewusst **ohne
Testimonials** gebaut, weil keine echten Kundenzitate existieren.

**Konsequenz für die Seite:** keine erfundenen Testimonials, keine „von X Betrieben genutzt"-
Zähler, keine Logo-Leiste angeblicher Referenzen. Das Vertrauen muss über andere Signale
kommen — Transparenz über den Ablauf, echte Demo, klare Preise, Schweizer Rechtsrahmen,
Gesicht des Gründers. Das ist im Zielbild als eigenes Muster („Vertrauen ohne Referenzen")
eingeplant.

---

## C15 — Unveränderliche URLs 🟢 (Fakt, keine Korrektur)

Als Bau-Vorgabe festgehalten, weil ein Relaunch das leicht übersieht:

- **`/agb`** und **`/datenschutz`** stehen im generierten Vertragstext und in der
  Dokumentenliste des Kunden-Dashboards → Pfade bleiben **exakt** wie sie sind.
- **`/contract-signed.html?token=…`** ist eine Transaktionsseite, in die das
  Kunden-Dashboard deeplinkt → muss den Relaunch funktionsfähig überleben und darf **nicht**
  indexiert werden (`noindex`).
- **`/favicon.svg`**, **`/favicon.ico`** werden von `contract-signed.html` absolut
  referenziert.

---

## Was als Nächstes gebraucht wird

1. **Entscheidung zu C2** (Datenresidenz) — blockiert den Launch, nicht den Bau.
2. **Entscheidung zu C1** (Preise/Aktion) — blockiert die Preisseite.
3. **Quellen zu C4** (62 % / 3.4 h / CHF 4'500) — blockiert die Startseite.
4. **Antwort zu C5** (getestete Anbieter) und **C8** (24h-Zusage).
5. **Die Sicherung aus Dokument 01**, damit dieses Audit vollständig werden kann.
