# Vorgemerkt — ElevenLabs EU-Residenz

**Datum:** 11.08.2026 · **Status:** **zurückgestellt**, bewusst und begründet ·
**Wiedervorlage:** bei Eintritt eines Auslösers aus Abschnitt 4, spätestens **November 2026** ·
**Grundlage:** `DATENRESIDENZ_DIAGNOSE_2026-08-11.md`, Abschnitte B.1 und C.2

**Entscheidung vom 11.08.2026:** Nicht jetzt. Ein Enterprise-Vertrag bei null zahlenden Kunden ist
verfrüht. Dieses Dokument hält fest, was es kosten würde und woran man erkennt, dass der Zeitpunkt
gekommen ist — damit die Frage in drei Monaten nicht bei null anfängt.

---

## 1. Worum es geht

ElevenLabs verarbeitet und speichert heute **in den USA**: Gesprächsaudio, Transkripte, Metadaten
und die Kundenstammdaten im Agenten-Prompt. Eine EU-Verlagerung ist möglich, aber **ausschliesslich
über einen Enterprise-Vertrag** — Datenresidenz ist ein Enterprise-Merkmal, keine Einstellung in
einem Selbstbedienungsplan.

Verfügbare Regionen: **USA, EU, Indien, Singapur**. **Keine Schweiz.** Der Endpunkt einer
EU-Umgebung lautet `api.eu.residency.elevenlabs.io`.

**Was es *nicht* löst — wichtig für die Erwartung:** Auch mit EU-Residenz bliebe „ausschliesslich in
der Schweiz" falsch. Die Residenz garantiert die **Speicherung** in der Region; die
**Verarbeitung** darf laut Anbieter-DPA weiterhin ausserhalb erfolgen (Support, Moderation,
Konzerngesellschaften). Der Website-Text aus D.3 der Diagnose bliebe also **auch nach dieser
Investition inhaltlich richtig und nötig.** Was sich verbessert, ist die materielle Datenlage,
nicht die Werbeaussage.

---

## 2. Was es kosten würde

### 2.1 Direkte Kosten — Vertrag

**ElevenLabs veröffentlicht keine Enterprise-Preise.** Verträge werden individuell verhandelt, über
zugesagtes Volumen, Laufzeit und Funktionsumfang. Eine belastbare Zahl gibt es deshalb erst nach
einem Gespräch mit dem Anbieter.

Die kursierenden Vergleichswerte für durchschnittliche Enterprise-Jahresverträge liegen im
sechsstelligen Bereich — **diese Zahl ist für Voxera unbrauchbar.** Sie ist der Durchschnitt über
Grosskunden mit dreistelligen Nutzerzahlen und sagt nichts über das Einstiegsminimum eines
Kleinunternehmens. Wer damit rechnet, verwirft die Option aus dem falschen Grund.

Für die Planung ist **die relevante Grösse nicht der Enterprise-Preis, sondern der Aufschlag**:

> **ΔK = Enterprise-Jahreskosten − heutige ElevenLabs-Jahreskosten**

Der zweite Wert ist unbekannt, bis Prüfpunkt **G.2** der Diagnose erledigt ist (ElevenLabs →
Billing → aktueller Plan). **Dieser Prüfpunkt ist die billigste Vorarbeit für diese Entscheidung
und sollte unabhängig davon erledigt werden.**

### 2.2 Indirekte Kosten — Umbau im Code

Anders als bei Netlify ist das **keine reine Konsolenumstellung.** Betroffen sind **9 Dateien mit
rund 12 Aufrufstellen**:

| Datei | Was zu ändern ist |
|---|---|
| `customer-dashboard/netlify/functions/twilio-inbound-router.js` | die **fest verdrahtete** Konstante `api.us.elevenlabs.io` — liegt auf dem Live-Anrufpfad |
| `customer-dashboard/netlify/functions/elevenlabs-post-call.js` | Konversationsabruf |
| `customer-dashboard/netlify/functions/elevenlabs-conversation-audio.js` | Audio-Proxy |
| `customer-dashboard/netlify/functions/preview-voice.js` | 3 Aufrufe **plus eine Host-Allowlist**, in der der EU-Host ergänzt werden muss |
| `admin-panel/netlify/functions/_lib/elevenlabs-sync.js` | Agenten-Sync |
| `admin-panel/netlify/functions/_lib/elevenlabs-phone-number.js` | Rufnummern-Verwaltung |
| `admin-panel/netlify/functions/_lib/elevenlabs-calendar-tool.js` | Kalender-Werkzeug |
| `admin-panel/netlify/functions/elevenlabs-provision-agent.js` | Agenten-Bereitstellung |
| `admin-panel/netlify/functions/admin-voices.js` | Stimmen-Vorschau |

