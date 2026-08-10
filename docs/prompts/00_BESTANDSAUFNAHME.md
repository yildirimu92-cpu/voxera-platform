# Bestandsaufnahme Prompt-Architektur

Stand 2026-08-10. **Diagnose, keine Umsetzung** — an keinem Prompt, keiner
Vorlage und keiner Konstante wurde etwas geändert.

Prüfgegenstand ist der Agent von **E2E Test AG** (`cust_1786034079785_z8voxt`,
`agent_0501kzc5wzy2emrr29hhx1cfzxzb`), Branchenvorlage `it-support`.

## Dateien

| Datei | Inhalt |
|---|---|
| `01_L1_master_prompt.txt` | L1 im Volltext, roh aus `system_config.prompt_master_l1` |
| `02_L2_branchenlayer.md` | L2 `generic` und `it-support` im Volltext, die übrigen 17 mit Zeichenzahl |
| `03_L3_kundenlayer_e2e_test_ag.txt` | L3 im Volltext — der vom Builder erzeugte Kunden-Layer |
| `04_finaler_prompt_e2e_test_ag.txt` | Der zusammengesetzte Prompt, so wie er an ElevenLabs geht |

## Wie belastbar diese Dateien sind

Die Layer wurden nicht abgeschrieben und nicht nachgebaut, sondern aus zwei
Quellen gelesen: `system_config` / `industry_templates` für die Vorlagen, und
`elevenlabs_sync_log.prompt_snapshot` für das Ergebnis. Der Snapshot wird nur
nach einem erfolgreichen Sync geschrieben und enthält denselben String, der im
PATCH an ElevenLabs stand.

Anschliessend wurde Datei 04 aus den Einzelteilen neu zusammengesetzt und gegen
die Datenbank geprüft:

```
md5(Datei 04)                        = 40be67b69f2f7809303d19ffe7d26d34
md5(prompt_snapshot ohne CR)         = 40be67b69f2f7809303d19ffe7d26d34
Länge beide                          = 17 236
```

Damit sind Datei 01, 03 und der `it-support`-Block in Datei 02 mitbewiesen: bei
einem Abschreibfehler in irgendeinem davon wäre die Summe nicht aufgegangen.

**Eine bewusste Abweichung:** Zeilenenden sind in den Dateien durchgehend LF.
Das Original ist gemischt — L1 trägt CRLF (264 CR), `it-support` ebenfalls (32
CR), Kunden-Layer und Kalenderblock reines LF. Der Prompt, der tatsächlich
rausgeht, ist deshalb 17 532 Zeichen lang, nicht 17 236. Inhaltlich identisch,
aber wer Zeichenzahlen vergleicht, muss wissen welche.

Referenz auf den geprüften Lauf: `elevenlabs_sync_log` `608a1fa3-9473-4d7c-a051-7621ba8cf9d9`,
2026-08-10 16:44:52 UTC, `status = success`, `md5(prompt_snapshot) = 69511b4dbbbd9e0c53db76e017bb5a6a`.

---

# Befund 1 (vorrangig): L1 sagt dem Agenten weiterhin, er habe ein Transfer-Werkzeug

## (a) Wird der Abschnitt in den finalen Prompt übernommen? — **Ja.**

Nicht hergeleitet, sondern im ausgelieferten Prompt gemessen:

```
Snapshot vom 16:44:52 (nach #921), Länge 17 532
  Position '## CALL FORWARDING'  = 6068
  Position 'transfer_call'       = 6095
  Position '## WEITERLEITUNGEN'  = 0   (nicht vorhanden)
```

Der Text steht vollständig drin — Tool-Nennung, zwei Transferbedingungen,
Etikette in vier Schritten, Fallbacksatz, fünf Verbote. Wortlaut in Datei 01,
Abschnitt `## CALL FORWARDING (Tool: transfer_call)`.

