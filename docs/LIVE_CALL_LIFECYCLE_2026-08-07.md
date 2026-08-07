# Live-Call-Flackern: Re-Diagnose und Lebenszyklus-Umsetzung — 2026-08-07

**Baseline:** `main` @ `9221de9`
**Vorgeschichte:** PR #807 (A-P0-01, gemerged), PR #816 (Poll/Realtime-Coalescing, gemerged)
**Geänderte Datei:** `customer-dashboard/index.html`
**Neuer Test:** `customer-dashboard/tests/live-call-lifecycle.test.cjs`

Kein Deploy. Alle Aussagen unten sind gegen den Code in diesem Repo verifiziert —
teils gegen echtes Chromium (Playwright), teils als reine Funktionsprüfung.

---

## 1. Ausgangsfrage

Der Flacker-Effekt galt nach PR #807/#809 als behoben, tritt im Live-Test aber
weiterhin auf. Zu prüfen war die Hypothese: *entsteht der Flacker daraus, dass
während des laufenden Gesprächs bereits ein Karten-Eintrag existiert, der
wiederholt aktualisiert wird?*

**Antwort: Ja.** Die Hypothese trifft zu, und sie trifft die Ursache genauer als
die bisherige Diagnose. Der Mechanismus ist allerdings ein anderer als vermutet:
nicht der Update-Mechanismus des Eintrags war defekt, sondern seine Platzierung.

---

## 2. War der #807-Fix noch aktiv?

Ja. Die Diff-Logik aus #807 (`_liveHeroLastFingerprint`, Text-Patch statt Rebuild)
steht unverändert in `main`. Sie wurde auch nicht durch PR #822 umgangen: #822 ist
zum Zeitpunkt dieser Analyse **offen und nicht gemerged**, seine Base ist exakt der
aktuelle `main`-Head. Der Fix war intakt — er konnte nur nicht wirken.

PR #807 hatte das selbst vorhergesehen. Aus seinem eigenen PR-Text, unter
"Not in scope for this PR":

> `renderDashPriorityList()`'s own `innerHTML` replacement can transiently destroy
> `#live-call-row` under a specific interleaving — different function, different bug.

Genau das war es. Nur nicht "transient under a specific interleaving", sondern
**in jedem einzelnen Renderzyklus**.

---

## 3. Root Cause

`#live-call-row` lebte als Kind von `#dash-priority-list`. Diese Liste wird von
`renderDashPriorityList()` über `vxSetHtmlIfChanged(el, html)` neu gesetzt.

Der Guard `vxSetHtmlIfChanged()` vergleicht `el.innerHTML` mit dem generierten
HTML-String. Der Live-Hinweis war aber nie Teil dieses Strings — er wurde
nachträglich per `insertBefore()` eingehängt. Damit gilt, sobald ein Anruf läuft:

```
el.innerHTML  = [Live-Row] + [Sektionen]
html          =              [Sektionen]
                → immer ungleich → innerHTML wird immer ersetzt
```

Der Guard konnte also **strukturell nie greifen, solange ein Anruf lief** — der
einzige Zustand, in dem er gebraucht wurde. Der Ablauf pro Tick, aus `loadData()`:

```
renderDashboard()          → renderDashPriorityList() → innerHTML-Swap
                                                      → #live-call-row zerstört
updateLiveHero()           → existing === null
                           → Fingerprint-Guard aus #807 läuft ins Leere
                           → voller Rebuild inkl. liveRowEnter (0.3s Einblendung)
```

Bei ~9s Poll plus jedem Realtime-Event ist das eine sich ständig wiederholende
Einblendung. Das ist der sichtbare Flacker-Effekt.

Zusätzlich verschärfend: der Eintrag trug veränderliche Anruf-Daten (Name, Firma)
und stand über `updated_at` auch in den übrigen Heute-Listen — "Anrufe heute",
"Heute passiert", "Aufmerksamkeit". Da `updated_at` während eines Gesprächs bei
jedem Webhook hochzählt, änderte sich dort laufend Sortierung und Zeitstempel,
was denselben Wholesale-innerHTML-Austausch in diesen Listen auslöste.

### Reproduktion (Chromium, echte extrahierte Funktionen)

Vier identische Renderzyklen, Listeninhalt bewusst unverändert:

```
cycle 1  -> node=gen1  anims=[0,0]
cycle 2  -> node=gen2  anims(before)=[300,667]  anims(after)=[0,0]
cycle 3  -> node=gen3  anims(before)=[300,700]  anims(after)=[0,0]
cycle 4  -> node=gen4  anims(before)=[300,683]  anims(after)=[0,0]

distinct #live-call-row nodes über 4 identische Zyklen: 4
```

Kontrolle ohne Live-Anruf: DOM bleibt über mehrere Renders erhalten — der Guard
funktioniert, der Fehler entsteht ausschliesslich durch die Live-Row.

---

## 4. Umsetzung nach der neuen Lebenszyklus-Definition

Statt den Update-Mechanismus zu reparieren, entfällt der Eintrag während der
Live-Phase vollständig.

### 4.1 Eine kanonische Definition

