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

> **Nachtrag 11.08.2026:** Punkt 1 ist erledigt — der Betreiber hat
> `DATA_RETENTION_ENFORCEMENT_ENABLED = true` in Netlify bestätigt. Die verbleibenden vier
> Punkte sind in Teil G mit konkretem Klickweg aufgeschlüsselt.

| # | Zu prüfen | Wo | Warum es zählt |
|---|---|---|---|
| 1 | ~~Steht `DATA_RETENTION_ENFORCEMENT_ENABLED` auf `true`?~~ ✅ **erledigt, steht auf `true`** | Netlify → Env | Sonst ist die 90/180-Tage-Zusage **unwirksam** |
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

---

## F. Nachtrag 11.08.2026 — Entscheidungen und Nachprüfung

### F.0 Entscheidungsstand

| # | Entscheidung | Status |
|---|---|---|
| 1 | Formulierung aus D.3 wörtlich übernommen, Badge „Schweizer Datenbank (Zürich)" ebenfalls | an das Website-Fenster übergeben — ⚠️ **siehe F.2, Vorbedingung** |
| 2 | Netlify → Frankfurt | angenommen, vorbereitet in `docs/AUFTRAG_NETLIFY_FRANKFURT_2026-08-11.md`, **nicht ausgeführt** |
| 3 | Twilio → Irland | zurückgestellt, gekoppelt an #4 |
| 4 | ElevenLabs EU-Residenz | vorgemerkt als Geschäftsentscheidung, `docs/ENTSCHEID_ELEVENLABS_EU_RESIDENZ_2026-08-11.md` |
| 5 | Stammdaten im Prompt — Lückenprüfung Rechtsdokument | **geprüft, siehe F.1** |
| 6 | `DATA_RETENTION_ENFORCEMENT_ENABLED` | ✅ erledigt, steht auf `true` |
| 7 | Restliche Konsolen-Prüfpunkte | aufgeschlüsselt in Teil G |

### F.1 Stammdaten im Prompt — ist die Lücke real? Teilweise.

Geprüft wurde der Volltext von `docs/website-relaunch/ist-stand-2026-08-10/datenschutz.html`
(Version 2.0, Stand 01.05.2026).

**Die Datenkategorie existiert.** §2 führt sie sogar auf:

> **Konfigurationsdaten** — Begrüssungstexte, KI-Anweisungen, Geschäftslogik —
> *Zweck: Personalisierung des KI-Assistenten*

Die Vermutung, das Geschäftsprofil sei gar nicht erfasst, trifft also **nicht** zu. Die Lücke
liegt eine Ebene tiefer: Die Kategorie ist **definiert, aber nirgends bis zum Standort und zur
Frist durchgezogen.**

| Abschnitt | Was dort steht | Konfigurationsdaten erfasst? |
|---|---|---|
| §2 Erhobene Daten | Kategorie „Konfigurationsdaten" mit Beispielen | ✅ **ja** |
| §5 Sub-Auftragsverarbeiter | „KI-Sprachdienste … **Verarbeitung der Anrufinhalte** … USA" | ❌ **nein** — nur Anrufinhalte, nicht die Konfiguration |
| §6 Drittländer | „insbesondere im Rahmen der **KI-Sprachverarbeitung und Telefonie-Infrastruktur**" | ❌ **nein** — beschreibt Gesprächsdaten, nicht das Geschäftsprofil |
| §7 Speicherdauer | 7 Zeilen: Audio, Transkripte, Kundendaten, Rechnungen, Kontaktanfragen, Logs, Marketing | ❌ **fehlt vollständig** |
| §11 KI-Telefonie, „Verarbeitete Daten" | Audio, Transkript, Metadaten | ❌ **nein** |

**Die Lücke in einem Satz:** Die Datenschutzerklärung sagt, dass Konfigurationsdaten erhoben
werden — aber **nirgends, dass sie in die USA gehen und dass sie dort unbefristet liegen.**
§7 kennt für diese Kategorie überhaupt keine Frist. Beides ist auskunfts- und
informationspflichtig. Der Befund bestätigt die Einschätzung: **Lücke im Rechtsdokument, kein
Website-Thema.**

