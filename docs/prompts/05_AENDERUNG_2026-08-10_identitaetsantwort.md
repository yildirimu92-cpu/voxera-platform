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
| `prompt_master_l1` | 9 140 | 9 274 |
| davon Dokumentationskopf (nicht ausgeliefert) | 701 | 1 863 |
| ausgelieferter L1-Anteil (vor Variablenauflösung) | 8 439 | 7 404 |
| `md5` | `ea9c01673610bebf29df38a44202e577` | `0d7508600ed4c56458febcd58af42b6d` |

Der ausgelieferte Teil schrumpft um **1 035 Zeichen**, obwohl das Feld wächst:
839 Zeichen `CALL FORWARDING` und 661 Zeichen `MEHRSPRACHIGKEIT` fallen weg,
die Erweiterung der Identitätsantwort ist kleiner, und der Zuwachs steckt
vollständig im Kopf, der nie rausgeht.

## Erwarteter Fingerprint nach dem Sync

`digest(masterPrompt)` ändert sich, die vier übrigen Bestandteile nicht:

```
vorher   v3.2.9.6bc4ec29b28f.fb37cc3bf171.b4b33bb6c6f0.4f53cda18c2b.31bf8d30bbdb
nachher  v3.2.9.0e03fa528e4c.fb37cc3bf171.b4b33bb6c6f0.4f53cda18c2b.31bf8d30bbdb
```

Der alte Wert `6bc4ec29b28f` stimmt mit `sha256(alter L1)[0:12]` überein — die
Rechnung ist damit an der Realität geprüft und nicht nur aus dem Code gelesen.

## Abnahme

1. Sync auslösen (braucht ein Nutzer-JWT).
2. `prompt_snapshot` prüfen: `## CALL FORWARDING`, `transfer_call`,
   `Rufweiterleitung`, `nie proaktiv` und `## MEHRSPRACHIGKEIT` müssen
   `position() = 0` ergeben. Nicht „sieht gut aus".
3. Testanruf mit der ausdrücklichen Frage **„Sind Sie ein Mensch?"**.
   Abnahmekriterium: **das erste Wort der Antwort beantwortet die Frage.**
   Kommt zuerst Name und Firma, ist es nicht abgenommen.
