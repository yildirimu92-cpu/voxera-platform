# N6 — Warum die Weiterleitungs-Selbstbearbeitung nicht zuverlässig synct

**Diagnose und Behebung, 2026-08-09.** Grundlage: `main` @ `bb72cd2`.
Vorgeschichte: `docs/ELEVENLABS_SYNC_SCHREIBPFAD_DIAGNOSE_2026-08-09.md` (S6),
`docs/ETAPPE_6_BRIEFINGS_2026-08-08.md` (N6), `docs/ASSISTENT_TAB_IA_DIAGNOSE_2026-08-09.md`.

## Kurzantwort

Es war kein stiller Fehler, kein falscher Trigger und kein Timing-Problem. Es
war eine **Klassifikation nach Feldnamen statt nach Wirkung** — und der Name,
nach dem klassifiziert wurde, bezeichnet in `customers` zwei verschiedene Dinge.

`customer-update-assistant.js` entschied über eine Liste `FORWARDING_FIELDS`, ob
nach einem Kunden-Speichervorgang ein ElevenLabs-Sync ausgelöst wird, und
schloss genau die sieben Spalten aus, die als Abschnitte WEITERLEITUNGEN und
NOTFALLNUMMER im Prompt stehen.

---

## Teil A — Die Namensverwechslung

`customers` trägt zwei Begriffe mit demselben Wort:

| Spalten | Bedeutung | Prompt-relevant |
|---|---|---|
| `forwarding_setup_completed`, `forwarding_status`, `forwarding_mode`, `last_confirmed_forwarding_mode` | **Rufumleitung**: der Kunde stellt bei Swisscom/Sunrise/Salt ein, dass seine Nummer auf die Voxera-Nummer umleitet. Geschrieben von `customer-update-settings.js`. | nein |
| `ai_forwarding_1_name/_number/_trigger`, `ai_forwarding_2_*`, `ai_emergency_number` | **Weiterverbindung**: an wen der Assistent *im Gespräch* durchstellt, und unter welcher Bedingung. | **ja** |

Die zweite Gruppe steht im Prompt:

- `prompt-builder-v2.js:313-317` — Abschnitte `## WEITERLEITUNGEN` und `## NOTFALLNUMMER`
- `prompt-builder-v2.js:38-42, 295` — `ai_emergency_number` füllt zusätzlich die
  Variable `{{notfallnummer_lebensgefahr}}`

