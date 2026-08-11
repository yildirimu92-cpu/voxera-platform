# Datenresidenz — Diagnose je Dienst

**Datum:** 11.08.2026 · **Status:** Diagnose, keine Änderung · **Anlass:** Launch-Blocker C2
(Website behauptet „ausschliesslich in der Schweiz")

Dieses Dokument beantwortet für jeden Dienst im Stack: welche Daten dorthin fliessen, wo sie
verarbeitet und gespeichert werden, wie lange, und ob es eine Regions- oder
Zero-Retention-Einstellung gibt. Es setzt nichts um. Die Formulierungsvorschläge in Teil D
sind Vorschläge, keine Änderungen — auf der Website steht weiterhin der alte Text.

---

## Das Ergebnis in drei Sätzen

Die **Datenbank steht tatsächlich in Zürich** — das ist live bestätigt und der wahre Kern der
Aussage. **Das gesprochene Wort verlässt die Schweiz jedoch immer:** Anrufaudio läuft über
Twilio (Standardregion USA) zu ElevenLabs an einen **fest einprogrammierten US-Endpunkt**, und
die Netlify-Functions, durch die jeder Webhook läuft, sind auf keine Region gepinnt und laufen
damit im US-Standard.

**Kein einziger Dienst ausser Supabase bietet überhaupt eine Schweizer Region an.** „Ausschliesslich
in der Schweiz" ist mit diesem Stack nicht erreichbar — auch nicht mit Budget, auch nicht mit
Enterprise-Verträgen. Erreichbar ist „Datenbank Schweiz, Verarbeitung EU" (mit einer Einschränkung
bei ElevenLabs, siehe C.3).

---

## A. Übersichtstabelle

| Dienst | Datenart | Verarbeitungsort | Speicherort | Frist | Einstellmöglichkeit |
|---|---|---|---|---|---|
| **ElevenLabs** | Gesprächsaudio (vollständig, live), Transkript, Metadaten, **Kundenstammdaten im Agenten-Prompt** (Firma, Adresse, Öffnungszeiten, Leistungen, Notfallnummer) | **USA** 🔴 — `api.us.elevenlabs.io` fest im Code | **USA** 🔴 | Audio **90 Tage** (aktiv gesetzt); Gesprächsdaten Default **2 Jahre**; Prompt-Konfiguration **unbefristet** | ZRM (aus), Audio-Speicherung (an/90 T.), Aufbewahrung; **Datenresidenz nur Enterprise**, Regionen EU/US/Indien/Singapur — **kein CH** |
| **Twilio** | Signalisierung + **Medienstrom** (Audio läuft durch), Anrufer-/Zielnummer, Call-SID, Dauer, Status | **USA** 🔴 — Standardregion `us1`, im Code **keine** Region/Edge gesetzt | **USA** 🔴 (nur CDR/Metadaten) | CDR nach Twilio-Standard; **keine Aufzeichnung** ✅ | Twilio Regions: `ie1` Irland verfügbar — **kein CH**; erfordert Nummern- + Edge-Konfiguration |
| **Supabase** | Transkripte, Zusammenfassungen, Anrufername/-nummer, Kundenstammdaten, Notizen, Rechnungen | **Schweiz (Zürich)** 🟢 `eu-central-2` | **Schweiz (Zürich)** 🟢 | Transkripte **90 T.**, Anrufsätze **180 T.** — implementiert, **Scharfschaltung offen** ⚠️ | Region ist fix pro Projekt; bereits die beste Option. **Kein Audio gespeichert** |
| **Netlify** | **Alles, was durch Functions läuft**: Webhook-Payloads mit Transkripten, Audio-Proxy-Stream, Stammdaten; dazu Besucher-IPs | **USA** 🟠 — `netlify.toml` setzt **keine** Region → Default `us-east-2` (Ohio) | Static/CDN global; Functions ohne Persistenz | keine eigene Frist (zustandslos), Logs nach Netlify-Standard | Functions-Region wählbar: `eu-central-1` Frankfurt, `eu-west-2` London — **kein CH** |
| **Make** | Kundenname, E-Mail, Rechnungsnummer, Beträge, IBAN, Abrechnungsperiode; Anruf-Benachrichtigungen | **EU** 🟠 `eu1.make.com` — live bestätigt | **EU** 🟠 | Ausführungs-Logs **30 Tage**, Webhook-Logs **3 Tage** (Lizenz) | Zone ist bei Org-Anlage fix; EU ist bereits das Beste — **kein CH** |
| *(Anthropic)* | Prompt-Inhalte bei `ai-generate` | **USA** 🔴 `api.anthropic.com` | nach Anbieter-Policy | — | im Code nicht regionalisiert |