**Der Umbau selbst ist einfach** — die Adresse gehört ohnehin in eine Umgebungsvariable statt
neunmal in den Code. Das ist unabhängig von dieser Entscheidung eine sinnvolle Aufräumarbeit und
könnte **jetzt schon** erfolgen; sie macht die spätere Umstellung zu einer Ein-Zeilen-Änderung.

**Teuer ist die Migration, nicht der Code:** Eine EU-Residenz-Umgebung ist eine **isolierte**
Umgebung. Bestehende Agenten, Stimmen, Rufnummern und Werkzeuge existieren dort **nicht** und
müssen neu angelegt werden. Bei laufendem Betrieb heisst das: jeder Kunde bekommt einen neuen
Agenten, jede Rufnummer wird neu verdrahtet, jeder Prompt neu synchronisiert.

> **Daraus folgt der wichtigste Satz dieses Dokuments:**
> **Die Migration wird mit jedem zusätzlichen Kunden teurer.** Der Aufwand wächst linear mit der
> Kundenzahl, der Nutzen erst ab einer bestimmten Kundenzahl. Wer zu lange wartet, zahlt beides.

### 2.3 Kopplungskosten

Entscheidung 3 der Diagnose (Twilio → Irland) ist bewusst an diese hier gekoppelt. Fällt diese
Entscheidung, kommt Twilio dazu: Nummern auf regionales Routing umstellen und die Routing-Region in
ElevenLabs spiegeln — sonst brechen Weiterleitungen auf laufenden Anrufen. **Die beiden sind ein
Vorhaben, nicht zwei.**

---

## 3. Ab welcher Kundenzahl es sich rechnet

### 3.1 Die Rechnung

> **N = ΔK / DB**
>
> N = zusätzlich nötige Kunden · ΔK = jährlicher Mehrpreis (2.1) · DB = jährlicher Deckungsbeitrag
> je Kunde

**Deckungsbeitrag je Kunde**, auf Basis der Plandaten aus
`docs/website-relaunch/build/src/config/preise.ts`:

| Plan | CHF/Monat | CHF/Jahr | Inklusivminuten |
|---|---|---|---|
| Starter | 99 | 1'188 | 20 |
| **Business** (hervorgehoben) | **199** | **2'388** | 100 |
| Professional | 299 | 3'588 | 200 |

⚠️ **Der Deckungsbeitrag ist derzeit nicht berechenbar.** Die Datei hält ausdrücklich fest, dass
der ElevenLabs-Überschreitungspreis und der Twilio-Minutenpreis **ausstehen** und die Preise
Platzhalter sind. Ohne diese beiden Zahlen ist jede Marge geraten.

**Rechenbeispiel unter einer ausdrücklich angenommenen Marge von 65 %** — als Grössenordnung, nicht
als Ergebnis:

| Jährlicher Mehrpreis ΔK | Zusätzliche Business-Kunden (à ~1'550 CHF DB/Jahr) |
|---|---|
| 6'000 CHF | ~4 |
| 12'000 CHF | ~8 |
| 24'000 CHF | ~16 |
| 60'000 CHF | ~39 |

**Lesart:** Solange der Aufschlag im unteren fünfstelligen Bereich bleibt, liegt die Schwelle bei
**etwa 10 bis 20 zahlenden Kunden**. Das ist eine erreichbare Grösse — und genau deshalb lohnt es
sich, die Frage nicht zu vergessen, sondern zu terminieren.

### 3.2 Warum diese Rechnung wahrscheinlich die falsche ist

Die Kostenrechnung unterstellt, dass EU-Residenz ein **Kostenposten** ist. Realistischer ist, dass
sie ein **Umsatzhebel** wird.

Die eigene Datenschutzerklärung nennt als Zielgruppe ausdrücklich **Arztpraxen und
Anwaltskanzleien** — Branchen mit Berufsgeheimnis (Art. 321 StGB), eigener
Datenschutz-Folgenabschätzung und einer Beschaffung, die nach dem Datenstandort fragt, bevor sie
nach dem Preis fragt.

> **Ein einziger solcher Kunde, der EU-Residenz zur Vertragsbedingung macht, kippt die Rechnung** —
> dann steht ΔK nicht gegen 10 bis 20 hypothetische Kunden, sondern gegen einen konkreten
> Abschluss und die Anschlussfähigkeit im ganzen Segment.

Umgekehrt gilt: Solange die Zielgruppe Handwerk, Gastronomie und Detailhandel ist, fragt niemand
danach, und die Investition wäre reine Kostensteigerung.

**Die entscheidende Frage ist damit nicht „ab wie vielen Kunden?", sondern „in welchem Segment
verkaufen wir?".** Das ist eine Vertriebsentscheidung, keine Kostenrechnung.

---

## 4. Auslöser für die Wiedervorlage

Sobald **einer** dieser Punkte eintritt, ist die Entscheidung neu zu bewerten:

| # | Auslöser | Warum er zählt |
|---|---|---|
| 1 | **Ein Interessent macht den Datenstandort zur Bedingung** | Der stärkste Auslöser. Ab hier ist es kein Kostenposten, sondern ein Auftrag |
| 2 | **Ein Kunde aus einer Berufsgeheimnis-Branche** steht kurz vor Abschluss | Arztpraxis, Anwaltskanzlei, Treuhand, Psychotherapie |
| 3 | **10 zahlende Kunden erreicht** | Ab hier trägt der Deckungsbeitrag einen moderaten Aufschlag — und die Migration ist noch billig |
| 4 | **25 zahlende Kunden erreicht** | ⚠️ Ab hier wird die Migration selbst zum Hauptkostenblock (2.2). Spätestens jetzt entscheiden — auch wenn die Entscheidung „nein" lautet |
| 5 | Ein Datenschutzvorfall oder eine EDÖB-Anfrage | erzwingt die Frage von aussen |
| 6 | ElevenLabs macht Datenresidenz unterhalb von Enterprise verfügbar | dann entfällt die Kostenfrage weitgehend |

**Fester Termin unabhängig davon: November 2026.** Bis dahin sollten Preisgestaltung und
Zielsegment geklärt sein — beides sind Eingangsgrössen dieser Rechnung.

---

## 5. Was bis dahin zu tun ist — billig und nützlich

Nichts davon setzt die Entscheidung voraus:

| # | Massnahme | Aufwand | Nutzen |
|---|---|---|---|
| 1 | **G.2 erledigen** — aktuellen ElevenLabs-Plan und Jahreskosten feststellen | 2 Min. | Ohne diese Zahl ist ΔK nicht berechenbar |
| 2 | **Ein Angebot einholen.** Ein Gespräch mit dem Vertrieb kostet nichts und ersetzt die Schätzung in 2.1 durch eine Zahl | 1 Std. | Macht die Entscheidung überhaupt entscheidbar. Auch ein „zu teuer" ist ein Ergebnis |
| 3 | **Basis-Adresse in eine Umgebungsvariable ziehen** (9 Dateien, ~12 Stellen) | ~3 Std. | Aufräumarbeit, die ohnehin ansteht, und reduziert die spätere Umstellung auf eine Variable |
| 4 | Deckungsbeitrag je Plan ausrechnen, sobald ElevenLabs- und Twilio-Minutenpreise vorliegen | — | Eingangsgrösse für 3.1, und ohnehin für `/preise/` nötig |
| 5 | Bei jedem Verkaufsgespräch notieren, **ob** nach dem Datenstandort gefragt wurde | 0 | Nach zehn Gesprächen ist Abschnitt 3.2 keine Vermutung mehr, sondern belegt |

Punkt 5 ist der wirksamste: Er verwandelt die zentrale offene Frage in eine Beobachtung, die
nebenbei anfällt.

---

## 6. Zusammenfassung für die Wiedervorlage

- **Möglich?** Ja, aber nur über Enterprise. EU, nicht Schweiz.
- **Löst es die Website-Aussage?** Nein. Der Text aus D.3 bleibt richtig und nötig.
- **Was kostet es?** Unbekannt bis zum Angebot. Relevant ist der Aufschlag, nicht der Listenpreis.
- **Ab wann rechnet es sich?** Grob 10–20 Kunden bei moderatem Aufschlag — aber die Kostenrechnung
  ist voraussichtlich die falsche Frage.
- **Was ist der echte Auslöser?** Der erste Kunde, der danach fragt. Wahrscheinlich aus einer
  Berufsgeheimnis-Branche.
- **Was kostet Warten?** Die Migration wird pro zusätzlichem Kunden teurer. Ab ~25 Kunden ist der
  Umbau der Hauptkostenblock.

---

## 7. Anhang — Anfragetext für das Angebot

Zu Massnahme 5.2. **Auf Englisch**, weil der ElevenLabs-Vertrieb so arbeitet und eine deutsche
Anfrage nur eine Übersetzungsschleife einbaut.

**Wohin:** Kontaktformular unter `elevenlabs.io/enterprise` oder direkt an den Sales-Kontakt, falls
im Konto bereits einer hinterlegt ist.

**Betreff:** `EU data residency — pricing for a small Swiss voice-agent provider`

---

> Hello,
>
> I run Voxera, a Swiss company providing an AI phone assistant for small and medium businesses. We
> use ElevenLabs Agents with the native Twilio integration — inbound calls only, German-language
> agents, one agent per business customer.
>
> We are a small operation: currently a handful of agents and low call volume, growing. Swiss and
> EU data protection law (revDSG / GDPR) is a recurring topic in our sales conversations,
> particularly with medical practices and law firms, so I am trying to understand what EU data
> residency would involve for us.
>
> Could you tell me:
>
> 1. **Entry-level pricing.** What is the smallest Enterprise commitment that includes EU data
>    residency? An indicative annual figure is enough at this stage — I need to know whether this is
>    realistic for a company of our size or something to revisit in a year.
> 2. **Coverage.** Does EU residency apply to the full Agents product — inbound Twilio calls,
>    conversation storage, post-call webhooks — or only to parts of it?
> 3. **Endpoints.** Is `api.eu.residency.elevenlabs.io` the base URL for all API calls, and is there
>    an equivalent EU endpoint for the Twilio inbound handler (we currently use
>    `api.us.elevenlabs.io/twilio/inbound_call`)?
> 4. **Migration.** Our existing agents, voices, phone numbers and tools live in the US environment.
>    Is there any migration path, or do these need to be recreated in the EU environment?
> 5. **Processing vs. storage.** Your documentation notes that processing may occur outside the
>    selected region for support and moderation purposes. Can you describe what that covers in
>    practice, and whether it can be restricted contractually?
> 6. **Zero Retention Mode.** Is ZRM available alongside EU residency, and does it remain compatible
>    with post-call webhooks?
> 7. **Twilio regional routing.** If we move our Twilio numbers to the Ireland (ie1) region, what
>    needs to be configured on the ElevenLabs side?
>
> Happy to have a short call if that is easier.
>
> Best regards,
> Umut Yildirim
> Voxera — voxera.ch

---

**Warum diese sieben Fragen und nicht weniger:** Jede einzelne ist ein Punkt, an dem die Sache
scheitern kann. Frage 1 klärt die Wirtschaftlichkeit, 4 den versteckten Hauptkostenblock aus
Abschnitt 2.2, 5 die Frage, ob die Investition überhaupt liefert, was sie verspricht. Die offene
Nennung der eigenen Grösse in Absatz 2 ist Absicht — sie erspart eine Runde, in der ein
Enterprise-Paket für 200 Nutzer angeboten wird.

**Was mit der Antwort geschieht:** Die Zahl aus Frage 1 ersetzt ΔK in Abschnitt 2.1, die Antwort auf
Frage 4 präzisiert 2.2, und die Antwort auf Frage 5 entscheidet, ob Abschnitt 1 („was es nicht
löst") abgeschwächt werden kann. Danach ist die Rechnung in 3.1 keine Schätzung mehr.
