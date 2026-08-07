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

## 6. Gegenprüfung im echten Browser (Nachtrag)

Die Deploy-Preview `deploy-preview-823--voxera-dashboard.netlify.app` ist aus dieser
Session **nicht erreichbar** — die Egress-Policy der Umgebung lehnt den Host ab
(`403 CONNECT`, nur GitHub ist freigegeben). Deshalb ersatzweise: die **komplette,
unveränderte `index.html`** über einen lokalen HTTP-Server in echtem Chromium,
inklusive `/shared/*.css`, also mit aufgelösten Design-Tokens und echtem Layout.
Da `netlify.toml` `publish = "."` und einen No-Op-Build (`echo`) verwendet, ist die
ausgelieferte Datei byte-identisch mit der Repo-Datei; der verbleibende Unterschied
zur Preview ist nur die fehlende Supabase-Session.

Gleicher Harness, sechs echte Render-Ticks (`renderDashPriorityList()` +
`updateLiveHero()`), Anrufername und Firma werden mitten im Gespräch nachgeliefert:

| | vor dem Fix (`main` @ 9221de9) | nach dem Fix |
|---|---|---|
| distinkte `#live-call-row`-Knoten über 6 Ticks | **7** | **1** |
| `liveRowEnter` je Tick | zurück auf **0** (Einblendung startet neu) | konstant **300** (beendet) |
| `opacity` je Tick | **0** (Beginn der Einblendung) | konstant **1** |
| `liveDotPulse` | jedes Mal **0** | monoton 600 → 1000 → 1400 → 1800 → 2200 → 2600 |
| Position | *innerhalb* der Aufmerksamkeit-Liste | eigene Karte darüber |

Die Vorher-Spalte ist der Flacker-Effekt in Zahlen: der Knoten wird pro Tick ersetzt,
die 0.3s-Einblendung startet jedes Mal von `opacity: 0` neu.

Visuell bestätigt: der Hinweis steht als eigene Karte über „Aufmerksamkeit" (roter
Akzent links, „Ein Anruf läuft gerade" + „Der Eintrag erscheint, sobald das Gespräch
beendet ist.", Live-Badge), während „Aufmerksamkeit" darunter „Alles erledigt" zeigt
— kein Karten-Eintrag für das laufende Gespräch.

### Nebenbefund: `vxToast()` existiert nicht

Der Lauf gegen den Vor-Fix-Stand brach mit `ReferenceError: vxToast is not defined`
in `updateLiveHero()` ab. `vxToast()` wird in `index.html` an drei Stellen aufgerufen
und im Kommentarblock „VOXERA NOTIFICATION SYSTEM v1.0" dokumentiert, ist aber
**nirgends im Repo implementiert** — weder in `index.html`, noch in den per
`<script src>` geladenen Dateien, noch irgendwo in der Git-History.

Bestandsfehler, keine Regression dieses PRs, aber im selben Code-Pfad. Konsequenz im
alten Code: der Wurf landete zwischen `_liveHeroNotified.add()` und dem
`insertBefore()`, also lief beim ersten Tick eines neuen Anrufs weder `vxBellAdd()`
noch `vxMaybePlayLiveCallSound()`, und die Row erschien erst beim zweiten Tick.

**Auflösung: ersatzlos entfernt, nicht neu gebaut.** Die Benachrichtigung für
eingehende Anrufe existiert bereits — der `#incoming-banner`, ausgelöst von
`flagIncomingRecords()`. Der läuft in `loadData()` auf den rohen Records aus
`loadCallRecords()`, also vor jeder Lebenszyklus-Filterung, und feuert, sobald eine
neue Record-ID auftaucht. Bei einem eingehenden Anruf ist das während des Gesprächs.

Im echten Browser gegen die komplette `index.html` verifiziert, mit
`live_status: 'active'` und noch ohne Dauer:

| | Messung |
|---|---|
| feuert während der Live-Phase | ja (`vxIsCallInLivePhase` = true) |
| Titel / Unterzeile | „Neuer Anruf" / „Anna Muster" |
| Punkt | `rgb(34, 197, 94)`, pulsierend (`dotPulse`) |
| Ton | 1× |
| zweiter Poll-Tick | feuert nicht erneut, kein zweiter Ton |
| Eintrags-Listen währenddessen | leer — Lebenszyklus-Regel hält |

`vxToast()` und `vxBellAdd()` sind damit in `updateLiveHero()` redundant und
gestrichen. Was bleibt, ergänzt den Banner und dupliziert ihn nicht:

- `notifyLiveCall()` — OS-Notification, ausschliesslich wenn der Tab **nicht**
  sichtbar ist; der Banner ist rein in-app.
- `vxMaybePlayLiveCallSound()` — der Banner spielt den Ton nur bei genau einem
  neuen Anruf, hier je Anruf. Global über `vxPlayedLiveSoundIds` dedupliziert,
  daher kein Doppelton; die Funktion hat mit `source` von Anfang an mehrere
  Aufrufstellen vorgesehen (`'live-hero'`, `'incoming-banner'`).