**Legende:** 🟢 Schweiz · 🟠 EU bzw. verlagerbar · 🔴 USA

---

## B. Belege je Dienst

### B.1 ElevenLabs — die Kernfrage

**Der Verarbeitungsort steht wörtlich im Code:**

```js
// customer-dashboard/netlify/functions/twilio-inbound-router.js:6
const ELEVENLABS_INBOUND_URL = 'https://api.us.elevenlabs.io/twilio/inbound_call';
```

Das ist kein Default, den man in der Konsole umstellt — es ist eine **fest verdrahtete
US-Adresse**. Jeder eingehende Anruf wird per TwiML-`<Redirect>` genau dorthin geschickt
(`twilio-inbound-router.js:133`). Alle übrigen Aufrufe gehen an `api.elevenlabs.io`
(Agenten-Verwaltung, Sprachsynthese, Gesprächsaudio) — ebenfalls die globale/US-Adresse.

**Was dort ausser Audio noch liegt:** Der Agenten-Prompt wird bei ElevenLabs gespeichert und
enthält die **Kundenstammdaten** — Firmenname, öffentliche Adresse, Öffnungszeiten,
Leistungskatalog, Begrüssungstext, Notfallnummer (`_lib/prompt-builder-v2.js`, synchronisiert
über `_lib/elevenlabs-sync.js:238`). Diese Daten liegen dort **dauerhaft**, unabhängig von jeder
Anruf-Aufbewahrungsfrist. Das wird bei der Diskussion um Audio-Fristen regelmässig übersehen.

**Die beiden Schalter in der Agentenkonfiguration — und was sie *nicht* tun:**

| Schalter | Stand | Was er steuert | Was er **nicht** steuert |
|---|---|---|---|
| „Modus ohne Speicherung" (Zero Retention Mode) | **aus** | Ob Aufnahmen, Transkripte und PII **nach dem Anruf gespeichert/geloggt** werden | **Den Verarbeitungsort.** Der Anruf wird weiterhin in den USA verarbeitet |
| „Anrufaudio speichern" | **an, 90 Tage** | Ob und wie lange die **Audiodatei aufbewahrt** wird | **Den Verarbeitungsort.** Auch ohne Speicherung läuft das Audio durch US-Infrastruktur |

> **Die direkte Antwort auf die Frage im Auftrag:** Beide Schalter sind **Aufbewahrungs**-, keine
> **Standort**-Einstellungen. „Modus ohne Speicherung" einzuschalten verlagert **nichts** in die
> Schweiz oder die EU. Es reduziert, *was liegen bleibt* — nicht, *wo verarbeitet wird*.
> Datenschutzrechtlich ist die Übermittlung in die USA bereits mit dem Verbindungsaufbau erfolgt.

**Gibt es eine EU- oder Schweiz-Option?**

- **EU: ja, aber nur mit Enterprise-Vertrag.** ElevenLabs bietet Datenresidenz über einen eigenen
  Endpunkt (`api.eu.residency.elevenlabs.io`) in einer isolierten Umgebung. Verfügbare Regionen:
  **USA, EU, Indien, Singapur.**
- **Schweiz: nein.** Es existiert keine CH-Region.
- **Wichtige Einschränkung, auch bei EU-Residenz:** Die Residenz garantiert die **Speicherung** in
  der Region. Die **Verarbeitung** kann laut Anbieter-DPA dennoch ausserhalb erfolgen — durch
  internationale Konzerngesellschaften und Subprozessoren, für Support und für
  Inhaltsmoderation. Das Wort „ausschliesslich" wäre also **selbst nach einer EU-Migration nicht
  haltbar.**

**Nebenbefund zur Machbarkeit von ZRM:** Voxera bezieht Transkripte über den Post-Call-Webhook
(`elevenlabs-post-call.js:316`), nicht über nachträgliche Abfragen. Der Webhook ist genau der Weg,
den ElevenLabs für ZRM-Agenten vorsieht — die Transkripterfassung würde also **weiterlaufen**.
Wegfallen würde der **Audio-Player** im Dashboard, der live von ElevenLabs streamt
(`elevenlabs-conversation-audio.js`, aufgerufen in `customer-dashboard/index.html:18520`).

