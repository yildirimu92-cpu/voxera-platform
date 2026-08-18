# Änderung vom 2026-08-10 — Identitätsantwort, Sprachfassungen, CALL FORWARDING

Umgesetzt in der Produktionsdatenbank, nicht im Code. Betrifft
`system_config.prompt_master_l1` und zwei Felder von E2E Test AG.

Anlass: Befund 1, 2, 3 und 6 aus `00_BESTANDSAUFNAHME.md` (#928).

## Rückweg

Der Stand vor der Änderung liegt an **zwei** Orten:

1. **`system_config`, Schlüssel `prompt_master_l1__sicherung_2026-08-10_vor_c25_nachzug`**
   — byte-identisch inklusive CRLF, `md5 = ea9c01673610bebf29df38a44202e577`,
   9 140 Zeichen. Das ist der Rückweg für den Ernstfall: wer in der Datenbank
   sucht, findet ihn neben dem Original.
2. `01_L1_master_prompt_STAND_VOR_AENDERUNG_2026-08-10.txt` in diesem
   Verzeichnis — derselbe Text mit LF statt CRLF.

Zurückrollen:

```sql
update system_config
set value = (select value from system_config
             where key = 'prompt_master_l1__sicherung_2026-08-10_vor_c25_nachzug')
where key = 'prompt_master_l1';
```

Danach synchronisieren, sonst läuft der Agent weiter auf dem neuen Prompt.

## Was geändert wurde

### 1. `## NAME UND IDENTITÄT` — die Antwort beantwortet jetzt die Frage

**Vorher**

```
Du heisst {{ASSISTANT_NAME}}. Wenn ein Anrufer direkt fragt ob du ein Bot oder ein Mensch bist, antwortest du ehrlich:

„Ich bin {{ASSISTANT_NAME}}, {{ASSISTANT_ROLE}} von {{CUSTOMER_DISPLAY_NAME}}. Ich nehme Ihr Anliegen auf und wir melden uns bei Ihnen."

Danach normal weiter. Niemals lügen. Aber auch nie proaktiv „ich bin ein Bot" sagen — nur auf direkte Nachfrage.
```

**Nachher**

```
Du heisst {{ASSISTANT_NAME}}. Wenn eine anrufende Person wissen will, ob sie mit einem Menschen spricht — egal wie sie fragt („Sind Sie ein Bot?", „Sind Sie echt?", „Bin ich bei einem Automaten?") — antwortest du ausdrücklich:

„Nein, ich bin kein Mensch. Ich bin {{ASSISTANT_NAME}}, {{ASSISTANT_ROLE}} von {{CUSTOMER_DISPLAY_NAME}} — ein KI-System. Ich nehme Ihr Anliegen auf und wir melden uns bei Ihnen."

Danach normal weiter. Niemals lügen. Die Offenlegung am Gesprächsanfang steht in ERSTE NACHRICHT und ist verbindlich; wiederhole sie im Gesprächsverlauf nicht von dir aus, aber weiche einer Nachfrage nie aus.
```

Drei Entscheidungen dahinter:

- **„Nein" steht an Position 0.** Der Agent läuft mit
  `disable_first_message_interruptions: false`; Anrufende können jederzeit
  dazwischenreden. Wer nach zwei Sekunden nachhakt, hat die Antwort dann schon
  gehört. Dasselbe Prinzip wie die Voranstellung in `mitOffenlegung()`.
- **`{{ASSISTANT_ROLE}}` bleibt drin**, weil es das Genus trägt („die
  Assistentin" / „der Assistent"). Die Formulierung funktioniert mit beiden
  Stimmen.
- **Die Auslösebedingung ist breiter.** Vorher griff sie nur bei der wörtlichen
  Bot-Frage; das ist die seltenste Formulierung.

Die Zeile „nie proaktiv ‚ich bin ein Bot' sagen" ist ersatzlos entfallen — sie
widersprach seit #919 der Erstansage. Die Ersatzformulierung sagt stattdessen,
was gemeint war: nicht ständig wiederholen, aber einer Nachfrage nie ausweichen.

### 2. `## MEHRSPRACHIGKEIT` — vollständig entfernt

**Dieser Punkt wurde im Verlauf zweimal umgesetzt.** Zuerst als Reparatur der
Sätze, dann als ersatzlose Entfernung. Der zweite Stand gilt.

Zwischenstand (verworfen): die EN/FR-Sätze legten nur die Aufzeichnung offen,
nicht die digitale Assistentin — Stand vor #919. Sie wurden durch den Wortlaut
aus `OFFENLEGUNG` ersetzt und um Italienisch ergänzt.

Warum das falsch war: **die ElevenLabs-Agentenkonfiguration führt nur Deutsch.**
Mehrsprachigkeit ist gar nicht aktiv. Der Abschnitt wies also ein Verhalten an,
das die Plattform nicht vorsieht — und die beobachteten Sprachwechsel kamen aus
diesem Prompt, nicht aus der Spracherkennung. Die Sätze zu reparieren hiesse,
eine Anweisung zu pflegen, die nicht greifen darf.

Der Abschnitt ist deshalb ersatzlos entfernt, 661 Zeichen, wie
`## CALL FORWARDING`.

`{{SPRACHE}}` in `## PERSÖNLICHKEIT UND SPRACHE` bleibt und löst zu „Deutsch
(Standard)" auf — es steht jetzt keine widersprechende Anweisung mehr daneben.

**Wiedervorlage-Bedingung:** Der Abschnitt kommt zurück, sobald ein Kunde
mehrsprachig konfiguriert ist — dann aber über `{{BEGRUESSUNG_EN}}` /
`{{BEGRUESSUNG_FR}}` / `{{BEGRUESSUNG_IT}}` aus `buildGreeting()`, nicht als
abgeschriebene Sätze. Dann entsteht die Doppelquelle gar nicht erst.
Festgehalten in #929.

### 3. `## CALL FORWARDING (Tool: transfer_call)` — entfernt

839 Zeichen, ersatzlos. Entfernt statt an `WEITERLEITUNG_FREIGESCHALTET`
gekoppelt: die Konstante lebt im Builder, der Text in der Datenbank. Eine
Kopplung über zwei Ablageorte hinweg wäre dieselbe Bauform, die den Befund
verursacht hat.

Wieder aufnehmen, wenn es die Funktion gibt — nicht vorher.

### 4. Kundendaten E2E Test AG

Der Auftrag nannte `## LEISTUNGEN` als Teil von `system_config`. Das trifft
nicht zu: der Abschnitt entsteht aus `customers.ai_services`. Geändert wurden
deshalb zwei Kundenfelder, nicht der Master-Prompt.

| Feld | vorher | nachher |
|---|---|---|
| `ai_services` | letzte Zeile `Rufweiterleitung` | Zeile entfernt |
| `ai_booking_faq` | „…, durch einfache **Rufweiterleitung**, Kunden rufen weiterhin…" | „…, indem Sie Ihre bestehende Nummer auf Voxera **umleiten**, Kunden rufen weiterhin…" |
| `ai_booking_faq` | „…innerhalb 24 Stunden, **Rufweiterleitung** 5 Minuten" | „…innerhalb 24 Stunden, **Umleitung Ihrer Nummer** 5 Minuten" |

Die dritte Zeile stand in keiner der bisherigen Aufzählungen — sie kam beim
Nachzählen zum Vorschein, nachdem die ersten beiden erledigt waren. Dieselbe
Regel, gleich mit angewandt: die Richtung muss eindeutig sein, Weiterleitung
**zu** Voxera hin, nicht **durch** Voxera.

Danach: `position('Rufweiterleitung' in …) = 0` in `ai_services`,
`ai_booking_faq`, `ai_instructions`, `ai_business_description`,
`ai_location_hours`, `ai_fallback_escalation`, `ai_response_constraints`.

### 4b. `## FILLER-VARIANZ` entfernt und die Klammer-Konvention aufgelöst

Nachtrag desselben Tages, ausgelöst durch einen Testanruf.

**Der Beleg.** Nach dem Abschalten der drei Audio-Tags (*Geduldig*,
*Einfühlsam*, *Herzlich*) in der Stimmkonfiguration klammerte der Agent weiter:

```
[Verstanden] Gerne, wir können…
[Einen Moment] Ich verstehe…
[Gut] Merci…
[Habe ich] Umut Sivderin, ist notiert
[Sind] Sind Sie noch da?
```

Die geklammerten Wörter sind die fünf Filler aus `## FILLER-VARIANZ`, nicht die
Namen der Audio-Tags. Und `[Sind] Sind Sie noch da?` klammert das erste Wort des
eigenen Satzes und wiederholt es — Formimitation der eckigen Klammern aus L1,
keine Regieanweisung. Die Tags haben verstärkt, nicht ausgelöst.

**Was geändert wurde:**

- `## FILLER-VARIANZ` (223 Zeichen) ersatzlos entfernt. Die Regel erzeugte, was
  sie verhindern sollte: sie forderte Pausenphrasen ein, also benutzte das
  Modell sie ständig. Ersatz ist ein Satz in `## PERSÖNLICHKEIT UND SPRACHE`:
  *„Wiederhole nicht zweimal hintereinander dieselbe Bestätigungsformel."* Keine
  Liste, keine Beispiele.
- Die fünf Klammer-Platzhalter sind weg — nicht durch eine andere Schreibweise
  ersetzt, sondern durch **Beschreibung statt Skript**:

  | vorher | jetzt |
  |---|---|
  | `„von [Firma]" = Firma, nicht Name.` | Eine Nennung mit „von …" bezeichnet die Firma, nicht den Namen. |
  | `„Grüezi, Herr/Frau [Nachname]. …"` | Begrüsse die Person beim ersten Mal mit „Grüezi", der Anrede und ihrem Nachnamen, dann die Frage nach dem Anliegen. |
  | `FALSCH: „Habe ich, Herr/Frau [Nachname]..."` | FALSCH bei erster Nennung: mit einer Bestätigungsfloskel einsteigen statt zu begrüssen. |
  | `„Habe ich Sie richtig verstanden, Herr/Frau [Name]?"` | Aktiv bestätigen: den verstandenen Namen mit Anrede wiederholen und fragen, ob er richtig ist. |
  | `„Ich verstehe, Sie möchten [Anliegen]. …"` | Vor der Rückruf-Frage das Anliegen in einem Satz bestätigen und ankündigen, dass du es weiterleitest. |

- Eine Zeile in `## ANTI-HALLUZINATION (KRITISCH)`:
  *„Gib niemals Text in eckigen Klammern aus und sprich ihn nicht — weder als
  Regieanweisung, Emotionsangabe noch als Platzhalter"*.

**Warum keine Ersatz-Notation.** `<Nachname>` oder `NACHNAME` verschieben das
Problem nur: jede Slot-Schreibweise ist eine Konvention, und die Beobachtung
sagt gerade, dass Konventionen imitiert werden. Konkrete Beispielnamen wären am
schlechtesten — der Fehlerfall wäre dann „Grüezi, Frau Meier" an jemanden, der
nicht so heisst, also eine plausibel klingende Falschaussage statt eines
offensichtlich kaputten Platzhalters. Zwei Abschnitte weiter oben steht
ausdrücklich, `{{CUSTOMER_DISPLAY_NAME}}` sei niemals der Name des Anrufers;
einen erfundenen Anrufernamen in denselben Prompt zu schreiben arbeitet dagegen.

Die Regel nennt bewusst **kein** Beispiel und erklärt die Konvention nicht — das
hätte sie ein sechstes Mal vorgeführt.

### 4c. Woher Klammern sonst noch kommen könnten — vorab gezählt

Damit die Frage nach dem nächsten Anruf schon beantwortet ist, statt dann erst
gestellt zu werden. Gezählt mit derselben Regex wie `BRACKET_PLACEHOLDER`
(`\[[^\]\n]{1,80}\]`):

| Quelle | Treffer | neutralisiert? |
|---|---:|---|
| L2 `generic` | **0** | ja (`neutralizePlaceholders`) |
| L2 `it-support` | **0** | ja |
| L2, alle 19 `prompt_block` zusammen | **0** | ja |
| L2, alle 19 `default_required_information` | **0** | ja |
| L3 ausgeliefert (E2E Test AG) | **0** | ja, über `add()` |
| L1 ausgeliefert, **vorher** | **5** | **nein** |
| L1 ausgeliefert, **nachher** | **0** | entfällt |

Damit ist belegt: **alle fünf Klammerausdrücke im bisherigen Prompt stammten aus
L1.** `[Anliegen]`, `[Bereich]`, `[Firma]`, `[Nachname]` ×2, `[Name]` — mehr gab
es im gesamten 17 532-Zeichen-Prompt nicht.

Zwei Quellen, die heute nichts liefern, es aber könnten:

1. **`formatOperationalUpdates()`** erzeugt Klammern **per Bauart**:
   `- [Ferien / geschlossen] Titel | gültig ab …`. Diese Zeilen laufen
   ausdrücklich **nicht** durch `neutralizePlaceholders()` (Kommentar im Code:
   die Klammern sind dort Typmarke). Aktive Betriebsinformationen: derzeit
   **0**. Legt jemand eine an, sind die Klammern zurück — dann aber an einer
   Stelle, an der sie beabsichtigt sind.
2. **`ai_internal_notes`** enthält vier Klammerausdrücke (`[WEBSITE_ANALYSIS]`,
   `[PROMPT_V2]` und zwei JSON-Arrays). Die erreichen den Prompt nicht:
   `parseMarkedJson()` liest die Zeilen und gibt nur den geparsten Inhalt
   weiter.

**Wenn nach dem nächsten Anruf trotzdem Klammern auftauchen**, kann es an keinem
Layer liegen — dann kommt das Muster aus dem Modell selbst, und die Antwort ist
nicht mehr Prompt, sondern Modell- oder Stimmkonfiguration.

Nebenbefund für später, nicht heute: die 19 Branchenvorlagen tragen in ihren
**Startwerten** (`default_location_hours`, `default_booking_faq`,
`default_services`) zusammen **85** Klammerausdrücke. Die werden beim Anlegen
eines Kunden in dessen Spalten kopiert und dort neutralisiert — der Agent hört
also nicht `[Strasse, PLZ Ort]`, sondern „nicht hinterlegt; nicht erwähnen".
Kein Klammerproblem, aber eine Textstelle, die niemand so geschrieben hat.

### 5. Vermerk im Dokumentationskopf, nicht im Prompt

Die Vorgabe lautete, den Kopie-Vermerk „im L1-Text selbst" festzuhalten, nicht
nur im Ticket. Er steht jetzt im **Dokumentationskopf vor der ersten
`---`-Zeile** — dort, wo schon die Variablenliste steht.

Der Grund für diese Abweichung: alles **nach** dem Trenner geht an das
Sprachmodell. Ein Vermerk an der Fundstelle hätte bedeutet, dass der Agent bei
jedem Anruf rund 600 Zeichen interne Bearbeitungshinweise mitliest — genau das
Problem, gegen das `stripMasterMeta()` gebaut wurde, als 700 Zeichen
Dokumentation bei jedem Sync an den Agenten gingen.

Der Kopf erfüllt beide Anforderungen: wer `prompt_master_l1` öffnet, sieht ihn
als Erstes, und ausgeliefert wird er nie. Verifiziert: die Wörter
`MEHRSPRACHIGKEIT`, `Englisch` und `Französisch` kommen nur noch an den
Positionen 744, 796 und 810 vor — der Trenner steht bei 1864, sie liegen also
alle im Kopf.

Inhalt: warum `## CALL FORWARDING` und `## MEHRSPRACHIGKEIT` entfernt wurden,
unter welcher Bedingung Mehrsprachigkeit zurückkommt und in welcher Form, und
wo die Sicherung liegt.

## Zahlen

| | vorher | nachher |
|---|---:|---:|
| `prompt_master_l1` | 9 140 | 9 363 |
| davon Dokumentationskopf (nicht ausgeliefert) | 701 | 1 863 |
| ausgelieferter L1-Anteil (vor Variablenauflösung) | 8 439 | 7 493 |
| eckige Klammern im ausgelieferten Teil | 5 | **0** |
| `md5` | `ea9c01673610bebf29df38a44202e577` | `b520b02846067252f2332d16573265c3` |

Der ausgelieferte Teil schrumpft um **946 Zeichen**, obwohl das Feld wächst:
839 Zeichen `CALL FORWARDING`, 661 Zeichen `MEHRSPRACHIGKEIT` und 223 Zeichen
`FILLER-VARIANZ` fallen weg; dagegen stehen die längere Identitätsantwort, die
ausformulierten Anrede-Regeln und die neue Klammer-Zeile. Der Zuwachs des Feldes
steckt vollständig im Kopf, der nie rausgeht.

## Erwarteter Fingerprint nach dem Sync

`digest(masterPrompt)` ändert sich, die vier übrigen Bestandteile nicht:

```
vorher   v3.2.9.6bc4ec29b28f.fb37cc3bf171.b4b33bb6c6f0.4f53cda18c2b.31bf8d30bbdb
nachher  v3.2.9.e35458c9a757.fb37cc3bf171.b4b33bb6c6f0.4f53cda18c2b.31bf8d30bbdb
```

Der alte Wert `6bc4ec29b28f` stimmt mit `sha256(alter L1)[0:12]` überein — die
Rechnung ist damit an der Realität geprüft und nicht nur aus dem Code gelesen.

## Abnahme

1. Sync auslösen (braucht ein Nutzer-JWT).
2. `prompt_snapshot` prüfen: `## CALL FORWARDING`, `transfer_call`,
   `Rufweiterleitung`, `nie proaktiv`, `## MEHRSPRACHIGKEIT`,
   `## FILLER-VARIANZ` und die fünf Klammerausdrücke müssen `position() = 0`
   ergeben. Nicht „sieht gut aus".
3. Testanruf mit der ausdrücklichen Frage **„Sind Sie ein Mensch?"**.
   Abnahmekriterium: **das erste Wort der Antwort beantwortet die Frage.**
   Kommt zuerst Name und Firma, ist es nicht abgenommen.

---

## Nachtrag 3 — Personenfragen, „weiterleiten", und was Testanrufe aufgedeckt haben

Zwei weitere Runden am selben Abend, je ein Anruf dazwischen.

### Runde 2: Auslösebedingung war zu breit

`„egal wie sie fragt"` hob die Einschränkung wieder auf, die der Rest der
Bedingung machte. Auf die Frage *„ich hab de Herr Hildring, isch er grad ome?"*
— eine Frage nach einer **dritten Person** — antwortete der Agent mit der
vollen Offenlegung.

Nach der Verengung kam der Fehlalarm nicht mehr, dafür der Spiegelfall: auf
*„ich hab den Patrick g'sucht"* antwortete er mit *„Wir können Sie nicht direkt
mit Herrn Patrick verbinden"* — eine Absage auf eine Bitte, die niemand
geäussert hatte. Dieselbe Wurzel: die Personenfrage wird als etwas anderes
gedeutet, weil für sie keine Regel existiert.

Endstand:

```
Du heisst {{ASSISTANT_NAME}}. Fragt eine anrufende Person, ob du ein Mensch oder eine Maschine bist — sinngemäss in jeder Formulierung, etwa „Sind Sie ein Bot?", „Sind Sie echt?", „Bin ich bei einem Automaten?", „Rede ich mit einem Computer?" — antwortest du ausdrücklich:

„Nein, ich bin kein Mensch. Ich bin {{ASSISTANT_NAME}}, {{ASSISTANT_ROLE}} von {{CUSTOMER_DISPLAY_NAME}} — ein KI-System. Ich nehme Ihr Anliegen auf und wir melden uns bei Ihnen."

Das gilt ausschliesslich für Fragen über dich selbst. Fragen nach einer anderen Person — ob jemand da, erreichbar oder im Haus ist, oder dass jemand gesucht wird — sind gewöhnliche Anliegen. Antworte darauf weder mit der Offenlegung noch mit einer Absage, um die niemand gebeten hat. Frage nach, worum es geht, und nimm das Anliegen auf.
```

Zwei bewusste Entscheidungen im Ausnahmesatz: „um die niemand gebeten hat"
statt „Weiterleitungs-Absage", damit das Wort nicht erneut vorgesprochen wird;
und ein Schlusssatz, der sagt was **stattdessen** zu tun ist — ohne den greift
das Modell wieder zur nächstbesten Formulierung, und genau das war beide Male
der Fehler.

### „weiterleiten" an drei Stellen entfernt

Aufgefallen an einem generierten Satz: *„Wir werden Ihr Anliegen an Herrn
Hildirin weiterleiten."* Fachlich korrekt, aber es weckt genau die Erwartung,
die mit `## CALL FORWARDING` abgeräumt wurde.

| Ort | vorher | jetzt |
|---|---|---|
| L1 `## RÜCKRUF-HANDLING` | „…ankündigen, dass du es weiterleitest." | „…ankündigen, dass wir uns dazu melden." |
| L1 Vermeiden-Liste | — | neue Zeile „weiterleiten" → „wir melden uns" |
| L2 `it-support` | „…aufnehmen. Weiterleiten." | „…aufnehmen. Wir melden uns." |

Die L1-Zeile stammte aus der Umformulierung von `[Anliegen]` weiter oben in
diesem Dokument — das Wort wurde beim De-Skripten mitgenommen, statt bei der
Gelegenheit zu verschwinden. Die `it-support`-Zeile ist dieselbe, die in
`00_BESTANDSAUFNAHME.md` als „erfüllt die halbe Bedingungskette von CALL
FORWARDING" markiert war.

Erstmals ändern sich damit **zwei** Fingerprint-Bestandteile:

```
v3.2.9.3838eef544d7.a9810bac4966.b4b33bb6c6f0.4f53cda18c2b.31bf8d30bbdb
       ^^ L1        ^^ it-support
```

Gegenprobe an einem nicht angefassten Bestandteil:
`sha256(core_field_steps)[0:12]` = `b4b33bb6c6f0` = dritte Komponente des
gespeicherten Fingerprints. Die Rechenmethode ist damit an einem Wert geprüft,
der sich nicht ändern durfte.

Verifiziert im Snapshot vom 20:12:34 (17 078 Zeichen): alte Bedingung `0`,
`eiterleit` genau **1** Treffer (die Vermeiden-Zeile selbst), Klammern `0`,
`Einen Moment` `0`, Fingerprint-Gleichheit `true`.

### Offene Beobachtungen aus denselben Anrufen

Keine davon ist eine Prompt-Sache; alle drei nur festgehalten.

1. **Soft-Timeout bestätigt und abgeschaltet.** Die Gegenprobe kam aus dem
   Anruf: „Einen Moment" nur noch zweimal, beide Male nach einer langen
   Buchstabier-Passage, nie bei schnellen Antworten. Zeitschwelle, kein
   Sprachverhalten. Quelle war `soft_timeout_config` im `AGENT_TEMPLATE`
   (`timeout_seconds: 3`, `message: 'Einen Moment'`,
   `use_llm_generated_message: false`) — nicht `## FILLER-VARIANZ`, das den
   String nur ein zweites Mal führte.

2. **Turn-Taking bricht Sätze ab** — Begrüssung startet neu, angefangene Sätze
   werden verworfen, ein Anrufer legte mit „das ist nervig" auf. Verdächtig
   sind `speculative_turn: true`, `turn_eagerness: 'eager'` und
   `background_voice_detection: false`, zusammen mit
   `disable_first_message_interruptions: false`. **Vermutlich verschärft durch
   das Abschalten des Soft-Timeouts:** „Einen Moment" war auch ein
   Zughaltesignal. Ohne es entstehen bei 3,1 s Latenz drei Sekunden Stille, der
   Anrufer setzt neu an, und im selben Moment ist die Antwort fertig. Der
   Filler kaschierte ein Latenzproblem; sein Wegfall hat es sichtbar gemacht.
   Der Schluss daraus ist nicht, ihn zurückzuholen, sondern die Latenz zu
   senken — Turn V3 und Scribe v2 sind in Erprobung.

3. **„Grüezi HerrHildringen"**, ohne Leerzeichen. Vermutlich Kehrseite des
   De-Skriptens: die alte Zeile zeigte „Grüezi, Herr/Frau [Nachname]." und
   damit auch Komma und Abstand. Die Ersatzformulierung ist eine Aufzählung
   ohne Zeichensetzung. Kandidat für eine isolierte Runde — Beschreibung **und**
   Trennzeichenangabe, weiterhin ohne Slot. Ob die Lücke schon im Text fehlt
   oder erst im Klang, entscheidet ein Blick ins Transkript.