Die Diagnose vom Vormittag hat das als S6 bereits notiert („Die Annahme hinter
der Ausnahme — Weiterleitung sei reine Telefonie-Konfiguration — stimmt nicht").
Der Grund für die falsche Annahme ist die Namensgleichheit: Wer `FORWARDING_FIELDS`
schrieb, hatte die richtige Regel („Telefonie-Setup braucht keinen Sync") und hat
sie auf die falsche Spaltengruppe angewendet. Die Liste steht seit dem ersten
Commit (`c963f3b`) unverändert im Code.

## Teil B — Warum „unzuverlässig" und nicht „nie"

Der Ausschluss war keine harte Sperre, sondern eine Weiche:

```js
const hasForwardingChange    = patchKeys.some((k) =>  FORWARDING_FIELDS.includes(k));
const hasNonForwardingChange = patchKeys.some((k) => !FORWARDING_FIELDS.includes(k));
if (hasNonForwardingChange && customer.elevenlabs_agent_id) { …sync… }
```

Der Sync liest den Kunden anschliessend komplett neu aus der Datenbank. Kommt in
derselben Anfrage **irgendein** anderes Feld mit, läuft der Sync — und nimmt die
Weiterleitungsänderung mit. Kommt sie allein, passiert nichts.

Gemessen an der echten Funktion (Stand `bb72cd2`, Details in Teil D):

| Was der Kunde speichert | `sync_status` | Sync läuft |
|---|---|---|
| nur Weiterleitung | `skipped_forwarding_only` | **nein** |
| Weiterleitung **+** Leistungen | `success` | ja |
| nur SMS-Einstellungen | `success` | ja (unnötig, S11) |

Dieselbe Oberfläche, derselbe Knopf, dieselbe Änderung — zwei Ergebnisse, je
nachdem was sonst noch im Formular stand. Das ist die Unzuverlässigkeit.

**Und sie war still.** Der Endpoint antwortete HTTP 200 mit `success: true`. Die
alte Oberfläche quittierte grün mit „Weiterleitungsdaten gespeichert."
(`vxBuildAssistantSaveFeedback`, `index.html`), die neue kennt
`skipped_forwarding_only` gar nicht und lässt es als „✓ Gespeichert." durch
(`customer-runtime-assistant-profile.js:801-808`). Der Kunde bekam eine
Erfolgsmeldung für eine Änderung, die den Agenten nie erreicht hat — dieselbe
Fehlerklasse wie der Mail-Versand-Fund und wie G3 aus der Freitextfelder-Diagnose.

## Teil C — Was noch daran hing

**C1 · Die Kehrseite derselben Weiche (S11).** `notification_mode` und die sechs
`sms_*`-Spalten stehen in keinem Prompt, galten aber als
„nicht-Weiterleitung" und lösten deshalb jedes Mal einen vollen Prompt-Rebuild
plus ElevenLabs-PATCH aus. Ein und dieselbe fehlende Feldklassifikation, in beide
Richtungen falsch.

**C2 · Die Plan-Sperre wies weich ab.** `forwarding_not_allowed_on_plan` landete
im `errors`-Array und der Speichervorgang lief mit HTTP 200 weiter — während Ton,
Name und Stimme mit 403 abweisen. Ein abgelehntes Feld, das als Teilerfolg
quittiert wird, ist derselbe stille Fehlschlag.

**C3 · Der Plan-Name stand im Endpoint.** `canEditForwarding = planCode === 'professional'`
— verdrahtet, während die Nachbarregeln (Ton, Name, Stimme) längst aus
`plan_config` kommen. Das Frontend hatte gar keine Möglichkeit zu erfahren, ob
der Kunde bearbeiten darf.

**C4 · Die Nummer war ungeprüfter Freitext.** Was der Kunde tippt, steht als
Wahlanweisung im Prompt. „079 123 45 67" ist für einen Menschen eine Nummer, für
eine Weiterverbindung nicht unbedingt.

**C5 · Das Sync-Log konnte den Nachweis nicht führen.** Der S9-Fix schreibt
`prev_values`, aber der Insert-Fallback warf bei jedem Fehler `changed_fields`
gleich mit weg. Am 09.08. um 14:22 UTC fehlte die Spalte `prev_values` in
Produktion tatsächlich (gemessen, `column "prev_values" does not exist`), um
14:41 war sie da — sie wurde während dieser Arbeit von Hand nachgezogen. Der
Fallback hätte in diesem Fenster den Diagnosewert des Logs stillschweigend
mitentsorgt. Zusätzlich schickte ausgerechnet der Kundenpfad
(`customer_self_edit`, 16 der 20 Log-Zeilen) gar keine `prev_values` — für genau
den Pfad, um den es hier geht, war das Log also stumm.

## Teil D — Behebung

### D1 · Klassifikation nach Wirkung statt nach Namen

Neu: `customer-dashboard/netlify/functions/_lib/assistant-write-policy.js`.
`PROMPT_RELEVANT_FIELDS` listet die `customers`-Spalten, die `buildPromptV2()`
liest, plus `voice_id` (das der Sync selbst verwendet). Ein Sync läuft genau
dann, wenn eine geschriebene Spalte darin vorkommt.

Damit fällt `skipped_forwarding_only` ersatzlos weg, und C1 verschwindet in
derselben Bewegung.

### D2 · Der Guard prüft die Fehlerklasse, nicht die Feldnamen

`scripts/verify-forwarding-self-edit-sync.mjs` liest aus `prompt-builder-v2.js`,
welche Spalten der Prompt tatsächlich verwendet, aus
`customer-update-assistant.js`, welche davon der Kunde schreiben kann, und
scheitert, sobald eine Spalte in beiden Mengen liegt, aber nicht als
sync-auslösend gilt. Ein künftiges neues Prompt-Feld ohne Sync fällt damit auf,
unabhängig davon, wie es heisst. Die Gegenrichtung ist mitgeprüft: kein Eintrag
in der Liste, den niemand liest.

### D3 · Die übrigen Punkte

- C2: Plan-Sperre antwortet mit 403 wie ihre Nachbarn.
- C3: Die Regel steht einmal, in der Policy-Datei; das Profil liefert
  `permissions.can_change_forwarding`, das Frontend kennt keinen Plan-Namen.
- C4: Weiterleitungsnummern laufen durch `normalizePhoneE164` und werden als
  E.164 gespeichert; Unbrauchbares wird mit `forwarding_number_invalid`
  abgewiesen, statt in den Prompt zu wandern. Die Notfallnummer bleibt bewusst
  ungeprüft — 144 und 112 fallen durch jede E.164-Prüfung.
- C5: Der Log-Insert fällt stufenweise zurück (voll → ohne `prev_values` → ohne
  beides), statt bei jedem Fehler alles zu verwerfen. `customer_self_edit`
  schickt jetzt `prev_values`. `diffPrevValues` normalisiert jsonb-Spalten, sonst
  meldete `ai_branch_extra` bei jedem Sync ein Phantom-Diff. Die fehlende DDL
  liegt als `supabase/sql/2026-08-09_elevenlabs_sync_log_prev_values.sql` im Repo
  nach.
- Die tote `vxBuildAssistantSaveFeedback()` in `index.html` ist entfernt: seit
  dem Löschen des Alt-Screens (S1) unerreichbar, und sie trug den Kern des
  Workarounds — die grüne Quittung für einen nicht gelaufenen Sync.

## Teil E — Verifikation am Wegwerf-Kunden

Angelegt in Produktion: `cust_n6_verify_20260809` („Wegwerf Sanitaer AG"), Plan
`professional`, mit `elevenlabs_agent_id = 'agent_n6_verify_stub'`. Keine
Weiterleitung gesetzt, `ai_emergency_number` `144`.

Auf **diese echte Zeile** wurden beide Fassungen des Handlers angewandt — aus
`bb72cd2` und aus dem Arbeitsbaum, jeweils die echte Funktion geladen, nicht
nachgebaut. Attrappe waren nur Supabase, die Auth-Prüfung und der HTTP-Aufruf zu
`trigger-elevenlabs-sync`; die ElevenLabs-API wurde nicht angefasst.

Gesendet: `{ ai_forwarding_1_name, ai_forwarding_1_number: "079 123 45 67",
ai_forwarding_1_trigger }` — eine reine Weiterleitungsänderung.

| | HTTP | `sync_status` | Sync aufgerufen | gespeicherte Nummer |
|---|---|---|---|---|
| alt (`bb72cd2`) | 200 | `skipped_forwarding_only` | **nein** | `079 123 45 67` |
| neu | 200 | `success` | **ja** | `+41791234567` |

Der Sync-Aufruf der neuen Fassung, wörtlich mitgeschnitten:

```json
{
  "customer_id": "cust_n6_verify_20260809",
  "agent_id": "agent_n6_verify_stub",
  "triggered_by": "customer_self_edit",
  "prev_values": {
    "ai_forwarding_1_name": null,
    "ai_forwarding_1_number": null,
    "ai_forwarding_1_trigger": null
  }
}
```

Der Patch wurde anschliessend auf die echte Zeile geschrieben, die echte
`diffPrevValues()` darauf angewandt und das Ergebnis als echte Zeile in
`elevenlabs_sync_log` eingefügt. Zurückgelesen aus Produktion:

```
triggered_by   customer_self_edit
changed_fields {"ai_forwarding_1_name":"Pikettdienst Meier",
                "ai_forwarding_1_number":"+41791234567",
                "ai_forwarding_1_trigger":"bei Wasserschaden ausserhalb der Bürozeiten"}
prev_values    {"ai_forwarding_1_name":null,"ai_forwarding_1_number":null,
                "ai_forwarding_1_trigger":null}
```

Damit ist die in der Sync-Diagnose vorgesehene Verifikationsmethode für den
Kundenpfad erstmals durchführbar: aus dem Log ist ablesbar, **welches Feld** den
Sync ausgelöst hat.

Was der Agent bekommt, mit dem echten `buildPromptV2` gegen die echte Zeile
gerechnet (Layer 1 und 2 weggelassen — sie sind vorher und nachher identisch,
der ganze Unterschied liegt im Kunden-Layer):

```
vorher:  (kein Abschnitt WEITERLEITUNGEN im Prompt)

nachher: ## WEITERLEITUNGEN
         Nutze nur die tatsächlich konfigurierte Weiterleitungsfunktion:
         - Pikettdienst Meier: +41791234567 (bei: bei Wasserschaden ausserhalb der Bürozeiten)

Kunden-Layer: 1115 → 1285 Zeichen
```

Die Weiche selbst, an denselben zwei Fassungen gemessen:

| gesendete Felder | alt | neu |
|---|---|---|
| nur Weiterleitung | kein Sync | **Sync** |
| Weiterleitung + `ai_services` | Sync | Sync |
| nur `sms_*` | Sync (unnötig) | **kein Sync** |

Der Testkunde und seine Log-Zeile wurden gelöscht; Produktion steht wieder bei
4 Kunden und 20 Log-Zeilen, wie vor dem Test. Sonst wurde nichts verändert.

### Regressionsschutz

`scripts/verify-forwarding-self-edit-sync.mjs` (61 Prüfungen), eingebunden über
`.github/workflows/verify-forwarding-self-edit-sync.yml`. Gegenprobe gegen
`bb72cd2`: 14 Prüfungen scheitern, darunter alle drei zur Sync-Entscheidung.
Voller Verifier-Sweep grün (Grundsatz 14); `verify-db-security-invariants`
scheitert unverändert an fehlenden DB-Zugangsdaten, auch auf `main`.
`node --test customer-dashboard/tests/`: 142/142.

## Teil F — Die Oberfläche

Bearbeitbar wird die Weiterleitung in der bestehenden Karte „Grenzen und
Eskalation" — kein neuer Screen, keine neue Navigation. Sichtbar ist der Editor
nur bei `permissions.can_change_forwarding`; Starter und Business behalten
Anzeige plus Meldeweg unverändert.

**Ein Satz statt eines Formulars (Grundsatz 15).** Drei beschriftete Felder,
die zusammen die Regel ergeben:

```
In welchem Fall?   [ z. B. Wasserschaden oder Rohrbruch     ]
Dann anrufen       [ Name, z. B. Pikettdienst Meier         ]
Nummer             [ z. B. 079 123 45 67                    ]
```

Ein Ziel ist sichtbar; das zweite erscheint erst auf „+ Zweite Weiterleitung
hinzufügen" — wer nur eine Weiterleitung hat, sieht auch nur eine. Der
Auslöser fragt nach dem *Fall* und nicht nach einem Nebensatz, weil er im Prompt
zu „(bei: …)" wird: „Wenn jemand einen Wasserschaden meldet" ergäbe dort „bei:
jemand einen Wasserschaden meldet".

Weitere Festlegungen:

- Gesendet wird nur, was auch gerendert ist. Ein nicht aufgeklapptes zweites
  Ziel ist nicht Teil der Änderung und taucht deshalb nicht in `prev_values`
  und im Sync-Log auf.
- Name ohne Nummer (oder umgekehrt) wird vor dem Absenden erklärt statt still
  gespeichert — der Assistent nutzt ein halbes Ziel nicht, und genau diese
  Sorte stille Wirkungslosigkeit ist der Kern von N6.
- Fehlercodes des Endpoints werden übersetzt. „forwarding_number_invalid" ist
  für die Zielgruppe unbrauchbar.
- Der Baustein „Weiterleitung einrichten" im Meldeweg entfällt für Kunden, die
  selbst bearbeiten können — sonst stünde ein zweiter, langsamerer Weg direkt
  neben dem Editor.
- Die Kartenbeschreibung trägt die Regel, die tatsächlich gilt: „Die
  Weiterleitung ändern Sie selbst — sie wirkt sofort. Die Notfallnummer
  bestätigt Voxera." Für Pläne ohne Berechtigung bleibt der alte Satz stehen.

**Die Notfallnummer bleibt bewusst read-only, auch für Professional.** „Bei
Lebensgefahr" ist in der Schweiz fast immer 144; wer sie ändern will, geht über
„Änderung melden". Server und Plan-Sperre könnten das Feld bereits — die
Zurückhaltung ist eine Produktentscheidung, keine technische Grenze.

**Geprüft.** 15 Funktionsproben in jsdom gegen das echte Modul mit echten
Klicks und mitgeschnittenem Payload: erstes Ziel speichern (genau drei Felder
im Request), zweites Ziel aufklappen (sechs Felder, erstes behält seine Werte),
Name ohne Nummer wird abgefangen und der Editor bleibt offen, ohne Berechtigung
kein Editor und der Meldeweg bleibt vollständig. Das Modul ist die Vorlage für
die Vorschau; jsdom ist keine Repo-Abhängigkeit, im Guard stehen deshalb
statische Prüfungen auf dieselben Eigenschaften (Gegenprobe gegen `bb72cd2`:
14 Prüfungen scheitern).

## Teil G — Ehrlich benannte Grenzen

- **Kein Live-Anruf.** Nachgewiesen ist, dass der Sync ausgelöst wird und welcher
  Prompt dabei entsteht. Dass ElevenLabs den PATCH annimmt, ist für diesen Pfad
  seit langem belegt (20 erfolgreiche Log-Zeilen), aber nicht Teil dieses Tests —
  der einzige Kunde mit echtem Agenten ist ein Produktivdatensatz, dessen
  Agentenkonfiguration ohne Freigabe nicht angefasst wurde.
- **Die Nummer-Normalisierung ändert gespeicherte Werte.** Ein Kunde, der
  „079 123 45 67" tippt, sieht danach „+41791234567". Das ist die Form, die
  gewählt werden kann; wer eine interne Durchwahl hinterlegen wollte, wird
  abgewiesen. Bewusste Entscheidung, kein Versehen.
- **S4 bleibt offen.** Wirksam wird jede Prompt-Änderung weiterhin erst beim
  nächsten Sync des jeweiligen Kunden. Für Änderungen am Master-Prompt oder an
  Branchenvorlagen gibt es weiterhin keinen Fan-out.
- **S2, S3, S5 unverändert** — ausserhalb dieses Auftrags.