Die Kapselung bleibt: Meldewege sind Beiwerk und dürfen den Hinweis nie verhindern.

**Offen, bewusst nicht angefasst:** zwei weitere tote `vxToast()`-Aufrufe ausserhalb
dieses Pfads — in der Glocken-/Notification-Panel-Logik (`vxBellAdd()` selbst, dessen
gesamter Rumpf der tote Aufruf ist) und in `renderAnrufeInbox()` für die Meldung
„Auswahl aufgehoben" (dort bereits `typeof`-geguardet, also stumm wirkungslos).
Beide gehören zu anderen Features; ob dort eine Meldung erscheinen soll, ist deren
Entscheidung, nicht die dieses PRs.

## 7. Zusammenführung mit PR #822 (Etappe-3-Redesign, Lara-Übergabe)

`main` @ `4608352`. Als Merge zusammengeführt, nicht als Rebase: ein Konflikt in
einer 2-MB-Einzeldatei einmal auflösen statt dreimal, und kein Force-Push auf den
offenen PR.

**Ein Konflikt, strukturell.** #822 versteckt `#dash-priority-section`
(„Aufmerksamkeit") vollständig und ersetzt den Heute-Screen durch die Lara-Übergabe
(`#dash-lara-message`, `#dash-needs-you-section`, `#dash-all-clear-section`,
`#dash-resolved-section`). Beide Seiten übernommen; der Ambient-Hinweis steht jetzt
vor der Lara-Nachricht: er sagt, was in dieser Sekunde passiert, die Übergabe sagt,
was seither liegen geblieben ist. **Die Platzierung ist die einzige Design-Setzung
dieses Merges** und im finalen Live-Test bewusst zu bestätigen.

**Der Fix trägt das neue Design.** Sechs echte Renderzyklen über den kompletten
`renderDashboard()`-Pfad des neuen Screens: derselbe Knoten, `liveRowEnter` konstant
bei 300, keine Wiederholung. Die Übergabe-Karten zeigen ausschliesslich den
beendeten Anruf, der Lara-Text zählt den laufenden nicht mit.

**Zwei Stellen greifen ineinander, eine davon widersprüchlich:**

`vxHeuteHandoverCardTimestamp()` bevorzugt bewusst `created_at` bzw.
`completed_at` und meidet `updated_at` — das war #822s Zeitzonen-Fix. Für das
Flackern ist das ein Glücksfall: anders als das alte `vxHeuteActivityTimestamp()`
ändern sich die Karten-Zeitstempel während eines Gesprächs nicht. Kein Konflikt.

`vxHeuteIsHandoverCall()` hat **keine eigene** Live-Phasen-Prüfung. Dass laufende
Anrufe nicht als „Braucht dich"-Karte erscheinen, hängt allein daran, dass die
Übergabe mit der bereits gefilterten `vxGetAnfragenSourceRecords()` gespeist wird.
Durch einen Test festgehalten.

### Offener Widerspruch: zwei Prädikate für dieselbe Regel

#822 filtert laufende Anrufe über `vxIsLiveCall()` (in
`vxGetAnfragenCountSourceRecords()` und `vxIsUnreadEligibleRecord()`), dieser PR
über `vxIsCallInLivePhase()`. Die beiden ziehen die Grenze unterschiedlich:
`vxIsLiveCall()` zählt auch `processing` und `in_progress` mit, also die Phase
**nach** dem Auflegen.

Gemessen am gemergten Stand:

| Phase | Anfragen-Liste | „Braucht dich" | Zähler/Badge | unread |
|---|---|---|---|---|
| `active` (Leitung offen) | 0 | 0 | 0 | false |
| `processing` (aufgelegt) | **1** | **1** | **0** | **false** |
| `completed` | 1 | 1 | 1 | true |

In der `processing`-Phase ist der Eintrag also sichtbar, wird aber nicht gezählt —
dieselbe Klasse von Fehler, die #822 beheben wollte, nur umgekehrt. Nach der
Lebenszyklus-Definition („Eintrag entsteht beim Auflegen") müsste `processing`
zählen; die Auflösung wäre, #822s beide Filter auf `vxIsCallInLivePhase()` zu
ziehen. Das ändert jedoch das ausgelieferte Verhalten von #822 und ist deshalb
hier **bewusst nicht** vorgenommen, sondern zur Entscheidung gestellt.

## 8. Testplan Deploy-Preview

- [ ] Während eines laufenden Anrufs: Hinweis blendet einmal ein und steht danach ruhig
- [ ] Kein Karten-Eintrag in "Aufmerksamkeit", "Anrufe heute", "Heute passiert", Anfragen
- [ ] KPI "Anrufe heute" zählt den Anruf erst nach dem Auflegen
- [ ] Beim Auflegen: Hinweis verschwindet, Eintrag erscheint mit "Wird verarbeitet"
- [ ] Zweiter paralleler Anruf: Hinweis wechselt auf "2 Anrufe laufen gerade", ohne neue Einblendung
- [ ] Toast, Glocke und Browser-Notification kommen weiterhin je Anruf einmal