Der Weg dorthin ist geradlinig. `buildPromptV2()` behandelt L1 anders als die
beiden anderen Layer:

- `stripMasterMeta()` schneidet den Dokumentationskopf vor der ersten
  `---`-Zeile ab (701 Zeichen).
- `resolve()` ersetzt die `{{...}}`-Variablen.
- `neutralizePlaceholders()` läuft über L2 und L3, **nicht** über L1.
- Danach wird L1 unverändert zur Basis des Gesamtprompts.

Es gibt keine Stelle, die L1 inhaltlich filtert. Was in `system_config` steht,
geht raus.

**Damit trifft die Vermutung im Auftrag zu: #921 hat die halbe Wahrheit
hergestellt.** Die Oberfläche sagt „Demnächst", der Builder schweigt seit #921,
und L1 sagt dem Agenten weiterhin, er habe ein Werkzeug namens `transfer_call`.

Zwei Einschränkungen, die den Befund nicht entkräften, aber sein Ausmass
bestimmen:

1. L1 knüpft den Transfer an zwei Bedingungen, davon eine: „Kunden-Layer hat
   Ziel-Nummer konfiguriert". Bei E2E Test AG sind
   `ai_forwarding_1_number` und `ai_forwarding_2_number` beide `null`, und der
   Abschnitt `## WEITERLEITUNGEN` fehlt seit #921 ohnehin. Die Bedingung ist
   also unerfüllt — der Agent *sollte* nicht transferieren.
2. Die andere Bedingung lautet „Branchen-Layer hat das Anliegen als
   transferfähig definiert". Vier Vorlagen tun das in Prosa, darunter
   ausgerechnet `it-support`: **„Passwort gesperrt: … Weiterleiten."** Für ein
   Sprachmodell ist damit die halbe Bedingungskette erfüllt.