### B.2 Twilio — vermittelt in den USA, zeichnet aber nicht auf

**Wo vermittelt wird:** Im gesamten Code ist **keine** Twilio-Region und **kein** Edge gesetzt —
alle Aufrufe gehen an das unqualifizierte `api.twilio.com`
(`twilio-inbound-router.js:70`, `activation-start-system-test-call.js:27`,
`admin-twilio-number-assignment.js:9`). Damit gilt die Standardregion **`us1`**.

> Entscheidend und kontraintuitiv: **Eine Schweizer Rufnummer wird trotzdem über die USA
> geroutet.** Twilio routet Nummern standardmässig über `us1`, unabhängig vom Land der Nummer.
> Regionales Routing muss aktiv konfiguriert werden — hier ist es das nicht.

**Ob aufgezeichnet wird: nein.** Das ist der beste Befund im ganzen Dokument. Die Antwort des
Routers enthält ausschliesslich eine Weiterleitung:

```js
// twilio-inbound-router.js:133
`<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Redirect method="POST">${elevenLabsTarget}</Redirect>\n</Response>`
```

Es gibt im gesamten Repository **kein** `<Record>`-Verb und keinen
`RecordingStatusCallback`. Twilio hält also **Verbindungsdaten (CDR)** — Nummern, Zeitpunkt,
Dauer, Status — aber **keine Gesprächsinhalte**. Der Medienstrom läuft durch Twilio hindurch zu
ElevenLabs, wird dort aber nicht persistiert.

**Einstellmöglichkeit:** Twilio Regions bietet `ie1` (Irland) als EU-Region an. **Keine
CH-Region.** Eine Umstellung muss auf beiden Seiten geschehen — Twilio-Nummer **und**
ElevenLabs-Routing-Region —, sonst schlagen Operationen auf laufenden Anrufen (Weiterleitung,
Halten) fehl.

### B.3 Supabase — bestätigt Zürich ✅

Live über die Supabase-API abgefragt, nicht aus dem Code geschlossen:

| Projekt | Ref | Region | Bedeutung |
|---|---|---|---|
| Produktion | `ulcofbgrovgcvowdjrge` | `eu-central-2` | **AWS Europe (Zurich)** 🟢 |
| Staging | `hzqiyyqfchvfcmmbemvd` | `eu-central-2` | **AWS Europe (Zurich)** 🟢 |

**Bestätigt.** Datenbank und Storage liegen in Zürich.

**Was dort liegt:** Transkripte (`transcript`, `transcript_json`), Zusammenfassungen,
Anrufername und -nummer, Kategorie, Notizen — dazu die Kundenstammdaten und die Rechnungsdaten.

**Was dort *nicht* liegt — wichtig:** **Kein Audio.** Die Spalten `recording_url` und
`recording_storage_path` existieren zwar, werden aber von **keiner einzigen Codestelle
beschrieben**, und in der Produktionsdatenbank sind sie bei **allen 31 Anrufen leer**:

```
calls_total: 31 | mit_transkript: 29 | mit_recording_url: 0 | mit_storage_path: 0
mit_conv_id: 31 | Zeitraum: 2026-08-04 bis 2026-08-10
```

Alle 31 Anrufe verweisen per `elevenlabs_conversation_id` auf ElevenLabs. **Die einzige Kopie
des Gesprächsaudios liegt in den USA.** Die Spalten sind toter Vorrat für eine nie gebaute
Spiegelung.

**Fristen — implementiert, Scharfschaltung offen:** `enforce-data-retention.js` löscht Transkripte
nach **90 Tagen** und Anrufsätze nach **180 Tagen**, geplant täglich um 03:17
(`netlify.toml`). Die Funktion ist jedoch bewusst gesperrt:

```js
// enforce-data-retention.js:29
if (process.env.DATA_RETENTION_ENFORCEMENT_ENABLED !== 'true') { /* macht nichts */ }
```

⚠️ **Zu prüfen:** ob `DATA_RETENTION_ENFORCEMENT_ENABLED` in Netlify auf `true` steht. Ist sie es
nicht, ist die in der Datenschutzerklärung genannte Frist **nicht wirksam**. Am Datenbestand
lässt sich das derzeit nicht ablesen — der älteste Anruf ist 7 Tage alt, die 90-Tage-Grenze wurde
noch von keinem Satz erreicht.

