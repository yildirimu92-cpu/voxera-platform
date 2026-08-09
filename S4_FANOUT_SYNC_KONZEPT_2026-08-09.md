# S4 — Fan-out-Mechanismus für "wirkt erst beim nächsten Sync"-Fixes

**Diagnose und Konzeptvorschlag, 09.08.2026.**

**Status: freigegeben und umgesetzt (09.08.).** Alle vier Punkte aus Abschnitt 6
sind entschieden: Stufenplan 0→1→2→3 wie vorgeschlagen, Refactor ja, S9-Migration
sofort, Kostenannahme bestätigt (ElevenLabs rechnet nach TTS-Minuten ab, nicht nach
Konfigurations-Aufrufen — das Risiko bleibt Ratenlimit, nicht Geld). Was gebaut
wurde, steht in Abschnitt 7. Die Diagnose darunter bleibt als Begründung unverändert
stehen.

Ursprünglicher Auftrag: mehrere Ansätze durchdenken, Vor-/Nachteile benennen,
Empfehlung geben, Entscheidung beim User lassen. Bestehende Sync-Auslöser (S1–S13)
bleiben unverändert.

---

## 1. Kurzfassung

Der eigentliche Befund ist nicht "es fehlt ein Knopf zum Neu-Synchronisieren".
Der Befund ist: **das System kennt keinen Soll-Zustand.** Es gibt für jeden Kunden
einen Ist-Zustand beim Anbieter (der Prompt, der im ElevenLabs-Agenten steht) und
es gibt die Eingaben, aus denen sich der Prompt bauen liesse — aber nirgends wird
festgehalten, welcher Bauplan den aktuellen Ist-Zustand erzeugt hat. Deshalb kann
niemand die Frage beantworten "welche Kunden laufen auf einem veralteten Prompt?",
und deshalb kann auch kein Fan-out entscheiden, wen er anfassen muss.

Alle drei im Briefing vorgeschlagenen Ansätze (Knopf, Batch-Job, Versions-Tag)
setzen diese Antwort voraus. Der Versions-Tag ist deshalb keine dritte Alternative
neben den anderen beiden — er ist die Voraussetzung für beide.

Zwei Dinge müssen ausserdem repariert werden, bevor ein Fan-out überhaupt gebaut
werden kann; beide sind heute im Code grün und in Produktion wirkungslos
(Abschnitt 3).

---

## 2. Diagnose: wie der Sync heute funktioniert

### 2.1 Der Sync ist rein ereignisgetrieben — und hat mehr Auslöser als gedacht

`trigger-elevenlabs-sync.js` baut den Prompt bei jedem Aufruf komplett neu
(`buildPromptV2`) und schickt ihn per PATCH an ElevenLabs. Es gibt keinen
Zwischenspeicher und keinen Vergleich mit dem, was schon beim Agenten steht:
jeder Aufruf überschreibt bedingungslos. Ausgelöst wird er von acht Stellen, nicht
von den drei aus dem Briefing:

| `triggered_by` | Auslöser |
| --- | --- |
| `admin_save` | Admin-Portal, AI-Setup speichern (`index.html:8287`) |
| `wizard` | Onboarding-Wizard (`index.html:7776`) |
| `customer_request` | Änderungsanfrage genehmigen (`index.html:16552`) |
| `admin_manual` | "Jetzt synchronisieren" (`admin-runtime-sync.js:106`, über v2 geroutet) |
| `customer_self_edit` | Kunden-Dashboard, `customer-update-assistant.js:290` |
| `customer_operational_update` | Betriebsinformationen, `customer-operational-updates.js:73` |
| `customer_proxy` | Proxy im Kunden-Dashboard, `elevenlabs-sync-prompt.js:26` |
| `provision_*` | Erst-Provisionierung, `elevenlabs-provision-agent.js:248` |

Gemeinsames Merkmal: **jeder dieser Auslöser ist eine Reaktion auf eine
Kundenänderung.** Keiner reagiert auf eine Änderung an der Plattform. Ändert sich
der Code, der Master-Prompt oder eine Branchenvorlage, passiert nichts.

### 2.2 Der Bauplan wird gebaut, aber nie protokolliert

