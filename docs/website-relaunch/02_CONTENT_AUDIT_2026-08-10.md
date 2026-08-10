# Schritt 2 — Content-Audit: Was auf voxera.ch stimmt, was nicht

**Datum:** 10.08.2026
**Grundlage:** die in `01_IST_AUFNAHME` gesicherten Aussagen, geprüft gegen den echten
Code-Stand von `voxera-platform` und die Supabase-Projekte.

> ## ⚠️ Nachtrag 10.08.2026 — der Volltext der Startseite liegt jetzt vor
>
> Startseite, Impressum, `offer-accept.html` und die `netlify.toml` sind gesichert
> ([Archivkopie](ist-stand-2026-08-10/)). Das hat **sieben neue Befunde** ergeben, darunter
> zwei, die schwerer wiegen als alles bisher Gefundene:
>
> **[C16 — drei namentliche Kundenstimmen mit Fünf-Sterne-Bewertung](#c16--namentliche-kundenstimmen-ohne-kunden-)** und
> **[C17 — „Über 20 Schweizer KMU vertrauen bereits auf Voxera"](#c17--über-20-schweizer-kmu-)**,
> während die Datenbank 4 Kundendatensätze, **0 davon live**, und 19 Anrufe im ganzen System
> enthält.
>
> Eine frühere Einschätzung von mir war zu hart und ist unten korrigiert: **C3**. Die Seite
> nennt DSG und DSGVO korrekt nebeneinander — nur das Hero-Badge verkürzt.

> ## ✅ Zweiter Nachtrag — Rechtstexte und Redirects sind da
>
> `agb.html`, `datenschutz.html`, `contract-signed.html` und `_redirects` liegen jetzt
> ebenfalls in der [Archivkopie](ist-stand-2026-08-10/). **Schritt 1 ist damit im Kern
> erledigt** (siehe Dokument 01). Das ändert die Lage an einer entscheidenden Stelle:
>
> **Die Datenschutzerklärung sagt das Gegenteil der Startseiten-FAQ — und sie hat recht.**
> Sie benennt die US-Verarbeitung offen, listet Sub-Auftragsverarbeiter nach Datenstandort
> und nennt sogar den CLOUD Act. C2 ist damit **kein Rechercheproblem mehr, sondern ein
> Widerspruch im eigenen Haus** — mit einer bereits vorhandenen, korrekten Formulierung.
> Siehe die neu geschriebene [C2](#c2--alle-daten-werden-ausschliesslich-in-der-schweiz-verarbeitet-und-gespeichert--).
>
> Vier weitere Befunde aus den Rechtstexten: **C23** (die AGB bezeichnen sich selbst als
> ungeprüfte Arbeitsversion), **C24** (die veröffentlichten Löschfristen stimmen nicht mit
> dem Code, und die Löschautomatik ist abgeschaltet), **C25** (Zusagen, die gegen offene
> Punkte im Fahrplan laufen), **C26** (Impressum ohne UID trotz „exkl. MwSt.").

**Verbleibende Einschränkung:** Es fehlt weiterhin eine **vollständige Dateiliste des
Deploys**. Dass `offer-accept.html` vorher in keiner Dokumentation auftauchte, zeigt, dass es
weitere Seiten geben kann. Ausserdem fehlen die Bild-Assets (`og-image.png`, Favicons).

**Legende**
🔴 belegt falsch · 🟠 unbelegt / riskant · 🔵 Entscheidung des Betreibers · 🟢 belegt korrekt

---

## Stand der Rückmeldungen (10.08.2026)

| Befund | Rückmeldung Umut |
|---|---|
| **C2 Datenresidenz** | Wird **sofort und unabhängig vom Relaunch** entschärft — nicht erst mit der neuen Seite. Umut lädt dazu das Netlify-Deploy-ZIP hoch. Die Richtungsentscheidung (Text anpassen / EU-Endpunkt prüfen / streichen) läuft in diesem separaten Strang. |
| **C1 Preise** | **Noch nicht final.** Hängt an einer laufenden Margen-Rechnung — ElevenLabs-Überschreitungspreis und Twilio-Minutenpreis stehen noch aus. **Bis dahin gilt: mit den aktuellen Preisen als Platzhalter weiterarbeiten**, die Änderung kommt separat nach. |
| **C4** Zahlenquellen, **C5** getestete Telefonanbieter, EU-/CH-Endpunkt-Frage aus C2 | Zulieferung folgt, sobald Umut sie zusammen hat. |
| Design-Option | **B — Schweizer Werkbank** gewählt (siehe Zielbild, Teil C). |
| Branchenlücke `detailhandel-logistik` | Vorlage wird **nachgebaut**. Als eigener Produktpunkt abgegrenzt: [`04_PRODUKTPUNKT_BRANCHENVORLAGE_DETAILHANDEL.md`](04_PRODUKTPUNKT_BRANCHENVORLAGE_DETAILHANDEL.md). |

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
| **C16** | **Drei namentliche Kundenstimmen mit 5 Sternen — bei 0 Live-Kunden** | 🔴 **belegt ungedeckt** | **Pflicht, sofort** |
| **C17** | **„Über 20 Schweizer KMU vertrauen bereits auf Voxera"** — die DB kennt 4 Datensätze, 0 live | 🔴 **belegt falsch** | **Pflicht, sofort** |
| C18 | „99% Verfügbarkeit" und „<10s Reaktionszeit" ohne SLA und ohne Monitoring | 🟠 unbelegt | Pflicht |
| C19 | `/agb` und `/agb.html` liefern beide dieselbe Seite, kein Canonical, inkonsistente interne Links | 🟠 SEO-Schaden | beim Bau |
| C20 | Kein Canonical, kein `robots`-Meta, **kein Schema.org** auf der ganzen Seite | 🟠 SEO | beim Bau |
| C21 | Echte, aktive Voxera-Nummer `+41 44 505 36 62` in der öffentlichen Demo | 🟠 prüfen | prüfen |
| C22 | `offer-accept.html` — zweite Transaktionsseite, bisher nirgends dokumentiert | 🟢 Fakt | Bau-Vorgabe |
| **C23** | **Die AGB bezeichnen sich selbst öffentlich als ungeprüfte Arbeitsversion** — und werden im Signaturprozess verbindlich akzeptiert. Dazu Versionskonflikt. | 🔴 **belegt** | **Pflicht, sofort** |
| **C24** | **Veröffentlichte Löschfristen stimmen nicht mit dem Code** — und die Löschautomatik ist per Flag abgeschaltet | 🔴 **belegt** | **Pflicht** |
| C25 | Weitere Zusagen der Datenschutzerklärung, die gegen offene Punkte im Fahrplan laufen (Anrufer-Disclosure/EU AI Act, 2FA, Backup, DSFA) | 🟠 prüfen | Pflicht |
| C26 | Impressum ohne UID/MWST-Nummer, obwohl Preise „exkl. MwSt." ausgewiesen sind | 🟠 prüfen | empfohlen |

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

> **Stand 10.08.2026:** noch offen. Die Entscheidung hängt an einer laufenden
> Margen-Rechnung; der ElevenLabs-Überschreitungspreis und der Twilio-Minutenpreis fehlen
> noch. **Bis dahin wird mit den heutigen Preisen als Platzhalter weitergearbeitet.**
>
> Das ist unproblematisch, solange die Bau-Vorgabe unten eingehalten wird: liegen alle Preise
> in **einer** Content-Datei, ist der spätere Austausch eine Änderung an einer Stelle statt
> an sechs. Zwei Dinge sind dabei aber wichtig:
> - Der **Launch** darf nicht mit dem Platzhalter passieren — C1 bleibt bis zur echten
>   Entscheidung ein Launch-Blocker für `/preise/`, auch wenn der Bau weiterläuft.
> - Der Platzhalter darf **kein abgelaufenes Datum** tragen. Genau das ist der Fehler, den
>   dieser Befund beschreibt. Solange die Aktion nicht entschieden ist, wird sie in der
>   Platzhalter-Fassung ohne Ablaufdatum geführt und `priceValidUntil` bleibt leer — lieber
>   eine Lücke als eine falsche Zusage.

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

### ⚠️ Neu 10.08.2026 — die Datenschutzerklärung widerspricht der Startseite

Der Volltext von `datenschutz.html` (Version 2.0, Stand 01.05.2026) liegt jetzt vor. **Sie
beschreibt genau die Realität, die ich oben aus dem Code belegt habe** — und damit das
Gegenteil der FAQ auf derselben Domain:

| Startseite, FAQ „Was passiert mit meinen Daten?" | Datenschutzerklärung §6 |
|---|---|
| „Alle Daten werden **ausschliesslich in der Schweiz** verarbeitet und gespeichert." | „Bei der Verarbeitung Ihrer Daten **kann eine Übermittlung in die USA erfolgen**, insbesondere im Rahmen der KI-Sprachverarbeitung und Telefonie-Infrastruktur." |

Die Datenschutzerklärung geht sogar deutlich weiter und ist dabei durchweg korrekt:

- **§5 listet die Sub-Auftragsverarbeiter nach Datenstandort** — „KI-Sprachdienste: **USA**",
  „Telefonie-Infrastruktur: Schweiz / EU / USA", „Cloud-Datenbank: **Schweiz (primärer
  Datenstandort)**", „Web-Hosting: EU / USA", „Workflow- und E-Mail-Dienste: EU". Das deckt
  sich Zeile für Zeile mit der Prozessor-Tabelle oben.
- **§6 nennt die Absicherung** (EU-Standardvertragsklauseln, TLS, Datenminimierung) und
  benennt offen das Restrisiko: „…können wir nicht ausschliessen, dass US-Behörden unter
  bestimmten Umständen (z.B. nach dem **CLOUD Act**) Zugriff auf bei US-Anbietern
  gespeicherte Daten verlangen."
- **§8 sagt präzise:** „Die Hauptdatenbank wird in der **Schweiz (Zürich)** betrieben." Das
  ist unabhängig bestätigt — die Supabase-Produktion läuft in `eu-central-2`, also Zürich.

**Was das ändert — und es ändert viel:**

1. **Die richtige Formulierung existiert bereits.** Es muss nichts erfunden und nichts
   recherchiert werden. Der Fix für die Marketing-Aussage ist, sie an die **eigene
   Datenschutzerklärung anzugleichen** — nicht umgekehrt. Das macht aus einer offenen
   Grundsatzfrage eine Textänderung.
2. **Das rechtliche Risiko ist kleiner als befürchtet.** Die verbindliche Offenlegung ist
   vorhanden, korrekt und wird im Vertragsprozess akzeptiert. Was bleibt, ist eine
   **irreführende Marketing-Aussage**, die dem eigenen Rechtstext widerspricht — schlecht,
   aber etwas anderes als eine ungedeckte Zusicherung ohne jede Offenlegung.
3. **Der Widerspruch ist gleichzeitig das schärfste Argument, es sofort zu ändern.** Zwei
   Dokumente auf derselben Domain sagen Gegensätzliches. Wer beides liest — und ein
   Datenschutzbeauftragter einer Arztpraxis oder Kanzlei liest beides — findet das sofort.
4. **Option (b) wird unwahrscheinlicher.** Ein EU-/CH-Endpunkt bei ElevenLabs würde die
   Aussage „ausschliesslich Schweiz" trotzdem nicht retten, weil Twilio, Netlify und die
   Anthropic-API weiterhin ausserhalb liegen — genau wie §5 es selbst auflistet.

**Empfehlung (Formulierung, keine Rechtsberatung):** Die FAQ-Antwort durch eine gekürzte
Fassung des eigenen §5/§6 ersetzen — Speicherung in der Schweiz (Zürich), Sprachverarbeitung
über spezialisierte Partner mit Standard­vertragsklauseln, Verweis auf die
Datenschutzerklärung. Das ist ehrlich, bereits juristisch formuliert und für ein Schweizer
KMU immer noch ein gutes Argument.

> **Stand 10.08.2026:** Dieser Punkt wird **sofort und unabhängig vom Relaunch** behandelt.
> Für den Relaunch heisst das: die neue Seite erbt das Ergebnis, statt die Frage ein zweites
> Mal aufzumachen.
>
> **Vier Stellen tragen die Aussage — alle müssen mitgeändert werden:**
> 1. Startseite, **FAQ** „Was passiert mit meinen Daten?" — die wörtliche Aussage
> 2. Startseite, **Feature-Karte** „Swiss Hosted · DSGVO-konform — Alle Daten in der Schweiz
>    verarbeitet und gespeichert."
> 3. Startseite, **Hero-Badge** „DSGVO-konform · Schweiz"
> 4. **`offer-accept.html`**, Badges „Schweizer Hosting" und „DSGVO-konform" — **direkt über
>    dem Signaturfeld.** Das ist die heikelste: keine Werbung, sondern eine Zusicherung im
>    Moment des Vertragsschlusses.
>
> Die **Datenschutzerklärung selbst muss nicht geändert werden** — sie ist bereits korrekt.

---

## C3 — „Swiss Hosted · DSGVO-konform" 🟠 / 🔵

Zwei getrennte Probleme in einem Badge:

**„Swiss Hosted"** — siehe C2. Für die Datenbank zutreffend, für die Sprachverarbeitung
nicht. Ohne Präzisierung ist das Badge irreführend.

**„DSGVO-konform"** — **korrigiert nach Sichtung des Volltexts.** Meine ursprüngliche
Einschätzung war zu hart: Ich hatte geschrieben, die Seite nenne das falsche Leitgesetz. Das
stimmt so nicht. Feature-Karte und FAQ nennen beides korrekt nebeneinander:

> „Vollständig konform mit DSG und DSGVO."
> „…vollständig konform mit dem Schweizerischen Datenschutzgesetz (DSG) und der DSGVO."

Der Rest des Punkts bleibt: die **Kurzformen** verkürzen auf die DSGVO allein — das
Hero-Badge („DSGVO-konform · Schweiz"), die Feature-Überschrift („Swiss Hosted ·
DSGVO-konform") und die Badges in `offer-accept.html` („Schweizer Hosting", „DSGVO-konform").
Für Schweizer Interessenten ist das die schwächere Reihenfolge — DSG zuerst wäre passender.
Kleiner Punkt, reine Formulierung.

**Der grössere Teil ist der „Swiss Hosted"-Anteil** und der hängt vollständig an C2.

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

> **Beantwortet am 10.08.2026 — und schlimmer als vermutet.** Der Volltext liegt vor; die
> Fristen stehen in §7 der Datenschutzerklärung und stimmen weder mit dem Code überein noch
> läuft die Löschautomatik. Ausgeführt in **[C24](#c24--die-veröffentlichten-löschfristen-stimmen-nicht-)**.
> Die FAQ-Formulierung „nach Ihrer **konfigurierten** Aufbewahrungsfrist" ist dabei der
> zusätzliche Fehler: eine kundenseitige Einstellmöglichkeit gibt es nicht.

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

## C16 — Namentliche Kundenstimmen ohne Kunden 🔴

Die Startseite trägt unter der Überschrift **„Vertrauen — Was unsere Kunden sagen"** drei
Testimonials, jeweils mit fünf Sternen, Namen, Beruf und Ort:

> ★★★★★ «Ich war auf der Baustelle, Voxera hat einen Auftrag entgegengenommen…»
> — **Marco R., Elektriker, Zürich**
>
> ★★★★★ «Früher habe ich jeden Anruf während der Behandlung verpasst…»
> — **Sandra K., Physiotherapeutin, Bern**
>
> ★★★★★ «Die Einrichtung hat wirklich nur 20 Minuten gedauert…»
> — **Thomas M., Immobilienmakler, Luzern**

**Dagegen steht der belegte Stand:**

| Quelle | Aussage |
|---|---|
| Produktionsdatenbank, 10.08.2026 | **4** Kundendatensätze, **0** mit Live-Status, **19** Anrufe im gesamten System |
| Fahrplan | „aktuell keine echten Kunden im System"; Pilotstart hängt an drei externen Blockern |
| Sales-One-Pager | bewusst **ohne Testimonials** gebaut — „keine echten Kundenzitate verfügbar" |

Diese beiden Bilder lassen sich nicht vereinbaren. Entweder existieren die drei Personen und
ihre Aussagen — dann ist die Projektdokumentation an mehreren Stellen falsch. Oder die
Kundenstimmen sind Platzhalter, die live gegangen sind.

**Warum das schwerer wiegt als der abgelaufene Aktionspreis:** Ein veraltetes Datum ist eine
Nachlässigkeit. Erfundene Kundenstimmen mit Namen, Beruf, Ort und Sternebewertung sind
irreführende Werbung im Sinne des UWG — und sie sind der Punkt, an dem ein Interessent, der
es merkt, nicht nur diese Aussage, sondern die ganze Seite nicht mehr glaubt. Bei einem
Produkt, das mit Vertrauen und Datenschutz verkauft wird, ist das teuer.

Dazu kommt: der Aufbau der drei Zitate ist auffällig **passgenau** zu den drei
Referenz-Branchen (Handwerk, Gesundheit, Immobilien) und zum jeweiligen Verkaufsargument. Das
liest sich wie geschriebener Marketingtext, nicht wie eingesammelte Kundenaussagen. Die
„20 Minuten" im dritten Zitat widersprechen ausserdem den „5 Minuten", die die Seite selbst
in Schritt 2 für die Rufweiterleitung nennt.

**Bitte bestätigen (Rückfrage, nicht Feststellung):** Existieren diese drei Kunden und diese
Aussagen? Falls ja: liegt eine schriftliche Freigabe zur Namensnennung vor? Falls nein:

- Die Sektion muss **von der Live-Seite entfernt werden** — nicht erst mit dem Relaunch. Sie
  ist bereits über zwei Monate online.
- Auf die neue Seite kommt sie in keiner Form. Das ist genau der Fall, für den im Zielbild
  das Muster „Vertrauen ohne Referenzen" vorgesehen ist: echte Demo, transparenter Ablauf,
  klare Preise, Gesicht des Gründers, Schweizer Rechtsrahmen.
- Sobald es echte Pilotkunden gibt, sind zwei belegte Zitate mit Freigabe mehr wert als drei
  erfundene.

---

## C17 — „Über 20 Schweizer KMU" 🔴

Im Abschluss-Abschnitt der Startseite:

> „**Über 20 Schweizer KMU vertrauen bereits auf Voxera.** Starten Sie heute – in unter 24
> Stunden einsatzbereit."

**Gegengeprüft am 10.08.2026 in der Produktionsdatenbank:** 4 Kundendatensätze, davon **0 mit
Live-Status**, 6 Verträge, 19 Anrufe insgesamt. Selbst bei grosszügigster Auslegung — jeder
Datensatz, jeder Vertrag ein Kunde — kommt man nicht über die Hälfte der behaupteten Zahl.

Anders als bei C16 ist hier kein Interpretationsspielraum: die Zahl ist konkret,
nachprüfbar und aktuell nicht gedeckt. **Gleiche Behandlung wie C16: von der Live-Seite
entfernen, nicht auf die neue Seite übernehmen.**

Wenn ein Wachstumssignal gewünscht ist, geht das auch ohne Zahl — „Aktuell im Aufbau mit
ersten Pilotkunden in der Deutschschweiz" ist ehrlich und für ein junges Produkt sogar
sympathischer als eine runde Zahl, die niemand nachprüfen kann.

---

## C18 — „99% Verfügbarkeit" und „<10s Reaktionszeit" 🟠

Im selben Vertrauens-Block stehen vier Kennzahlen: `24/7 Erreichbarkeit`,
`<10s Reaktionszeit`, `99% Verfügbarkeit`, `CHF 0 pro verpasstem Anruf`.

- **„99% Verfügbarkeit"** ist eine SLA-Aussage. Im Repo existiert keine
  Verfügbarkeitszusage, und laut Fahrplan gibt es **kein Error-Tracking und kein Alerting** —
  Störungen fallen nur auf, wenn Umut sie selbst bemerkt. Eine Verfügbarkeit, die niemand
  misst, lässt sich weder belegen noch einhalten. Nebenbei: 99 % erlaubt rund **7 Stunden
  Ausfall pro Monat** — als Zusage klingt die Zahl stärker, als sie ist.
- **„<10s Reaktionszeit"** ist plausibel (der Assistent nimmt sofort ab), aber ebenfalls
  nirgends gemessen.

**Vorschlag:** „24/7" und „CHF 0 pro verpasstem Anruf" behalten — beides folgt direkt aus dem
Produkt. Die beiden Messwerte entweder mit echten Zahlen hinterlegen, sobald Monitoring
existiert, oder streichen. Eine Verfügbarkeitszusage ohne Messung ist ausserdem der Punkt,
an dem der offene Haftungs-Blocker aus dem Fahrplan konkret wird.

---

## C19 — Zwei URLs pro Rechtstext, kein Canonical 🟠

Die `netlify.toml` legt drei Rewrites an (`status = 200`, also kein Redirect):

```toml
/impressum   → /impressum.html    (200)
/agb         → /agb.html          (200)
/datenschutz → /datenschutz.html  (200)
```

Damit ist **jeder Rechtstext unter zwei URLs erreichbar** — `/agb` und `/agb.html` liefern
identischen Inhalt. Ohne `rel="canonical"` (das es nirgends gibt, siehe C20) ist das für
Google Duplicate Content: die Signale verteilen sich auf zwei Adressen statt sich zu
addieren.

Verschärfend: **die Seite verlinkt selbst inkonsistent.** Allein im Impressum stehen im
Footer nebeneinander `/datenschutz.html`, `/agb` und `/impressum.html` — zwei Schreibweisen
in derselben Zeile. `offer-accept.html` verlinkt konsequent die kurzen Formen, das Produkt
ebenfalls.

**Dazu: dieselben drei Regeln stehen zweimal.** Die nachgelieferte `_redirects` enthält
wortgleich, was schon in der `netlify.toml` steht:

```
/datenschutz /datenschutz.html 200
/impressum   /impressum.html   200
/agb         /agb.html         200
```

Netlify wertet `netlify.toml` **vor** `_redirects` aus — die Regeln in `_redirects` kommen
also nie zum Zug. Hier folgenlos, weil identisch, aber es ist toter Konfigurationscode, der
bei der nächsten Änderung genau eine Frage aufwirft: welche der beiden Dateien gilt? Exakt
diese Falle ist im Kunden-Dashboard schon einmal zugeschlagen und dort im `netlify.toml`
auskommentiert dokumentiert. **Beim Relaunch: eine Quelle, nicht zwei.**

**Bau-Vorgabe:** kurze Form (`/agb`, `/datenschutz`, `/impressum`) ist die kanonische —
sie steht in den Verträgen. Die `.html`-Variante bekommt einen **301 auf die kurze Form**
(nicht 200), alle internen Links werden vereinheitlicht, und jede Seite bekommt ein
selbstreferenzierendes Canonical.

---

## C20 — Kein Canonical, kein Schema.org, kein `robots` 🟠

Technischer Scan der Startseite (252 KB):

| geprüft | Ergebnis |
|---|---|
| `rel="canonical"` | **nicht vorhanden** |
| JSON-LD / Schema.org | **nicht vorhanden** — kein `Organization`, `LocalBusiness`, `FAQPage`, `Offer` |
| `robots`-Meta | nicht gesetzt (Startseite) |
| `<title>`, `meta description`, Open Graph | ✅ vorhanden und ordentlich |
| Bilder | genau **ein** `<img>` im ganzen Dokument |
| Analytics / Tracking | **keines** |

Das Positive zuerst: Titel, Description und Open Graph sind gepflegt, und es gibt **kein
Tracking** — beim Relaunch gehen also keine Messreihen verloren, und es braucht kein
Cookie-Banner-Erbe.

Das Teure: **die ausgebaute FAQ mit sechs Fragen bringt heute nichts an Rich Results**, weil
`FAQPage` fehlt. Ebenso die drei Preispläne ohne `Offer`. Beides ist im Zielbild (Teil B.5)
bereits als Vorgabe gesetzt — hier nur der Beleg, dass es bisher komplett fehlt.

Das Impressum trägt dagegen `<meta name="robots" content="noindex">` und hat **weder
Description noch Canonical**. `noindex` auf einem Impressum ist vertretbar, aber es kostet
ein Vertrauenssignal; üblicherweise lässt man Impressum und Datenschutz indexieren.

**Nebenbefund:** beide Seiten deklarieren `lang="de"`, `offer-accept.html` dagegen
`lang="de-CH"`. Für Schweizer Suchergebnisse ist `de-CH` das richtige.

---

## C21 — Echte Telefonnummer in der öffentlichen Demo 🟠

Die eingebettete Dashboard-Demo zeigt unter „Erreichbarkeit" und „Einstellungen" die Nummer
**`+41 44 505 36 62`** als „IHRE VOXERA-NUMMER", mit Status „Aktiv". Alle übrigen Nummern in
der Demo sind erkennbar Platzhalter (`+41 79 000 00 00`, `+41 44 000 00 00`) — diese eine
nicht.

**Zu prüfen:** Ist das eine echte, geschaltete Voxera-Nummer? Falls ja, steht sie öffentlich
auf der Startseite und bekommt Testanrufe von Besuchern — die dann als echte Anrufe im System
landen und Minuten verbrauchen. Falls es eine Demonummer sein soll, gehört sie ins
Platzhalter-Schema wie die anderen.

---

## C22 — `offer-accept.html`: die zweite Transaktionsseite 🟢 (Fakt)

Bisher war eine Transaktionsseite auf voxera.ch bekannt (`contract-signed.html`). Es sind
mindestens **zwei**:

**`/offer-accept.html?token=…`** ist die Seite, auf der Kunden ihre Offerte lesen und
**digital rechtsverbindlich unterzeichnen** — mit Signaturfeld, drei Zustimmungs-Checkboxen
(AGB v2.0, AVV v1.0, DSE v2.0) und Versionsstempeln (`v2.0-2026-05-01`). Sie ruft
`admin.voxera.ch/.netlify/functions/offer-public-get` und `…/offer-public-accept` auf.

Das hat drei Konsequenzen:

1. **Die Seite darf beim Relaunch nicht kaputtgehen.** In der `netlify.toml` hat sie eine
   eigene `no-store`-Regel und eine erzwungene Selbst-Weiterleitung
   (`from = "/offer-accept.html"`, `to = "/offer-accept.html"`, `force = true`) — vermutlich,
   damit die Catch-all-Regel sie nicht abfängt. Diese Konstruktion ist fragil und beim Neubau
   sauber zu ersetzen.
2. **Die Datenresidenz-Aussage steht auch hier** — als Badge „Schweizer Hosting" und
   „DSGVO-konform", direkt über dem Signaturfeld. Das ist die heikelste Stelle überhaupt:
   nicht Marketing, sondern eine Zusicherung im Moment des Vertragsschlusses. **Gehört zu den
   Stellen, die bei der C2-Entschärfung mitgeändert werden müssen.**
3. **`contract-signed.html` existiert — Entwarnung.** Die Datei wurde nachgeliefert und ist
   Teil des Deploys; da `publish = "."` gilt, wird sie ausgeliefert und die Catch-all-Regel
   greift nicht. Der Deeplink aus dem Kunden-Dashboard funktioniert also. Es sind damit
   **drei** Transaktionsseiten auf voxera.ch: `offer-accept.html`, `contract-signed.html` und
   — je nach Zählung — die Formularstrecke der Startseite.

**Weitere Funktionsabhängigkeiten, die den Relaunch überleben müssen:**

- **Netlify Forms** — zwei Formulare (`name="kontakt"` und ein verstecktes `name="anfrage"`)
  mit `data-netlify="true"` und Honeypot. Wenn die neue Seite kein Netlify-Forms-Markup mehr
  hat, kommen **stillschweigend keine Anfragen mehr an**. Kein Fehler, keine Meldung — nur
  Stille. Das ist die Art Fehler, die man erst nach Wochen bemerkt.
- **Calendly** — `calendly.com/voxera_ch/voxera-demo-ai-telefonassistent` als Terminbuchung
  für das Erstgespräch.
- **Catch-all** `/*` → `/index.html` mit Status 404: liefert die komplette Startseite als
  Fehlerseite aus. Der Status ist richtig, der Inhalt nicht — beim Relaunch eine echte
  404-Seite bauen.

---

## C23 — Die AGB bezeichnen sich selbst als ungeprüfte Arbeitsversion 🔴

Direkt unter der Überschrift von `voxera.ch/agb`, öffentlich sichtbar:

> **Hinweis:** Diese AGB sind eine operative Arbeitsversion für Voxera. Vor produktivem
> Einsatz mit zahlenden Kunden sollte die finale Fassung **rechtlich geprüft** werden.

Gleichzeitig lässt `offer-accept.html` Kunden ankreuzen: *„Ich habe die **AGB (v2.0)**
gelesen und akzeptiere sie **verbindlich**"* — und der Vertragstext im Admin-Portal nennt die
AGB „integraler Bestandteil dieses Vertrags". Es gibt 6 Verträge im System.

Ein Dokument, das von sich selbst sagt, es sei noch nicht für den Einsatz mit zahlenden
Kunden geprüft, ist damit die verbindliche Vertragsgrundlage. Für einen Interessenten, der
die AGB vor der Unterschrift liest — bei B2B nicht unüblich — ist dieser Satz ein Stopp.

**Dazu ein Versionskonflikt, der die Beweislage betrifft:**

| Stelle | Version |
|---|---|
| `agb.html`, sichtbarer Stand | **03. Juli 2026** |
| `offer-accept.html`, gespeicherter Zustimmungsstempel | `agb_version: 'v2.0-2026-05-01'` — **1. Mai 2026** |
| Datenschutzerklärung (zum Vergleich) | „Stand: 1. Mai 2026 · Version 2.0" — **stimmt überein** ✓ |

Kunden unterschreiben also gegen „v2.0-2026-05-01", während die URL eine Juli-Fassung
ausliefert. Welcher Text tatsächlich akzeptiert wurde, lässt sich nachträglich nicht mehr
belegen — genau das, was die Versionsstempel eigentlich leisten sollen.

**Dritter Punkt: `agb.html` stammt sichtbar aus einer älteren Seitengeneration.** Die
Navigation lautet dort „Problem · Funktionen · Preise · FAQ · Demo anfragen", während alle
anderen Seiten „So funktioniert's · Features · Dashboard · Preise · Beratung · Kontakt"
zeigen. Auch der Footer ist ein anderer. Die Seite wurde beim letzten Redesign schlicht nicht
mitgezogen.

**Zu tun:** (1) Den Arbeitsversions-Hinweis entfernen — nach der rechtlichen Prüfung, nicht
davor. (2) Versionsstempel und veröffentlichten Stand in Übereinstimmung bringen, und ab dann
die AGB **versioniert archivieren**, damit zu jedem Vertrag der akzeptierte Text auffindbar
bleibt. (3) Beim Relaunch die AGB-Seite mit auf den neuen Stand ziehen — **den Rechtstext
selbst wortgleich übernehmen**, nur die Hülle erneuern.

---

## C24 — Die veröffentlichten Löschfristen stimmen nicht 🔴

Die Datenschutzerklärung §7 nennt konkrete Fristen. Der Code nennt andere — und die
Löschautomatik läuft gar nicht.

| Datenart | Datenschutzerklärung §7 (veröffentlicht) | `enforce-data-retention.js` |
|---|---|---|
| Audio-Aufzeichnungen | **30 Tage** nach Anruf, danach automatische Löschung | Kommentar: „Audio is retained by **ElevenLabs for 90 days**" |
| Transkripte | Während der Vertragsdauer, danach 30 Tage Übergangsfrist | `TRANSCRIPT_RETENTION_DAYS = **90**` |
| Anruf-Metadaten / Zusammenfassungen | (dieselbe Zeile) | `CALL_RECORD_RETENTION_DAYS = **180**` |

Und der entscheidende Teil — die Funktion ist zwar täglich eingeplant
(`schedule = "17 3 * * *"`), bricht aber sofort ab:

```js
if (process.env.DATA_RETENTION_ENFORCEMENT_ENABLED !== 'true') {
  console.warn('[enforce-data-retention] disabled; set … only after preflight');
  return response(200, { ok: true, enabled: false });
}
```

`docs/P0_DEPLOYMENT_AND_ROLLBACK_PLAN.md` bestätigt, dass das Flag bewusst ungesetzt bleibt,
bis ein Preflight durchlaufen ist. **Es wird derzeit also nichts automatisch gelöscht** —
weder nach 30 noch nach 90 Tagen.

Dass die Löschung gegatet ist, ist für sich genommen **richtig und sorgfältig** — eine
destruktive Automatik ohne Preflight scharf zu schalten wäre schlimmer. Das Problem ist
allein, dass die Website eine Frist veröffentlicht, die weder der Konfiguration noch dem
Betriebszustand entspricht. Die FAQ verschärft das noch: „…nach Ihrer **konfigurierten**
Aufbewahrungsfrist gelöscht" suggeriert eine Einstellmöglichkeit pro Kunde, die es nicht
gibt — die Fristen sind Konstanten im Code.

**Zu tun:** Fristen in der Datenschutzerklärung an die tatsächlichen Werte angleichen (oder
umgekehrt den Code an die Zusage — dann muss aber auch die 30-Tage-Löschung bei ElevenLabs
belegt sein). Danach den Preflight durchlaufen und das Flag scharf schalten. **Bevor der
erste echte Pilotkunde live geht** — ab dann läuft die veröffentlichte Frist gegen echte
Anruferdaten.

---

## C25 — Weitere Zusagen, die gegen offene Punkte laufen 🟠

Die Datenschutzerklärung ist gründlich geschrieben — an vier Stellen sagt sie allerdings
Dinge zu, die laut Fahrplan noch offen sind. Alle vier sind **prüfen**, nicht **falsch** —
ich konnte sie im Repo nicht bestätigen, was nicht dasselbe ist wie widerlegt.

| § | Zusage | Gegenstand |
|---|---|---|
| §11 | „Voxera **stellt sicher**, dass jeder Anrufer zu Beginn des Gesprächs informiert wird" — mit ausformuliertem Ansagetext, plus Erfüllung von **Art. 50 EU AI Act** | Genau das ist **Launch-Blocker 1** im Fahrplan („Einwilligung/Hinweis für Anrufer", offen/extern). Ich habe den Ansagetext in den Prompt-Vorlagen und Migrationen **nicht gefunden**. Der Text schiebt die Pflicht zugleich dem Kunden zu („ist verpflichtet, diese Disclosure-Funktion korrekt zu konfigurieren") — dann ist „stellt sicher" zu stark. |
| §8 | „**Mehr-Faktor-Authentifizierung** für Voxera-Mitarbeiter" | Fahrplan führt **Admin-2FA** als offenen Punkt. |
| §8 | „Regelmässige Backups, **dokumentierte Wiederherstellungsprozesse**" | Fahrplan: **Backup/Restore-Test** steht unter „Nach Launch, kein Zeitdruck" — also noch nicht durchgeführt. |
| §12 | „…haben wir eine **Datenschutz-Folgenabschätzung (DSFA) durchgeführt**" | Im Repo nicht auffindbar. Falls sie existiert, gehört sie abgelegt; falls nicht, ist die Aussage im Perfekt zu stark. |

Positiv gegengeprüft und **korrekt**: §9 „keine Tracking-, Analyse- oder Werbe-Cookies" — der
technische Scan der Startseite fand tatsächlich **kein einziges Tracking-Skript**. Und §4
„Wir verwenden Anrufinhalte nicht für das Training unserer KI-Modelle" deckt sich mit dem
Stack, in dem kein eigenes Training stattfindet.

**Zu tun:** Die vier Punkte einzeln bestätigen oder die Formulierungen abschwächen
(„stellt sicher" → „bietet …an"; „durchgeführt" → nur wenn belegbar). Das ist kein
Website-Relaunch-Thema, sondern gehört zum Datenresidenz-Strang — es sind dieselbe Art
Aussage im selben Dokument.

---

## C26 — Impressum ohne UID trotz „exkl. MwSt." 🟠

Das Impressum nennt: Voxera, Einzelunternehmen, Inhaber Umut Yildirim, Binsböschenweg 3,
6045 Meggen. **Keine UID/CHE-Nummer, keine MWST-Nummer.**

Die Preisseite weist alle Preise „**exkl. MwSt.**" aus, und die Datenschutzerklärung führt
„UID" ausdrücklich als erhobene Kundendatenkategorie. Wer Mehrwertsteuer ausweist, ist in der
Regel MWST-registriert — und dann gehört die Nummer ins Impressum.

**Zu prüfen:** Besteht eine MWST-Registrierung? Falls ja, UID/MWST-Nummer ergänzen. Falls
nein, den Zusatz „exkl. MwSt." überdenken, weil er sonst eine Registrierung suggeriert.

*Kein Rechtsrat — nur ein Punkt, der bei einem Impressum auffällt und billig zu klären ist.*

---

## Was als Nächstes gebraucht wird

*Stand nach der Rückmeldung vom 10.08.2026.*

### Sofort, unabhängig vom Relaunch — die Live-Seite ist seit Monaten falsch

| | Punkt | Warum sofort |
|---|---|---|
| **A** | **C16** Kundenstimmen und **C17** „über 20 KMU" von der Seite nehmen | Irreführende Werbung, steht heute live |
| **B** | **C2** Datenresidenz-Aussage an vier Stellen angleichen | Widerspricht der eigenen Datenschutzerklärung; eine Stelle sitzt über dem Signaturfeld |
| **C** | **C23** Arbeitsversions-Hinweis in den AGB + Versionskonflikt | Verbindliche Vertragsgrundlage, die sich selbst für ungeprüft erklärt |
| **D** | **C1** abgelaufener Aktionspreis (4 Fundstellen) | Bekannt, seit Juni falsch |

### Zulieferungen für den Relaunch

| | Punkt | Wer | Status |
|---|---|---|---|
| 1 | **C4** Quellen für 62 % / 3.4 h / CHF 4'500 / 72 % | Umut | ausstehend |
| 2 | **C5** tatsächlich getestete Telefonanbieter | Umut | ausstehend |
| 3 | **C1** finale Preise nach der Margen-Rechnung | Umut | ausstehend, **Platzhalter freigegeben** |
| 4 | **C8** Belastbarkeit der 24h-Zusage · **C18** 99 %/<10 s | Umut | ausstehend |
| 5 | **C24** Löschfristen angleichen, Preflight, Flag scharf | Produktarbeit | vor dem ersten Pilotkunden |
| 6 | **C25** vier Zusagen bestätigen oder abschwächen | Umut | ausstehend |
| 7 | **C21** echte Nummer in der Demo · **C26** UID | Umut | kurz zu klären |
| 8 | **Vollständige Dateiliste des Deploys** | Umut | letzter offener Rest von Schritt 1 |

**Erledigt:** Sicherung (Schritt 1, im Kern) · Design-Option B · Branchenlücke
`detailhandel-logistik` ([Produktpunkt](04_PRODUKTPUNKT_BRANCHENVORLAGE_DETAILHANDEL.md)) ·
**C10** (die Live-Seite bewirbt **keine** Kalenderfunktionen — Befund erledigt) ·
**C11** (der AVV ist bewusst nicht öffentlich: Impressum und `offer-accept.html` sagen beide,
er werde im Rahmen des Vertragsabschlusses ausgehändigt — bleibt nur der kleine Punkt, dass
Kunden ihn im Dashboard nicht nachlesen können).

**Der Baubeginn ist durch nichts davon blockiert.** Punkte 1–4 und 7 betreffen einzelne
Textstellen und das Go-Live. A–D sind Reparaturen am Bestand und laufen parallel.