### B.4 Netlify — der unterschätzte Punkt

`customer-dashboard/netlify.toml` enthält Build-, Header-, Redirect- und Schedule-Blöcke, aber
**keine Regionsangabe**. Damit gilt der Netlify-Default **`us-east-2` (Ohio, USA)**.

Das ist gravierender, als es klingt: **jeder** Datenfluss im System läuft durch diese Functions —
der Post-Call-Webhook mit dem vollständigen Transkript, der Audio-Proxy, die Stammdatenpflege,
der Twilio-Router. Die Daten werden dort zwar nicht gespeichert, aber **verarbeitet**.

**Einstellmöglichkeit:** Die Functions-Region ist frei wählbar (Projektkonfiguration → Build &
deploy → Functions region), u. a. **`eu-central-1` (Frankfurt)** und `eu-west-2` (London).
**Keine Schweizer Region.** Umstellung erfordert einen Redeploy.

### B.5 Make — EU bestätigt, mehr geht nicht

Live über die Make-API bestätigt: Organisation 6923430, **`zone: "eu1.make.com"`**. Die Szenarien
laufen wie angenommen auf **eu1 (EU)**.

**Was dorthin fliesst:** Kundenname, E-Mail, Rechnungsnummer, Beträge, IBAN und Abrechnungsperiode
(`customer-billing-update.js:626`) sowie die Anruf-Benachrichtigungen über die zentrale
Mail-Engine (Szenario 09).

**Fristen:** Die Lizenz zeigt `retention: 30` (Tage, Ausführungs-Logs) und
`webhookLogRetentionDays: 3`.

**Einstellmöglichkeit:** Die Zone wird bei Anlage der Organisation festgelegt und ist nicht
umschaltbar. Eine CH-Zone existiert nicht. **EU ist hier bereits das Maximum.**

---

## C. Was liesse sich verlagern — und was nicht

### C.1 In die **Schweiz** verlagerbar: nichts Weiteres

Ausser Supabase bietet **kein Dienst im Stack eine Schweizer Region an** — weder ElevenLabs
noch Twilio, Netlify oder Make. Das ist keine Frage von Budget oder Vertrag, sondern von
Verfügbarkeit. **Die Aussage „ausschliesslich in der Schweiz" ist technisch unerreichbar**, solange
dieser Stack verwendet wird.

### C.2 In die **EU** verlagerbar

| Massnahme | Aufwand | Wirkung | Bewertung |
|---|---|---|---|
| **Netlify-Functions → `eu-central-1` (Frankfurt)** | **sehr gering** — Konsolen-Einstellung + Redeploy, keine Codeänderung | Die gesamte Verarbeitungsschicht verlässt die USA | ⭐ **Bestes Verhältnis.** Sollte unabhängig von allem anderen geschehen |
| **Twilio → `ie1` (Irland)** | mittel — Nummer auf regionales Routing umstellen, Routing-Region in ElevenLabs spiegeln, sonst brechen Weiterleitungen | Vermittlung und CDR in der EU | sinnvoll, aber **nur zusammen mit C.3** — sonst bleibt der nächste Hop die USA |
| **ElevenLabs → EU-Residenz** | **hoch** — Enterprise-Vertrag nötig, plus Codeänderung (fest verdrahtete US-Adresse, alle `api.elevenlabs.io`-Aufrufe) | Speicherung von Audio/Transkript in der EU | **Der eigentliche Blocker.** Vertragsfrage, keine Konfigurationsfrage |
| **Make** | — | bereits EU | ✅ erledigt |
| **Anthropic** | offen | — | separat zu prüfen |

### C.3 Was auch nach einer vollständigen EU-Migration bliebe

Selbst wenn alle vier Massnahmen umgesetzt würden, bliebe:

1. **ElevenLabs-Verarbeitung ist auch bei EU-Residenz nicht garantiert EU-exklusiv** — Support,
   Moderation und Konzerngesellschaften dürfen laut DPA von ausserhalb zugreifen.
2. Die **Kundenstammdaten im Agenten-Prompt** blieben bei ElevenLabs, unbefristet.
3. „Ausschliesslich" bliebe **in jedem Szenario falsch.**

### C.4 Massnahmen ohne Standortwirkung, aber mit Datenschutzwirkung

Diese verlagern nichts, verringern aber die Datenmenge im Ausland — und sind billig:

- **„Modus ohne Speicherung" (ZRM) aktivieren:** Audio und Transkript blieben nicht mehr in den
  USA liegen; die Transkripterfassung liefe über den Post-Call-Webhook weiter, das Transkript
  landete weiterhin in Zürich. **Preis:** Der Audio-Player im Dashboard entfiele, und die
  Fehlersuche bei Anrufproblemen wird schwerer.
- **Aufbewahrungsfrist der Gesprächsdaten prüfen:** Der Default liegt bei **2 Jahren**. Gesetzt
  ist nur die Audio-Frist (90 Tage). Ob die Transkriptfrist bei ElevenLabs ebenfalls auf 90 Tage
  steht, ist in der Konsole zu verifizieren — sonst besteht ein Widerspruch zur eigenen
  90-Tage-Zusage.
- **`DATA_RETENTION_ENFORCEMENT_ENABLED` scharfschalten** (siehe B.3).

---

## D. Welche Aussage wäre wahr — Formulierungsvorschläge

> Vorschläge. **Nichts davon ist umgesetzt**; auf der Website steht weiterhin der alte Text.

### D.1 Was nicht mehr verwendet werden darf

| Aktuelle Formulierung | Problem |
|---|---|
| „Alle Daten werden **ausschliesslich in der Schweiz** verarbeitet und gespeichert." | Belegt falsch — Audio wird in den USA verarbeitet |
| „**Swiss Hosted** · DSGVO-konform" | „Swiss Hosted" suggeriert den gesamten Stack; zutreffend ist nur die Datenbank |
| „Schweizer Hosting" | dito |
| „Alle Daten in der Schweiz verarbeitet und gespeichert." | dito |

Diese Formulierungen stehen auch im Sales-One-Pager und im Pitch-Deck und müssten dort
mitgezogen werden.

### D.2 Vorschlag Website — Kurzform (Badge / Hero)

> **Schweizer Datenbank (Zürich) · revDSG & DSGVO**

Präzise, prüfbar, und deckungsgleich mit dem, was der Hotfix vom 10.08. bereits vorbereitet hat.

### D.3 Vorschlag Website — FAQ „Was passiert mit meinen Daten?"

> Ihre Kundendaten, Anrufprotokolle und Transkripte werden in einem Schweizer Rechenzentrum in
> Zürich gespeichert. Für die Telefonie und die KI-Sprachverarbeitung arbeiten wir mit
> spezialisierten Anbietern zusammen, die diese Daten auch ausserhalb der Schweiz verarbeiten —
> ausschliesslich zur Durchführung des Gesprächs. Die Übertragung ist verschlüsselt und
> vertraglich abgesichert. Transkripte löschen wir nach 90 Tagen, Anrufprotokolle nach 180 Tagen.
> Welche Anbieter das sind und wo sie sitzen, steht offen in unserer Datenschutzerklärung.

**Warum diese Fassung trägt:** Sie behauptet Schweiz nur dort, wo es stimmt (Speicherung), benennt
die Auslandsverarbeitung aktiv statt sie zu verstecken, und macht aus der Offenlegung ein
Vertrauensargument. Der letzte Satz verweist auf die Datenschutzerklärung, die diese Realität
**bereits korrekt beschreibt** — womit der Widerspruch zwischen beiden Dokumenten aufgelöst ist.

**Wenn eine noch kürzere Fassung gebraucht wird:**

> Gespeichert wird in der Schweiz (Zürich). Verarbeitet wird für Telefonie und Sprach-KI auch im
> Ausland — transparent aufgeführt in der Datenschutzerklärung.

### D.4 Vorschlag Datenschutzerklärung — Auftragsverarbeiter-Tabelle

Die bestehende Datenschutzerklärung (§5/§6, Version 2.0) ist **inhaltlich bereits richtig**. Sie
liesse sich mit den nun verifizierten Angaben präzisieren:

| Zweck | Anbieter | Standort Verarbeitung | Standort Speicherung | Aufbewahrung |
|---|---|---|---|---|
| Datenbank, Transkripte, Stammdaten | Supabase | Schweiz (Zürich) | Schweiz (Zürich) | Transkripte 90 T., Anrufprotokolle 180 T. |
| KI-Sprachassistent, Gesprächsaudio | ElevenLabs | USA | USA | Audio 90 T. |
| Telefonie (Vermittlung) | Twilio | USA | USA (nur Verbindungsdaten, **keine Gesprächsaufzeichnung**) | nach Anbieterfrist |
| Anwendungsbetrieb, Web-Hosting | Netlify | USA | keine dauerhafte Speicherung | — |
| Workflows, E-Mail-Versand | Make | EU | EU | Protokolle 30 T. |