`buildPromptV2()` gibt eine Version zurück (`PROMPT_BUILDER_VERSION = '2.2'`).
Diese Version wird an genau zwei Stellen verwendet — in der HTTP-Antwort von
`trigger-elevenlabs-sync.js:292` und in der Prompt-Vorschau
(`prompt-preview.js:61`). **Gespeichert wird sie nirgends.** Weder in
`elevenlabs_sync_log` noch auf `customers`.

Das ist die Kernlücke. Aus den Daten lässt sich heute rekonstruieren *wann*
zuletzt gesynct wurde (`customers.elevenlabs_last_sync_at`) und *was* dabei
rausging (`elevenlabs_sync_log.prompt_snapshot`, 10 Zeilen pro Kunde) — aber
nicht, *mit welchem Stand von Code und Vorlagen*. Um "läuft dieser Kunde noch auf
dem alten Prompt?" zu beantworten, muss man den Snapshot von Hand lesen. Genau das
habe ich für diese Diagnose gemacht (2.4) — das skaliert nicht auf mehr Kunden.

Drei Eingaben sind ausserdem gemeinsam für alle Kunden und haben heute überhaupt
keinen Weg nach draussen:

* `system_config.prompt_master_l1` (Master-Prompt, Layer 1) — wird nur gelesen
* `industry_templates.prompt_block` (Branchenvorlage, Layer 2) — wird nur gelesen
* der Builder-Code selbst

Eine Korrektur an einer dieser drei erreicht null Agenten, bis irgendein Kunde
zufällig etwas an seinen eigenen Daten ändert. `system_config` hat ein
`updated_at` (aktuell `2026-05-07`), das als Signal taugt — es wird nur von
niemandem ausgewertet.

### 2.3 Zeitablauf ist ein zweiter, eigener Fall

S3 aus dem Sicherheit-Tab gehört fachlich hierher, auch wenn es keine
Deploy-Frage ist: `loadPromptInputs()` filtert Betriebsinformationen zur *Lesezeit*
über `ends_at > now()`. Der Prompt beim Agenten ist aber eingefroren. "Ferien bis
8. August" bleibt deshalb nach dem 8. August im Agenten stehen, bis ein
unabhängiger Anlass einen Sync auslöst. Ein Fan-out-Mechanismus, der nur auf
Deploys reagiert, löst diesen Fall nicht mit — ein zeitgesteuerter löst beide.
Das ist ein Argument dafür, den Auslöser nicht fest an "Deploy" zu koppeln.

### 2.4 Live-Beleg aus der Produktionsdatenbank

Abgefragt am 09.08. (nur lesend, Projekt `ulcofbgrovgcvowdjrge`):

* 4 Kunden, davon **1 mit ElevenLabs-Agent** und jemals gesynct. Der Rest hat
  keinen Agenten — der Fan-out-Radius ist heute also genau ein Kunde.
* Letzter Sync dieses Kunden: **09.08., 12:25:52 UTC**, `customer_self_edit`,
  erfolgreich, Prompt 16'674 Zeichen.
* Der `prompt_snapshot` dieses Syncs beginnt mit
  `# Voxera Master Prompt — Layer 1 (branchenneutral) — v3.0\r\n\r\n> **Datei-Zweck:** …`
  — also mit dem internen Dokumentationskopf, den S13 entfernen sollte.
* PR #861 (S13-Fix) wurde um **11:12:57 UTC** gemergt. Der Sync um 12:25 UTC lief
  **73 Minuten danach** und trug den Fehler trotzdem noch. Die Prompt-Länge ist
  über alle drei Syncs des Tages konstant 16'674 — der Fix hätte sie um 695
  Zeichen reduziert.

Der Fix selbst ist korrekt: der gespeicherte Master-Prompt enthält den
CRLF-Trenner an Position 695, 9140 − 695 − 6 = 8439, exakt der im Fahrplan
genannte Wert. Er war zum Sync-Zeitpunkt nur noch nicht ausgeliefert (oder die
Funktion lief noch aus einem älteren Bundle).

**Damit ist der Fall schärfer als im Briefing beschrieben.** Es ist nicht nur so,
dass ein Fix erst beim nächsten Sync wirkt — es ist so, dass *auch ein Sync nach
dem Fix* den Fix nicht zwingend trägt, und dass man das aus den Daten nicht
erkennt. Der Produktionsagent liefert nach heutigem Stand weiterhin ~695 Zeichen
interne Architektur-Dokumentation an Anrufer aus.