Zu ergänzen wären zwei Zeilen — je eine in §5/§6 (Standort) und eine in §7 (Frist), etwa:

> **§7:** *Konfigurationsdaten (Begrüssung, KI-Anweisungen, Geschäftsprofil):* Für die Dauer des
> Vertrags. Diese Daten sind zur Erbringung der Leistung beim KI-Sprachdienstleister
> gespeichert und werden dort bei Vertragsende mit dem Assistenten gelöscht.

Der zweite Halbsatz ist zugleich eine **operative Anforderung**: Es muss einen Prozess geben,
der bei Vertragsende den Agenten bei ElevenLabs tatsächlich löscht. Ob es den gibt, ist hier
nicht geprüft.

### F.2 ⚠️ Wichtiger als F.1 — §7 widerspricht der Realität *und* dem neuen Website-Text

Bei der Prüfung für F.1 ist ein Befund aufgetaucht, der nicht Gegenstand des Auftrags war, aber
Entscheidung 1 direkt betrifft. **§7 der Datenschutzerklärung stimmt in zwei Zeilen nicht.**

| §7 sagt | Tatsächlich | Bewertung |
|---|---|---|
| „Audio-Aufzeichnungen von Anrufen: **30 Tage** nach Anruf, danach automatische Löschung" | ElevenLabs ist auf **90 Tage** gesetzt | 🔴 **Zusage wird heute nicht eingehalten** — die Erklärung verspricht mehr Löschung, als stattfindet |
| „Transkripte und Anruf-Metadaten: **Während der Vertragsdauer**, danach 30 Tage" | `enforce-data-retention.js` löscht Transkripte nach **90 Tagen**, Anrufsätze nach **180 Tagen** — unabhängig vom Vertrag, und die Funktion ist seit Punkt 6 **scharf** | 🔴 **Kunden verlieren Daten, die ihnen zugesagt sind** |

Der zweite Punkt ist auch ein Produktproblem, nicht nur ein Rechtsproblem: Ein Kunde im zweiten
Vertragsjahr sieht seine Anrufe aus Monat 4 nicht mehr, obwohl die Erklärung ihm die gesamte
Vertragsdauer zusichert. Seit gestern läuft die Löschung scharf — der erste Fall tritt ein,
sobald der älteste Anruf 90 Tage erreicht, also **etwa Anfang November 2026**.

> **Konsequenz für Entscheidung 1:** Der übernommene Text aus D.3 endet mit „Transkripte löschen
> wir nach 90 Tagen, Anrufprotokolle nach 180 Tagen." Das ist die **Realität** — aber es
> widerspricht **§7 in der heutigen Fassung.** Geht der neue Website-Text live, ohne dass §7
> mitgezogen wird, entsteht **exakt derselbe Widerspruch zwischen Startseite und
> Datenschutzerklärung, den diese Diagnose beseitigen sollte** — nur mit vertauschten Rollen.
>
> **Empfehlung:** §7 gehört in denselben Arbeitsgang wie der Website-Text, nicht in einen
> späteren. Die Zeilen für Audio (30 → 90 Tage, oder ElevenLabs auf 30 Tage stellen) und
> Transkripte (Vertragsdauer → 90 Tage) sind der Mindestumfang, die fehlende Zeile für
> Konfigurationsdaten aus F.1 kommt dazu.

Welche der beiden Richtungen bei Audio gewählt wird — Erklärung an die Realität anpassen (90)
oder Realität an die Erklärung (ElevenLabs auf 30 Tage stellen) —, ist eine Betreiberentscheidung.
Die zweite Variante ist die datenschutzfreundlichere und kostet nur eine Konsolen-Einstellung;
sie verkürzt allerdings das Fenster, in dem ein Gespräch im Dashboard noch anhörbar ist.

---

## G. Teil E, aufgeschlüsselt — was wo nachzuschauen ist

Punkt 1 ist erledigt. Die verbleibenden vier, mit Klickweg und der Angabe, was ein „gutes"
Ergebnis wäre:

### G.1 ElevenLabs — Aufbewahrungsfrist für **Gesprächsdaten** (nicht Audio)

**Weg:** ElevenLabs Dashboard → *Agents* → den produktiven Agenten öffnen → Reiter **Advanced**
→ Block **Data Retention**.