Ergänzend beizubehalten: der bereits vorhandene Hinweis auf **EU-Standardvertragsklauseln**,
TLS-Verschlüsselung und Datenminimierung als Absicherung der Übermittlung.

**Ein Satz, der in §6 wörtlich stimmt:**

> Bei der Sprachverarbeitung und der Telefonie werden Ihre Daten in die USA übermittelt. Wir haben
> mit diesen Anbietern EU-Standardvertragsklauseln abgeschlossen. Gespräche werden von uns nicht
> als Audiodatei in der Schweiz gespeichert; die Aufzeichnung liegt beim Sprachdienstleister und
> wird dort nach 90 Tagen gelöscht.

### D.5 Wenn die Schweiz-Botschaft strategisch wichtig ist

Dann ist die einzige tragfähige Steigerung **nicht** eine andere Formulierung, sondern C.2 +
C.4: Netlify nach Frankfurt, Twilio nach Irland, ZRM aktivieren. Danach wäre haltbar:

> Ihre Daten werden in der Schweiz gespeichert und innerhalb der Schweiz und der EU verarbeitet.
> Gesprächsaudio wird nicht dauerhaft aufbewahrt.

Das setzt voraus, dass ElevenLabs auf EU-Residenz umgestellt ist — und damit einen
Enterprise-Vertrag. **Bis dahin gilt D.3.**

---

## E. Offene Punkte — nur in den Konsolen prüfbar

Diese fünf Punkte liessen sich aus Code und APIs nicht abschliessend klären:

| # | Zu prüfen | Wo | Warum es zählt |
|---|---|---|---|
| 1 | Steht `DATA_RETENTION_ENFORCEMENT_ENABLED` auf `true`? | Netlify → Env | Sonst ist die 90/180-Tage-Zusage **unwirksam** |
| 2 | Welche Aufbewahrungsfrist gilt für **Gesprächsdaten** (nicht Audio)? | ElevenLabs → Agent → Advanced | Default 2 Jahre widerspräche der eigenen 90-Tage-Aussage |
| 3 | Aktueller ElevenLabs-Plan — Enterprise ja/nein? | ElevenLabs → Billing | Entscheidet, ob EU-Residenz überhaupt verfügbar ist |
| 4 | Ist bei der Twilio-Nummer regionales Routing gesetzt? | Twilio → Phone Numbers | Bestätigt oder widerlegt die `us1`-Annahme |
| 5 | Welche Functions-Region zeigt Netlify tatsächlich an? | Netlify → Build & deploy | Bestätigt den `us-east-2`-Default |

---

## Quellen

Codebelege sind oben mit Datei und Zeile angegeben. Live abgefragt wurden die Supabase-Projekt-API
(Region `eu-central-2`), die Make-Organisations-API (`zone: eu1.make.com`) und die
Produktionsdatenbank (31 Anrufsätze). Anbieterseitige Angaben:

- [Data residency | ElevenLabs Documentation](https://elevenlabs.io/docs/overview/administration/data-residency)
- [ElevenLabs — Introducing European Data Residency](https://elevenlabs.io/blog/introducing-european-data-residency)
- [Zero Retention Mode (per-agent) | ElevenLabs Documentation](https://elevenlabs.io/docs/eleven-agents/customization/privacy/zrm)
- [Retention | ElevenLabs Documentation](https://elevenlabs.io/docs/eleven-agents/customization/privacy/retention)
- [Audio saving | ElevenLabs Documentation](https://elevenlabs.io/docs/eleven-agents/customization/privacy/audio-saving)
- [Twilio regional routing | ElevenLabs Documentation](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/regional-routing)
- [Twilio Regions | Twilio](https://www.twilio.com/docs/global-infrastructure/understanding-twilio-regions)
- [Understanding Edge Locations | Twilio](https://www.twilio.com/docs/global-infrastructure/understanding-edge-locations)
- [Netlify Function Region Selection](https://www.netlify.com/blog/netlify-functions-region-selection/)
- [Configuration for functions | Netlify Docs](https://docs.netlify.com/build/functions/configuration/)