---

## 3. Zwei Blockierer, die vor jedem Fan-out weg müssen

### 3.1 S9 schreibt in Produktion nichts (Spalte fehlt)

Das Briefing nennt `elevenlabs_sync_log` als mögliche Datengrundlage. In
Produktion ist sie das nicht:

```
elevenlabs_sync_log: id, customer_id, agent_id, status, prompt_length,
                     error_message, triggered_by, created_at,
                     changed_fields, prompt_snapshot
```

Es gibt **keine Spalte `prev_values`** — weder in Produktion noch in Staging
(`hzqiyyqfchvfcmmbemvd`), und es existiert auch keine Migration dafür im Repo.
`trigger-elevenlabs-sync.js:227-238` setzt den Schlüssel `prev_values` aber
*immer* in die Insert-Zeile, auch wenn der Wert `null` ist. PostgREST weist eine
Insert-Zeile mit unbekannter Spalte grundsätzlich zurück (PGRST204) — unabhängig
vom Wert. Der primäre Insert schlägt also **bei jedem einzelnen Sync** fehl, und
der defensive Fallback in Zeile 245 entfernt dabei `changed_fields` gleich mit:

```js
const { changed_fields: _cf, prev_values: _pv, ...fallbackRow } = syncLogRow;
```

Ergebnis: `changed_fields` ist in Produktion in **allen** Zeilen `null`, auch in
denen nach dem S9-Merge. Der S9-Fix ist im Code korrekt und in CI grün, in
Produktion aber strukturell wirkungslos. Der Fallback war als Sicherheitsnetz
gedacht und verdeckt hier genau das Problem, das er melden sollte.

Behebung: eine Migration `alter table elevenlabs_sync_log add column prev_values
jsonb`. Klein, aber Voraussetzung — ohne sie hat ein Fan-out keine Datengrundlage
und S9 bleibt ein grüner Test über einer toten Funktion.

### 3.2 Kein Dienst-zu-Dienst-Pfad in den Sync hinein

`trigger-elevenlabs-sync.js` ist über `requirePromptSyncCaller` abgesichert:
entweder ein Admin mit `customer:write` oder ein Kunde, dessen `customer_id` zum
Request passt. Alle heutigen internen Aufrufer lösen das identisch — sie reichen
den `Authorization`-Header des Endnutzers weiter (`elevenlabs-provision-agent.js:239`,
`customer-operational-updates.js:67`, `customer-update-assistant.js:284`,
`trigger-elevenlabs-sync-v2.js:107`).

**Ein geplanter Job hat kein solches Token.** Für einen Fan-out gibt es drei Wege:

1. Ein Dienstkonto mit `customer:write`, dessen Zugangsdaten im Env liegen, meldet
   sich an und holt ein JWT. Funktioniert ohne Codeänderung am Guard, schafft aber
   ein dauerhaft gültiges Admin-Login als Umgebungsvariable.
2. Ein zusätzlicher Zweig im Guard, der ein internes Shared Secret akzeptiert.
   Erweitert die Angriffsfläche des Endpunkts, den S1/S13 gerade erst gehärtet
   haben.
3. **Empfohlen:** den Kern von `trigger-elevenlabs-sync.js` (Zeilen 149–275) in
   `_lib/elevenlabs-sync.js` herausziehen, als Funktion `syncCustomerToElevenLabs({
   sbAdmin, customerId, agentId, triggeredBy, prevValues })`. Der bestehende
   Handler behält Guard, Request-Parsing und Antwort und ruft nur noch die Funktion
   auf — die Auslöser und ihr Verhalten ändern sich nicht. Der Fan-out-Worker ruft
   dieselbe Funktion in-process mit Service-Role auf, ohne HTTP-Hop und ohne
   zweiten Auth-Pfad.

Weg 3 ist eine Umstrukturierung, keine Verhaltensänderung — deckt sich mit
"S4 ergänzt nur, ersetzt nicht". Er ist aber eine Änderung an der Datei, die S1,
S9 und S13 gerade angefasst haben, und sollte deshalb bewusst freigegeben werden.