**Zu notieren:** Der Wert bei der Aufbewahrung der Gesprächsdaten (Transkripte), in Tagen. Das
ist ein **anderes Feld** als „Anrufaudio speichern", das bereits auf 90 Tage steht.

**Erwartung:** Der Anbieter-Default ist **2 Jahre**. Steht dort noch der Default, liegen
Transkripte bei ElevenLabs 730 Tage — während Voxera in der eigenen Datenbank nach 90 Tagen
löscht und der neue Website-Text 90 Tage zusagt. **Das wäre ein dritter Widerspruch** zusätzlich
zu den beiden aus F.2.

**Gut wäre:** 90 Tage, passend zur eigenen Zusage.

### G.1b ElevenLabs — Audio-Aufbewahrung auf 30 Tage stellen ⏳ **bis 03.09. folgenlos**

Kein reiner Prüfpunkt, sondern eine **Umstellung** — vom Betreiber am 11.08.2026 entschieden.

**Weg:** ElevenLabs Dashboard → *Agents* → produktiven Agenten öffnen → Reiter **Advanced** →
Block **Privacy / Audio saving** → Aufbewahrung von **90 auf 30 Tage**.

**Warum:** Damit wird die bestehende Zeile in §7 der Datenschutzerklärung („30 Tage nach Anruf")
wieder wörtlich richtig, statt sie auf 90 Tage anzuheben. Datenschutzfreundlicher, und bei einem
Rückrufprodukt ist das kürzere Anhör-Fenster kein Verlust.

**Der Termin ist der Punkt:** Beim Senken fragt die Konsole, ob die neue Frist **auch auf
bestehende Aufnahmen** angewendet werden soll. Der älteste Anruf stammt vom 04.08.2026 und
erreicht am **03.09.2026** die 30-Tage-Grenze. **Bis dahin gibt es keine Aufnahme, die dadurch
verlorenginge** — danach löscht dieselbe Umstellung bestehende Aufnahmen sofort mit.

Es ist also nicht nur billig, das jetzt zu tun, sondern der einzige Zeitpunkt, zu dem es folgenlos
ist. Zusammen mit G.1 in einem Aufwasch, beide Werte liegen im selben Reiter.

### G.2 ElevenLabs — aktueller Plan (Enterprise ja/nein)

**Weg:** ElevenLabs Dashboard → Profilmenü oben rechts → *Subscription* bzw. **Billing**.

**Zu notieren:** Plan-Name und Monats-/Jahrespreis.

**Warum es zählt:** Datenresidenz ist **ausschliesslich** ein Enterprise-Merkmal. Steht dort
Creator, Pro oder Scale, ist Entscheidung 4 nicht nur wirtschaftlich, sondern schon technisch
verschlossen — und der EU-Endpunkt aus C.2 ist bis zu einem Vertragswechsel gar nicht
erreichbar. Die Zahl fliesst direkt in die Rechnung in
`docs/ENTSCHEID_ELEVENLABS_EU_RESIDENZ_2026-08-11.md`.

### G.3 Twilio — regionales Routing der Rufnummer

**Weg:** Twilio Console → *Phone Numbers* → *Manage* → *Active Numbers* → die Voxera-Nummer
öffnen. Zusätzlich oben rechts im Konsolenkopf die **Region** ablesen (dort steht `US1`, `IE1`
oder `AU1`).

**Zu notieren:** In welcher Region die Nummer geführt wird, und ob unter *Voice Configuration*
ein regionaler Edge gesetzt ist.

**Erwartung:** `US1`. Der Code spricht ausschliesslich das unqualifizierte `api.twilio.com` an,
und Twilio führt Nummern standardmässig in `us1` — **auch Schweizer Nummern**. Sollte dort wider
Erwarten `IE1` stehen, wäre das ein Widerspruch zum Code und ein eigener Prüfpunkt, weil dann
API-Aufrufe und tatsächliches Routing auseinanderlaufen.

**Gut wäre:** vorerst egal — Entscheidung 3 ist bewusst zurückgestellt. Der Wert wird gebraucht,
sobald Entscheidung 4 fällt.

### G.4 Netlify — tatsächliche Functions-Region beider Projekte

**Weg:** Netlify → Projekt auswählen → *Project configuration* → *Build & deploy* →
*Continuous deployment* → Abschnitt **Functions region**. **Für beide Projekte einzeln:**
`customer-dashboard` **und** `admin-panel`.

**Zu notieren:** Die angezeigte Region je Projekt.

**Erwartung:** `us-east-2` (Ohio) — keine der beiden `netlify.toml` enthält eine Regionsangabe,
und das ist der Netlify-Default für neue Projekte.

**Gut wäre:** Die Bestätigung, dass beide auf dem Default stehen. Genau das ist die
Ausgangslage, die der vorbereitete Auftrag in `docs/AUFTRAG_NETLIFY_FRANKFURT_2026-08-11.md`
annimmt. Weicht ein Projekt ab, ist der Auftrag vor der Ausführung anzupassen.

---

## F.3 Nachtrag 11.08.2026 — Löscht irgendetwas den Agenten bei Vertragsende? Nein.

Geprüft auf Nachfrage zu F.1. Die Antwort ist eindeutig und hat eine unerwartete zweite Hälfte.

**Teil 1 — es gibt keinen Löschprozess.**

Im gesamten Repository existiert **kein einziger `DELETE`-Aufruf an ElevenLabs**. Der einzige
`DELETE` überhaupt geht an einen Kalenderanbieter (`_lib/calendar-providers.js:285`).

Beide Wege, auf denen ein Vertrag endet, fassen ausschliesslich Supabase an:

| Weg | Datei | Was passiert | ElevenLabs? |
|---|---|---|---|
| manuell | `contract-terminate.js:125` | `operational_status = 'terminated'` | ❌ **kein Bezug** — das Wort „elevenlabs" kommt in der Datei nicht vor |
| zeitgesteuert | `lifecycle-runner.js:138` | dito, plus Vertrags- und Abo-Status, Mail, Audit-Eintrag | ❌ **kein Bezug** |

`elevenlabs_agent_id` bleibt in beiden Fällen **unverändert am Kundensatz stehen**. Der Agent
existiert bei ElevenLabs weiter, mit Firmenname, Adresse, Öffnungszeiten und Leistungskatalog —
unbefristet, in den USA.

**Teil 2 — und ein Nachtdienst frischt ihn weiter auf.**

`findStaleCustomers()` in `_lib/elevenlabs-fanout.js:44` wählt die zu synchronisierenden Kunden aus.
Das einzige Auswahlkriterium ist:

```js
sb.from('customers')
  .select('id, customer_name, elevenlabs_agent_id, prompt_fingerprint, …')
  .not('elevenlabs_agent_id', 'is', null)
```

**Es gibt keinen Filter auf `operational_status`.** Ein gekündigter Kunde, dessen
`elevenlabs_agent_id` noch gesetzt ist, wird vom nächtlichen `fanout-sync-planner` (03:40) also
weiterhin als synchronisierungsbedürftig eingestuft und sein Geschäftsprofil **erneut in die USA
geschrieben** — jede Nacht, unbegrenzt.

**Teil 3 — noch ist nichts passiert.**

Live geprüft, Produktionsdatenbank:

| `operational_status` | Kunden | davon mit `elevenlabs_agent_id` |
|---|---|---|
| `active` | 3 | 1 |
| `terminated` | **1** | **0** |

Der eine gekündigte Kunde hat **keine** Agent-ID. Der Fehler ist damit **latent, nicht aktiv**: Er
tritt beim ersten Kunden ein, der mit einem bereitgestellten Agenten gekündigt wird. Beim aktuellen
Stand von einem einzigen aktiven Agenten ist das noch keine Datenschutzlage — aber es ist eine, die
mit dem ersten echten Kündigungsfall entsteht.

**Folge für die §7-Ergänzung aus F.1:** Der dort vorgeschlagene Halbsatz „… und werden dort bei
Vertragsende mit dem Assistenten gelöscht" wäre **heute eine Zusage ohne Deckung.** Er darf so
nicht in das Rechtsdokument, solange der Prozess nicht existiert. Die beiden Auswege stehen in
`docs/DSE_KORREKTUR_2026-08-11.md`, Abschnitt 3.