`vxIsCallInLivePhase()` ist die einzige Stelle, die "Leitung steht" definiert:
`incoming | ringing | active | live`. Bewusst **nicht** deckungsgleich mit dem
bestehenden `vxIsLiveCall()`, das auch Nach-Hangup-Zustände (`processing`,
`in_progress`) mitzählt — der Eintrag soll ja genau beim Auflegen entstehen.

### 4.2 Kein Eintrag während des Gesprächs

Live-Phasen-Anrufe werden aus dem Eintrags-Universum entfernt, an den Quellen
statt an den Render-Funktionen:

| Stelle | Wirkung |
|---|---|
| `vxGetAnfragenSourceRecords()` | Heute-View-Quelle, Anfragen-Inbox, alle Zählungen, Nav-Badges |
| `vxRSourceRecords()` (PR-R-Buckets) | KPI-Buckets inkl. eigenem `allRecords`-Fallback |
| `vxGetHeuteTodayCallRecords()` | "Anrufe heute" und "Heute passiert" |
| `vxTodayIsRelevantCallForAttention()` | "Aufmerksamkeit" |
| `deriveDashboardCallBuckets()` | abgeleitete Dashboard-Buckets |
| `getUnifiedOpenTasks()` | Aufgaben aus Anrufen |

Folge: die KPI "Anrufe heute" zählt den Anruf erst beim Auflegen mit — das ist die
gewollte Konsequenz der Definition, nicht ein Nebeneffekt.

### 4.3 Ambient-Hinweis statt Karte

Zwei strukturelle Änderungen, beide notwendig:

1. **Eigener Host.** Neues `#dash-live-ambient` als Geschwister-Element von
   `#dash-priority-section`. Keine Listen-Render-Funktion fasst dieses Element an,
   damit kann der Hinweis nicht mehr im Renderzyklus zerstört werden. Das
   `insertBefore()`-Re-Parenting am Ende von `renderDashPriorityList()` entfällt.
2. **Inhalt ohne veränderliche Anruf-Daten.** Der Text hängt nur davon ab, *ob* und
   *wie viele* Gespräche laufen — nicht an Name, Firma oder Zeitstempel. Damit gibt
   es während eines Gesprächs nichts nachzubefüllen; der Fingerprint ist über die
   gesamte Gesprächsdauer konstant.

Wer anruft, meldet weiterhin Toast, Glocke und Browser-Notification — einmal je
Anruf, nicht bei jedem Renderzyklus.

### Verifikation nach dem Fix

Vier Zyklen, dabei Anrufername und Firma mitten im Gespräch nachgeliefert und der
Listeninhalt zusätzlich verändert:

```
cycle 1 -> node=gen1  host=dash-live-ambient  anims=[0,0]
cycle 2 -> node=gen1  host=dash-live-ambient  anims(before)=[300,600]   anims(after)=[300,600]
cycle 3 -> node=gen1  host=dash-live-ambient  anims(before)=[300,1200]  anims(after)=[300,1217]
cycle 4 -> node=gen1  host=dash-live-ambient  anims(before)=[300,1817]  anims(after)=[300,1817]

distinct #live-call-row nodes über 4 Zyklen: 1
Benachrichtigungen: { toasts: 1, bells: 1, notifs: 1 }
```

`liveRowEnter` bleibt bei 300 (abgeschlossen, nie neu gestartet), der Dot-Puls
läuft monoton weiter.

---

## 5. Regressionstest

`customer-dashboard/tests/live-call-lifecycle.test.cjs`, 11 Tests, extrahiert die
echten Funktionen aus `index.html`. Abgedeckt: Lebenszyklus-Wahrheitstabelle,
Ausschluss aus allen vier Eintrags-Listen, DOM-Identität des Hinweises über
Renderzyklen hinweg — inklusive eines Tests, der die Produktionssequenz nachstellt
und den Priority-List-innerHTML-Swap zwischen den `updateLiveHero()`-Aufrufen
ausführt.

**Negativkontrolle.** Gegen den neuen Code, aber mit ausschliesslich zurückgedrehter
Einhängung und per-Anruf-Inhalt:

```
ok      1-4, 11   (Lebenszyklus- und Listen-Tests — unverändert grün)
not ok  5-10      (alle DOM-Stabilitäts-Tests)
```

Die Tests fangen also gezielt diesen Fehler und widersprechen dem alten Code nicht
einfach überall.

CI: `.github/workflows/verify-live-call-lifecycle.yml`.

---

## 6. Testplan Deploy-Preview

- [ ] Während eines laufenden Anrufs: Hinweis blendet einmal ein und steht danach ruhig
- [ ] Kein Karten-Eintrag in "Aufmerksamkeit", "Anrufe heute", "Heute passiert", Anfragen
- [ ] KPI "Anrufe heute" zählt den Anruf erst nach dem Auflegen
- [ ] Beim Auflegen: Hinweis verschwindet, Eintrag erscheint mit "Wird verarbeitet"
- [ ] Zweiter paralleler Anruf: Hinweis wechselt auf "2 Anrufe laufen gerade", ohne neue Einblendung
- [ ] Toast, Glocke und Browser-Notification kommen weiterhin je Anruf einmal