### 3.3 Nebenbefund: `trimSyncLogs` würde die Historie verdrängen

`trimSyncLogs()` behält 10 Zeilen pro Kunde. Ein Fan-out schreibt pro Durchlauf
eine Zeile pro Kunde. Zwei, drei Fan-outs hintereinander (z.B. bei einem
Rollback) löschen damit die manuelle Historie und die `prompt_snapshot`-Zeilen,
die man für einen Rollback bräuchte. Fan-out-Zeilen sollten entweder von der
Trim-Regel ausgenommen werden oder ein eigenes Kontingent bekommen.

---

## 4. Die Ansätze im Vergleich

### Ansatz A — Manueller Knopf "Alle Kunden neu synchronisieren"

Ein Knopf im Admin-Portal, der über alle Kunden mit Agent iteriert.

**Dafür:** kleinster Aufwand, weil `trigger-elevenlabs-sync-v2.js` und die
Sync-Log-Karte schon existieren. Vollständig unter menschlicher Kontrolle — läuft
nur, wenn jemand nach einem Deploy bewusst draufdrückt, also nie mitten in einem
kaputten Deploy. Sichtbares Ergebnis pro Kunde.

**Dagegen:** löst das Problem des Briefings nicht, sondern verschiebt es. Der
manuelle Aufwand bleibt, und der eigentliche Schaden entsteht ja gerade dadurch,
dass jemand das Nachziehen *vergisst* — ein Knopf, an den man denken muss, kann
genauso vergessen werden wie ein einzelner Sync pro Kunde. Ohne Versions-Tag
synchronisiert er ausserdem stur alle, auch die, die schon aktuell sind.

**Technische Grenze:** Netlify-Funktionen laufen synchron maximal ~26 s
(`trigger-elevenlabs-sync-v2.js` setzt selbst 24 s an). Ein Sync dauert 4–7
ElevenLabs-Aufrufe. Ab etwa 3–5 Kunden passt das nicht mehr in eine Invocation —
der Knopf braucht dann ohnehin eine Warteschlange und ist nicht mehr "der
einfachste Ansatz".

**Aufwand:** klein allein, mittel sobald er über ~5 Kunden hinaus tragen soll.

### Ansatz B — Automatischer Batch-Job nach jedem Deploy

Ein Job, der nach jedem Deploy alle Kunden neu synct.

**Dafür:** löst das Vergessen strukturell. Kein Fix bleibt liegen.

**Dagegen — und das ist der schwerwiegendste Punkt:** die Frage aus dem Briefing,
was passiert, wenn ein Fan-out mitten in einem fehlerhaften Deploy läuft, ist bei
diesem Ansatz keine Randbedingung, sondern der Normalfall. Der Auslöser *ist* der
Deploy. Ein Deploy mit einem Prompt-Bug würde den Bug innerhalb von Minuten auf
alle Live-Agenten schreiben, statt ihn wie heute langsam durch Kundenaktivität
einsickern zu lassen. Die heutige Trägheit ist ein Problem — sie ist aber
gleichzeitig das einzige Sicherheitsnetz, das es gibt. Genau ein solcher Deploy
(S13) hat gerade gezeigt, dass Prompt-Bugs es bis in die Produktion schaffen.

Das ist beherrschbar, aber nur mit Zusatzmechanik: Canary (erst ein Kunde, dann
Pause, dann der Rest), automatischer Abbruch bei Fehlerquote, Rollback aus
`prompt_snapshot`, und ein Gate, das nur bei tatsächlich prompt-relevanten
Deploys auslöst — nicht bei jeder CSS-Änderung. Ausserdem gibt es heute keinen
Deploy-Hook, keine Warteschlange und keinen Dienst-zu-Dienst-Pfad (3.2).

**Kosten:** die ElevenLabs-Konfigurations-API (Agent PATCH/GET, Tools, Phone
Numbers) wird nach meinem Verständnis nicht nach Credits abgerechnet — bezahlt
werden Gesprächsminuten und TTS. Der Kostendruck kommt also nicht vom Geld,
sondern von Rate Limits und Laufzeit. **Bitte gegenprüfen**, bevor daraus eine
Entscheidung wird; bei einem Kunden ist es ohnehin egal, bei 50 nicht mehr.