Was bleibt: ein Modell, dem ein Werkzeug beschrieben wird, das es nicht hat,
inklusive Formulierung für den Moment davor („Ich verbinde Sie kurz mit
[Bereich]."). Ob es diesen Satz je sagt, ist nicht belegt und lässt sich nur am
Telefon prüfen. Die Anweisung dazu steht im Prompt.

## Wie das durch #921 rutschen konnte

Der Kommentar, den ich in `prompt-builder-v2.js:270` hinterlassen habe, sagt:
„weder `transfer_to_number` noch eine vergleichbare Fähigkeit existiert
irgendwo im Repo". Der Satz stimmt — und ist die falsche Frage. L1 liegt nicht
im Repo, sondern in `system_config`. Die Suche, auf die ich mich berufen habe,
konnte den Text gar nicht finden. Aufgefallen ist es dem Betreiber, nicht mir.

Der Prompt-Text als Datenbankinhalt ist der blinde Fleck: jede Codesuche geht
daran vorbei, und der Fingerprint ändert sich bei einer Änderung an L1 zwar —
aber niemand liest den Text.

## (b) Existiert `transfer_call` in der Agentenkonfiguration? — **Von hier aus nicht beantwortbar.**

Was belegt ist:

- **Voxera stellt kein Transfer-Werkzeug bereit.** Repo-weite Suche nach
  `transfer_to_number|transfer_to_agent|system__transfer|forward_call|transfer_call`
  über alle `.js`, `.mjs`, `.html`, `.json`: **ein einziger Treffer**, und das
  ist mein eigener Kommentar aus #921. Keine Tool-Definition, kein Provisioning.
- **Bei der Agenten-Erstellung wird kein Werkzeug gesetzt.**
  `elevenlabs-provision-agent.js` setzt kein `tool_ids`.
- **Der Sync setzt genau ein Werkzeug** — das Kalender-Tool
  `manage_voxera_calendar` (`elevenlabs-sync.js:220-230`).

Was **nicht** belegt ist, und deshalb offenbleiben muss:

```js
// elevenlabs-calendar-tool.js:173
async function mergedAgentToolIds(agentId, requiredToolId) {
  const current  = await elevenLabsRequest('/agents/' + encodeURIComponent(agentId));
  const existing = current?.conversation_config?.agent?.prompt?.tool_ids;
  return [...new Set([...(Array.isArray(existing) ? existing : []), requiredToolId].filter(Boolean))];
}
```

Das ist eine **Vereinigung, kein Ersetzen**. Ein Werkzeug, das irgendwann im
ElevenLabs-Dashboard von Hand angehängt wurde, überlebt jeden Sync — der Code
entfernt nie etwas. Aus dem Repo lässt sich deshalb beweisen, dass Voxera nie
ein Transfer-Tool anhängt, aber nicht, dass keines dran ist.

Die Datenbank hilft nicht: es gibt keine Spalte und keine Tabelle, die die
Werkzeugliste eines Agenten spiegelt (geprüft über
`information_schema.columns`, Treffer nur `elevenlabs_agent_id`,
`elevenlabs_sync_log.agent_id`, `elevenlabs_sync_queue.agent_id`).

Es bleibt genau eine Quelle: die ElevenLabs-API. Dafür fehlt mir der
API-Schlüssel. Der Aufruf, der die Frage abschliessend beantwortet:

```bash
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" \
  https://api.elevenlabs.io/v1/convai/agents/agent_0501kzc5wzy2emrr29hhx1cfzxzb \
  | jq '.conversation_config.agent.prompt.tool_ids'
```

Erwartung nach Codelage: genau eine ID, die des Kalender-Tools. Steht dort mehr
als eine, ist die zweite von Hand entstanden und gehört angesehen.

**Bis dieser Aufruf gelaufen ist, gilt: unbelegt.** Nicht „vermutlich nicht
vorhanden".

---

# Zusammensetzung

## Reihenfolge

```
stripMasterMeta(L1)            Kopf vor der ersten '---'-Zeile abschneiden
        ↓  resolve({{...}})
      L1'                      Basis
        ↓  += '\n\n' + L2      Branchen-Layer  (resolve + neutralizePlaceholders)
        ↓  += '\n\n' + L3      Kunden-Layer    (neutralizePlaceholders je Abschnitt)
        ↓  += '\n\n' + Kalenderblock
      fullPrompt               → PATCH conversation_config.agent.prompt.prompt
```

Zwei Dinge daran sind nicht offensichtlich:

**Die Layer werden angehängt, nicht eingesetzt.** `buildPromptV2()` prüft, ob
L1 die Platzhalter `{{INDUSTRY_LAYER}}` und `{{CUSTOMER_LAYER}}` enthält, und
ersetzt sie dann. Der aktuelle L1-Text **enthält beide nicht** — er endet mit
`## PERSÖNLICHKEIT IN ZUSAMMENFASSUNG`. Es greift also durchgehend der
`else`-Zweig, das blosse Anhängen. Der Einsetz-Mechanismus existiert im Code
und ist heute tot. Wer L1 künftig umbaut und einen der beiden Platzhalter
einfügt, ändert damit unbemerkt die Reihenfolge des ganzen Prompts.

**Der Kalenderblock hängt hinter dem Builder.** Er kommt nicht aus
`buildPromptV2()`, sondern wird in `elevenlabs-sync.js` angefügt
(`[compiled.prompt, calendarBlock].join('\n\n')`). Er steht damit **hinter**
den `## VERBINDLICHE SICHERHEITSREGELN` — als letztes im Prompt.

Trennzeichen zwischen allen Blöcken: zwei LF (verifiziert über
`ascii(substring(...))` an den drei Übergängen — je 10, 10).

## Zeichenzahl pro Layer

Gemessen am Lauf von 16:44:52. Links wie ausgeliefert (mit CR), rechts
CR-bereinigt wie in den Dateien.

| Layer | Quelle | ausgeliefert | ohne CR | Anteil |
|---|---|---:|---:|---:|
| L1' (nach `stripMasterMeta`, aufgelöst) | `system_config.prompt_master_l1` | 8 479 | 8 215 | 48 % |
| L2 `it-support` | `industry_templates.prompt_block` | 1 227 | 1 195 | 7 % |
| L3 Kunden-Layer | von `buildPromptV2()` erzeugt | 6 812 | 6 812 | 39 % |
| Kalenderblock | `calendarPromptBlock()` | 1 008 | 1 008 | 6 % |
| Trennzeichen (3 × `\n\n`) | | 6 | 6 | |
| **Gesamt** | | **17 532** | **17 236** | |

L1 roh in `system_config`: 9 140 Zeichen. Davon werden 701 als
Dokumentationskopf abgeschnitten; der Rest wird durch die Variablenauflösung
etwas kürzer.

Zur Einordnung: **fast die Hälfte des Prompts ist branchenneutraler Text, den
kein Kunde und kein Admin je zu sehen bekommt.** Er wird ausschliesslich über
`system_config` gepflegt und hat keine Oberfläche.

## Wo die Feldlisten eingehängt werden

Zwei Feldschemata, beide mit derselben Form (`steps[].fields[]`), beide gelesen
von `branchFieldSchema()` und gerendert von `branchSchemaLines()`:

| | Schicht A (generisch) | Branchenfelder |
|---|---|---|
| Schema | `system_config.core_field_steps` (6 357 Z.) | `industry_templates.extra_steps` |
| Antworten | typisierte Kundenspalten, Allowlist `CORE_FIELD_COLUMNS` (17 Spalten) | `customers.ai_branch_extra`, Rückfall `[WIZARD]`-Zeile in `ai_internal_notes` |
| Ziel im Prompt | eigene Abschnitte **und** Sammelabschnitt | `{{schlüssel}}` in der Vorlage **oder** Sammelabschnitt |

Der Sammelabschnitt ist `## BETRIEBLICHE KONFIGURATION`, zusammengesetzt in
dieser Reihenfolge:

1. Schicht-A-Zeilen, ohne die elf Schlüssel, die weiter oben schon einen
   eigenen Abschnitt haben (Terminbefugnis, Buchungslink, Kurzbeschreibung,
   Adresse, die vier Preisteile, Leistungsliste, FAQ-Liste, Terminregeln)
2. die sechs kuratierten Sätze aus `operationalLines()`
3. Branchenfeld-Zeilen, ohne die von (2) verbrauchten und ohne die, die die
   Vorlage selbst als `{{schlüssel}}` platziert hat

Bei E2E Test AG bleibt davon genau eine Zeile übrig:
`Wann übernimmt der Assistent: Nur wenn niemand abhebt — …`.

Die Abschnitte mit eigenem Platz im Prompt, in Ausgabereihenfolge:
`UNTERNEHMENSBESCHREIBUNG`, `LEISTUNGEN`, `STANDORT UND ERREICHBARKEIT`,
`REGULÄRE ÖFFNUNGSZEITEN`, `REGELN RUND UM TERMINE`, `HÄUFIGE FRAGEN`,
`TERMINREGELN & HÄUFIGE FRAGEN`, `PREISAUSKUNFT`,
`AKTUELLE BETRIEBSINFORMATIONEN`, `AUFGABEN & ERFOLGSKRITERIUM`,
`PFLICHTINFORMATIONEN`, `TERMINBEFUGNIS`, `VERHALTEN BEI UNSICHERHEIT`,
`BETRIEBLICHE KONFIGURATION`, `KUNDENSPEZIFISCHE ANWEISUNGEN`,
`ESKALATION & FALLBACK`, `ANTWORTGRENZEN`, `WEITERLEITUNGEN` (seit #921
gesperrt), `NOTFALLNUMMER`, `ICH-FORM`, `VERBINDLICHE SICHERHEITSREGELN`.

## L3 hat keine eigene Vorlage

Wie im Auftrag vermutet: L3 ist kein gepflegter Text, sondern das Ergebnis von
`buildPromptV2()` (`prompt-builder-v2.js:779-1027`). Die Funktion liest rund 30
Kundenspalten plus die beiden Feldschemata und baut daraus die oben genannten
Abschnitte. Der Volltext für E2E Test AG steht in Datei 03.

Eingaben, die den Layer bestimmen:

- `customers.*` (Freitextspalten, typisierte Schicht-A-Spalten, `ai_branch_extra`)
- `customers.ai_internal_notes`, Zeile `[PROMPT_V2]` — Funktionsauswahl,
  Pflichtinformationen, Erfolgskriterium, Terminmodus, Unsicherheitsverhalten
- `customer_operational_updates` (veröffentlicht, noch nicht abgelaufen) —
  bei E2E Test AG leer
- `industry_templates.default_required_information` als Rückfall

---

# Weitere Befunde

Alle nur festgehalten. Nichts davon wurde angefasst.

## Befund 2: L1 verbietet genau das, was die Offenlegung tut

`## NAME UND IDENTITÄT` sagt:

> Aber auch nie proaktiv „ich bin ein Bot" sagen — nur auf direkte Nachfrage.

Die Begrüssung aus #919 sagt seit heute proaktiv „Sie sprechen mit einer
digitalen Assistentin". Beides steht im selben Prompt, rund 2 800 Zeichen
auseinander.

Der Widerspruch löst sich in der Praxis wahrscheinlich auf, weil die Begrüssung
als `first_message` gesetzt und nicht vom Modell formuliert wird — Anruf 1 und 2
haben das heute bestätigt. Aber die Regel steht weiter da und wirkt auf alles
danach.

Konkreter: die in L1 vorgegebene Antwort auf die direkte Frage lautet

> „Ich bin {{ASSISTANT_NAME}}, {{ASSISTANT_ROLE}} von {{CUSTOMER_DISPLAY_NAME}}.
> Ich nehme Ihr Anliegen auf und wir melden uns bei Ihnen."

Aufgelöst: *„Ich bin Umut, die Assistentin von E2E Test AG."* Auf die Frage
„sind Sie ein Bot oder ein Mensch?" beantwortet dieser Satz die Frage nicht.
Der Abschnitt ist mit „antwortest du ehrlich" überschrieben.

Das ist dieselbe Klasse wie C25, eine Ebene tiefer: die Erstansage ist seit
heute in Ordnung, die Rückfallantwort auf die ausdrückliche Nachfrage ist es
nicht.

## Befund 3: Die Sprachumschaltung hat keine Offenlegung

`## MEHRSPRACHIGKEIT` gibt zwei fertige Sätze vor:

> - Englisch: „Hello, this is Umut from E2E Test AG. This call is being recorded. How may I help you?"
> - Französisch: „Bonjour, ici Umut de E2E Test AG. Cet appel est enregistré. Comment puis-je vous aider?"

Beide legen die **Aufzeichnung** offen, aber nicht die **digitale Assistentin** —
also genau der Stand, den `buildGreeting()` bis zum 10.08. hatte. Die
`OFFENLEGUNG`-Tabelle im Builder hat für `en` und `fr` längst passende
Fassungen; dieser Text kennt sie nicht.

Bei E2E Test AG ist `ai_language = 'de'`, die Sätze sind hier also
theoretischer Natur. Für jeden Kunden mit `de_en` oder `de_en_fr` sind sie es
nicht.

## Befund 4: Zwei Platzhalter-Dialekte, nur einer wird neutralisiert

`neutralizePlaceholders()` ersetzt `{{...}}` und `[...]` — läuft aber nur über
L2 und L3. In L1 bleiben die eckigen Klammern stehen und gehen so raus:

```
„Ich verstehe, Sie möchten [Anliegen]. Ich leite das weiter."
„Grüezi, Herr/Frau [Nachname]. Wie kann ich Ihnen helfen?"
„Ich verbinde Sie kurz mit [Bereich]."
```

Hier ist das vermutlich Absicht — es sind Schablonen, die das Modell füllen
soll, keine unausgefüllten Vorlagenfelder. Trotzdem trägt dieselbe Syntax in
den drei Layern zwei verschiedene Bedeutungen, und eine davon wird stumm
ersetzt. Wer L1 künftig um einen echten Vorlagenplatzhalter erweitert, bekommt
ihn wörtlich vorgelesen.

## Befund 5: `## TERMINBEFUGNIS` widerspricht der gespeicherten Auswahl

Die `[PROMPT_V2]`-Zeile von E2E Test AG enthält `"appointmentMode":"request"` —
also „nur Terminanfrage aufnehmen, nichts bestätigen". Im ausgelieferten Prompt
steht die `direct`-Fassung: *„Du darfst einen Termin nur dann verbindlich
bestätigen, wenn das angebundene Kalenderwerkzeug die Buchung bestätigt hat."*

Das ist kein Fehler, sondern die Rangfolge aus J4: die typisierte Spalte
`ai_appointment_mode` (Schicht A) führt vor der Profilzeile, und dort steht
`direct`. Passt auch zum Kalender-Tool, das für diesen Kunden freigeschaltet
ist (`calendar_settings.feature_enabled = true`, Provider `google`).

Festgehalten wird es trotzdem: an zwei Orten stehen zwei verschiedene Antworten
auf dieselbe Frage, und welche gewinnt, weiss nur wer den Builder gelesen hat.
Die `[PROMPT_V2]`-Zeile ist damit stellenweise totes Datum, das aussieht wie
eine Einstellung.

## Befund 6: `## LEISTUNGEN` verspricht „Rufweiterleitung"

Im Kunden-Layer von E2E Test AG steht `Rufweiterleitung` als Leistung, und die
FAQ erklärt sie: *„Funktioniert Voxera mit bestehender Nummer? – Ja, durch
einfache Rufweiterleitung."*

Gemeint ist die Weiterleitung **zu Voxera hin** — ein Einrichtungsschritt beim
Kunden, keine Fähigkeit des Agenten. Für ein Sprachmodell, das im selben Prompt
einen Abschnitt `CALL FORWARDING` mit Werkzeugnennung liest, sind das zwei
Belege für dieselbe vermeintliche Fähigkeit. Kein eigener Fehler, aber ein
Verstärker für Befund 1.

## Befund 7: Der Prompt hat zwei Autoren und nur einer hat eine Oberfläche

L3 entsteht aus Feldern, die Kunde und Admin in einem Wizard ausfüllen, mit
Validierung, Bestätigungsschritten und einem Qualitätscheck. L1 — 48 % des
Prompts — ist ein Textfeld in `system_config`, das per SQL gepflegt wird. Kein
Formular, keine Versionierung, keine Vorschau, keine Prüfung.

Die Folge sind die Befunde 1 bis 4: alles vier sind Widersprüche zwischen L1 und
dem, was der Code inzwischen tut. L1 ist nicht mitgewachsen, weil es keinen Ort
gibt, an dem jemand es zu sehen bekommt.

---

# Was aussteht

1. **Der ElevenLabs-Aufruf oben** — die einzige offene Tatsachenfrage dieser
   Bestandsaufnahme.
2. **Entscheidung zu Befund 1.** Der Abschnitt `## CALL FORWARDING` aus L1 ist
   kein Codethema; er wird in `system_config` geändert, nicht in einem PR. Ob er
   entfernt oder an `WEITERLEITUNG_FREIGESCHALTET` gekoppelt wird, ist eine
   Produktentscheidung.
3. **Befund 2 und 3** hängen inhaltlich an C25 und gehören in dieselbe
   juristische Gegenlesung wie die Formulierung „digitale Assistentin".