**Aufwand:** gross — Deploy-Hook, Warteschlange, Worker, Canary, Rollback,
Abbruchkriterium.

### Ansatz C — Versions-Tag: erkennen statt automatisch handeln

Bei jedem Sync wird festgehalten, aus welchem Stand der Prompt gebaut wurde. Die
Oberfläche markiert Kunden, deren Stand veraltet ist.

Konkret: eine `prompt_fingerprint` auf `customers` und in `elevenlabs_sync_log`,
zusammengesetzt aus `PROMPT_BUILDER_VERSION`, einem Hash von
`system_config.prompt_master_l1`, einem Hash des Branchenvorlagen-Blocks und
optional dem Commit-SHA des Deploys. Der Soll-Fingerprint ist zur Laufzeit jederzeit
berechenbar, ohne einen einzigen ElevenLabs-Aufruf. `soll ≠ ist` heisst "veraltet".

**Dafür:** beantwortet als einziger Ansatz die Frage, die heute niemand
beantworten kann, und zwar *bevor* irgendetwas angefasst wird. Kostet null
API-Aufrufe. Kein Blast Radius: er ändert nichts, er zeigt nur an. Er macht
Ansatz A gezielt (nur veraltete Kunden statt alle) und Ansatz B überhaupt erst
sicher (Abbruch, wenn nach dem Fan-out Kunden veraltet bleiben). Er hätte den
Fall aus 2.4 sofort sichtbar gemacht: der Kunde hätte nach dem 11:12-Deploy als
"veraltet" dagestanden, und der 12:25-Sync hätte ihn nicht auf grün gesetzt.

**Dagegen:** allein löst er gar nichts — ein Kunde, der als veraltet markiert ist,
ist immer noch veraltet. Er braucht A oder B als Ausführung. Ausserdem braucht er
eine Stelle in der Oberfläche, die das anzeigt, sonst ist er ein Feld, das
niemand liest (dieselbe Falle wie `changed_fields`, siehe 3.1).

**Aufwand:** klein bis mittel. Eine Migration, ~30 Zeilen in
`prompt-builder-v2.js` und `trigger-elevenlabs-sync.js`, eine Badge in der
Sync-Karte.

---

## 5. Empfehlung

**C als Fundament, dann A als Auslöser, B erst danach und nur mit Canary.**

Begründung: A und B unterscheiden sich nur darin, *wer* den Sync auslöst — bei
beiden ist die schwierige Frage dieselbe, nämlich *wen* er auslösen soll. Ohne C
lautet die Antwort in beiden Fällen "alle", und "alle" ist bei B genau die
Eigenschaft, die den Ansatz gefährlich macht. Mit C wird A präzise genug, um in
eine Netlify-Invocation zu passen, und B bekommt ein Abbruchkriterium.

Vorgeschlagene Reihenfolge:

**Stufe 0 — Blockierer (nicht optional, unabhängig vom gewählten Ansatz)**
`prev_values`-Spalte per Migration nachziehen (3.1); `trimSyncLogs` so anpassen,
dass Fan-out-Zeilen die Historie nicht verdrängen (3.3).

**Stufe 1 — Sichtbarkeit (Ansatz C)**
Fingerprint berechnen, bei jedem Sync mitschreiben, Soll/Ist in
`elevenlabs-sync-status.js` vergleichen, Badge "Prompt veraltet (Stand X)" in der
Sync-Karte. Ändert kein Verhalten, keine API-Kosten, kein Risiko. Beantwortet ab
Tag eins, welche Kunden betroffen sind — auch rückwirkend für S1 und S13.

**Stufe 2 — gezieltes Nachziehen (Ansatz A, geschärft)**
Kern in `_lib/elevenlabs-sync.js` herausziehen (3.2, Weg 3). Knopf "Veraltete
Kunden synchronisieren (n)" — arbeitet nur die Liste aus Stufe 1 ab, nie alle.
Bei mehr als ~3 Kunden über eine Warteschlangen-Tabelle plus einen
`fanout-sync-worker` nach dem Muster von `outbox-retry-worker.js`
(Claiming per Status-Update, Backoff, Batch-Grösse per Env) — das Muster steht im
Repo bereits und ist erprobt.

**Stufe 3 — Automatik (Ansatz B), erst wenn Stufe 1+2 im Betrieb belegt sind**
Dieselbe Warteschlange, nur automatisch befüllt. Zwei Auslöser statt einem:
Deploy *und* Zeitplan (nächtlich) — der Zeitplan fängt S3 mit ab, den ein reiner
Deploy-Auslöser nie sieht. Mit Canary (erster Kunde, dann Pause), Abbruch bei
Fehlerquote und Rollback aus `prompt_snapshot`.

Stufe 1 ist unabhängig davon sinnvoll, welchen Ausführungsweg Du am Ende wählst,
und ist die einzige Stufe, die ohne Rücksprache über Risiken auskommt.

---

## 6. Was ich für die Entscheidung von Dir brauche

1. **Wie weit soll S4 gehen?** Nur Stufe 1 (sehen, manuell handeln), Stufe 1+2
   (sehen, ein Knopf), oder bis Stufe 3 (Automatik)?
2. **Darf `trigger-elevenlabs-sync.js` umstrukturiert werden** (3.2, Weg 3)? Ohne
   das gibt es keinen sauberen Weg für einen Job in den Sync hinein. Die Datei
   trägt gerade S1, S9 und S13 — deshalb frage ich statt es einfach zu tun.
3. **Soll die `prev_values`-Migration (3.1) in S4 mit rein** oder als eigener,
   kleiner Fix vorgezogen werden? Sie repariert S9 rückwirkend und ist unabhängig
   von der Fan-out-Entscheidung.
4. **Ist die Kostenannahme richtig**, dass ElevenLabs-Konfigurationsaufrufe nicht
   nach Credits abgerechnet werden? Falls doch, ändert das die Bewertung von
   Ansatz B deutlich.

Ausserdem, unabhängig von S4 und zeitkritisch: der Produktionsagent trägt nach
Datenlage weiterhin den S13-Prompt (2.4). Ein einziger manueller Sync über die
bestehende Sync-Karte behebt das heute — vorausgesetzt, der S13-Deploy ist
inzwischen ausgeliefert.

---

## 7. Was gebaut wurde (09.08., nach Freigabe)

### Stufe 0 — Blockierer

| | |
| --- | --- |
| `2026-08-09_elevenlabs_sync_log_prev_values.sql` | Spalte nachgezogen, auf Produktion **und** Staging angewandt. Damit schreibt der S9-Fix erstmals wirklich. |
| `trigger-elevenlabs-sync.js` → `_lib/elevenlabs-sync.js` | `trimSyncLogs()` behält jetzt 10 Zeilen **pro Herkunftsklasse** (`fanout` / `interactive`). Ein Fan-out kann die interaktive Historie und die Rollback-Snapshots nicht mehr verdrängen. |

### Stufe 1 — Sichtbarkeit

`_lib/prompt-fingerprint.js` bildet `v1.<builder>.<hash master>.<hash branche>`.
Der Soll-Wert wird zur Laufzeit berechnet und **nirgends gespeichert** — ein
gespeicherter Soll-Wert könnte selbst veralten. Der Ist-Wert steht auf
`customers.prompt_fingerprint` und wird nur nach einem erfolgreichen Sync
fortgeschrieben.

Drei Zustände statt zwei: `current`, `outdated`, `unknown`. Der dritte kam aus der
Live-Datenlage dazu — direkt nach der Einführung hat jeder Bestandskunde
`prompt_fingerprint = null`. Gälte das als "aktuell", wären ausgerechnet die Kunden
unsichtbar, für die S4 gebaut wurde. Der Fan-out behandelt `unknown` wie `outdated`;
nur die Anzeige unterscheidet.

Kosten: null ElevenLabs-Aufrufe. Verhaltensänderung: keine.

### Stufe 2 — gezieltes Nachziehen

* **`_lib/elevenlabs-sync.js`** — der Sync-Kern, aus dem Handler herausgelöst
  (Weg 3 aus 3.2). Der Handler behält Guard, Parsing und Antwortform; alle acht
  Auslöser verhalten sich unverändert.
* **`elevenlabs_sync_queue`** + **`fanout-sync-worker.js`** (alle 5 Min) — Muster
  von `outbox-retry-worker.js`. Partieller Unique-Index verhindert, dass ein Kunde
  zweimal offen einsteht. Der Worker hört bei 20 s von selbst auf, damit Netlify
  ihn nicht mitten im Lauf abschneidet und Zeilen in `running` zurückbleiben.
* **`elevenlabs-sync-fanout.js`** + Knopf in der Sync-Karte — heisst
  "Veraltete Kunden synchronisieren (n)", nie "alle". Der Aufrufer darf die Auswahl
  einschränken, aber nicht erweitern.

### Stufe 3 — Automatik

* **`fanout-sync-planner.js`**, nächtlich (`40 3 * * *`). Zweiter Auslöser Deploy
  über `FANOUT_DEPLOY_SECRET`; ohne gesetztes Secret antwortet der Endpunkt 404 —
  **standardmässig also aus**. Der Zeitplan deckt beide Fälle ab, der Deploy nur
  einen: abgelaufene Betriebsinformationen (S3) laufen ab, ohne dass irgendein
  Deploy stattfindet.
* **Canary** — Welle 1 ist genau ein Kunde; Welle 2 wird erst freigegeben, wenn
  Welle 1 vollständig erfolgreich war.
* **Abbruch** — Fehlerquote über `FANOUT_ABORT_THRESHOLD` (Standard 0.5, ab
  2 abgeschlossenen Zeilen) storniert die wartenden Zeilen desselben Laufs.
* **Rollback** — `action: 'rollback'` schreibt pro Kunde den `prompt_snapshot`
  zurück, der **vor** dem Lauf zuletzt live war, und leert dabei den
  Ist-Fingerprint statt ihn zu raten.

### Stellschrauben

| Variable | Standard | Wirkung |
| --- | --- | --- |
| `FANOUT_BATCH_SIZE` | 3 | Kunden pro Worker-Tick |
| `FANOUT_MAX_ATTEMPTS` | 3 | Versuche, bevor eine Zeile `dead` wird |
| `FANOUT_ABORT_THRESHOLD` | 0.5 | Fehlerquote, ab der ein Lauf abbricht |
| `FANOUT_ABORT_MIN_SAMPLE` | 2 | Mindeststichprobe für den Abbruch |
| `FANOUT_MAX_PER_RUN` | 25 | Obergrenze je Planungslauf (Überhang wird geloggt, nicht verschwiegen) |
| `FANOUT_DEPLOY_SECRET` | — | Ohne Wert ist der Deploy-Auslöser nicht benutzbar |

### Prüfung

`scripts/verify-prompt-fingerprint.mjs` und `scripts/verify-elevenlabs-fanout.mjs`
führen die echten Funktionen aus (Supabase-Stub bildet nur die Query-Kette nach)
und prüfen unter anderem: `null` gilt nicht als aktuell, Welle 2 bleibt nach einem
Fehlschlag stehen, ein einzelner Fehlschlag bricht keinen Lauf ab, eine vor dem
letzten Sync abgelaufene Betriebsinformation löst nichts aus. Beide hängen in CI.

Sechs bestehende Guards lasen den Sync-Kern an seiner alten Stelle und wurden
nachgezogen — Aussage identisch, Pfad neu. Der P0-Security-Guard unterscheidet
jetzt bewusst Handler (Auth) und Kern (Retention), statt beide zu vermengen. Alle
50 `verify-*.mjs` laufen grün.

### Was bewusst offen blieb

* **Der Produktionskunde trägt weiterhin den S13-Prompt.** Der Fan-out erkennt ihn
  ab dem ersten Planungslauf als `fingerprint_unknown` und zieht ihn nach — aber
  erst, wenn dieser Branch deployed ist. Bis dahin behebt ein Klick auf
  "Jetzt synchronisieren" in der Sync-Karte den Fall sofort.
* **Der Deploy-Auslöser ist aus.** Einschalten heisst: `FANOUT_DEPLOY_SECRET`
  setzen und einen Build-Hook auf `fanout-sync-planner` zeigen lassen. Der Canary
  gilt dann genauso.
* **Ein verwaistes Sync-Log** eines gelöschten Kunden (`cust_1785533332175_pj98so`)
  liegt weiterhin in der Tabelle. Kleiner Nebenfund aus der Diagnose, von S4 nicht
  berührt.
