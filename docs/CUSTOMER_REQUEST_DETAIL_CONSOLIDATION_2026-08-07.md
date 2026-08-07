# Anfrage-Detail: Konsolidierung auf eine Komponente (Etappe 4, Teil A)

Datum: 2026-08-07
Branch: `claude/anfragen-screen-etappe-4-xhle96`
Basis: `ff9a829` (nach PR #823)

Dieses Dokument hält den Ist-Zustand vor der Änderung, die umgesetzte
Struktur und die Verifikation fest. Teil B (Terminverwaltung, Rückruf-Ergebnis,
KI-Korrektur) ist bewusst nicht Teil dieses Schritts — die neuen Funktionen
sollen auf der konsolidierten Struktur aufsetzen.

---

## 1. Ausgangslage (Fakt, per Code belegt)

Die Detailansicht einer Anfrage lag in **drei Renderern** auf **fünf Hosts**.

### Renderer

| Renderer | Ort vor der Änderung | Status |
|---|---|---|
| A — Legacy-Vollseite | `renderCallDetailPage()` / `renderTaskDetailPage()` in `#call-detail-page` | bleibt bestehen, ist nur noch Not-Fallback |
| B — Split-Panel (Detail-V2) | `vxRenderRequestsDetailV2` (PR-J1) plus **fünf** Monkey-Patch-Schichten | wird zur einen Komponente |
| C — v2-Vollbild | eigener Rahmen und eigene CSS-Kopie, Inhalt über Renderer B | wird zur zweiten Rahmung derselben Komponente |

Die Wrapper-Kette um Renderer B, von innen nach aussen:

1. PR-J1 — Basis-Renderer
2. PR-J4 — „Unbekannter Anrufer": `setTimeout` + `querySelectorAll('div')`, Textvergleich gegen die Telefonnummer
3. PR-M — Record-Clone für den Anzeigestatus
4. PR-N — zweiter Record-Clone für Badge-Labels, plus `TreeWalker` über das gerenderte DOM
5. PR-P — Aufgaben-Zweig mit eigenem `renderTask()`
6. PR-V2 — **zweiter** Aufgaben-Zweig mit eigenem `renderTask()`, plus Überschreiben der Aktionszeile per `innerHTML` nach dem Rendern

Zwei belegte Folgen daraus:

- **PR-P's Aufgaben-Renderer war toter Code.** PR-V2 fing Task-Records vorher ab,
  und dessen `isTaskRecord()` ist eine Obermenge von `isManualTaskRecord()`,
  das PR-P prüfte. Rund 180 Zeilen konnten nie laufen.
- **Die Aktionszeile wurde zweimal gebaut.** Der Basis-Renderer schrieb drei fest
  verdrahtete Buttons (ohne „Archivieren"), PR-V2 überschrieb die Zeile danach.

### Hosts

| Host | Lage |
|---|---|
| `#requests-detail-v2` | Anfragen-Seitenpanel — live |
| `#vx-detail-v2-full-content` | Vollbild-Overlay (Heute, Mobile) — live |
| `#call-detail-page` / `#call-detail-content` | Legacy-Vollseite — nur noch Not-Fallback |
| `#archiv-detail-v2` | **existiert nicht mehr im Markup**, siehe 4. |
| `#detail-overlay` | Markup vorhanden, wurde nie mehr befüllt, siehe 4. |

### CSS

Dasselbe `.vx-dv2-*`-Regelwerk lag **vierfach** vor, jeweils an Host-IDs
gebunden: PR-J1 (zur Laufzeit injiziert), PR-O2, PR-R3, PR-V2 — plus PR-P für
die Aufgaben-Ergänzungen.

Die PR-J1-Kopie erzeugte ihre Host-Varianten per String-Replace:

```js
style.textContent += style.textContent.replace(/#requests-detail-v2/g, '#archiv-detail-v2');
style.textContent += style.textContent.replace(/#requests-detail-v2/g, '#call-detail-content');
style.textContent += style.textContent.replace(/#requests-detail-v2/g, '#vx-detail-v2-full-content');
```

Jedes `+=` kopierte den bereits gewachsenen Inhalt. Ergebnis: die
`#archiv-detail-v2`-Regeln standen **4×** im Stylesheet, `#call-detail-content`
**2×**. Visuell folgenlos, aber es ist genau das Muster „eine Fläche mehr =
eine Kopie mehr".

### Ursache der wiederkehrenden Detail-Bugs

Mehrere Hosts konnten **gleichzeitig** gerenderten Inhalt halten — mit
denselben Element-IDs darin (`#vx-call-audio-card`, `#vx-dv2-note`,
`#call-detail-avatar`). Der Audio-Bug aus PR #821 ist genau dieser Fall: eine
versteckte, noch ladende Audio-Karte in einem anderen Host wurde über
`document.getElementById('vx-call-audio-card')` gefunden und hydriert. Der
Fix dort räumte `#call-detail-content` leer — richtig an der Stelle, aber die
Ursache (mehrere gleichzeitig gemountete Hosts) blieb.

---

## 2. Umgesetzte Struktur

### Eine Komponente

`vxRenderEntryDetail(record, { hostEl, frame })` — Block
`<script id="vx-entry-detail-component">`.

- Der Typ (Anfrage / Aufgabe) ist ein Zweig **innerhalb** der Komponente
  (`buildCallBodyHtml` / `buildTaskBodyHtml`), keine zweite Implementierung.
- Die Anzeige-Normalisierung passiert **einmal auf den Daten**
  (`normalizeForDisplay`) und ersetzt die drei Clone-Schichten sowie die zwei
  nachgelagerten DOM-Korrekturen. Sichtbares Ergebnis unverändert:
  Lebenszyklus-Status als deutsches Wort, humanisierte Kategorie und
  Lead-Qualität, kein Telefonnummern-Fallback im Namensfeld.
- Die Aktionszeile wird **einmal** gebaut (`buildActionRowHtml`), abgeleitet aus
  `vxBuildOperationalRowActions()`. Fallback, falls die zentrale Ableitung nichts
  liefert: Anrufen / Rückruf planen / Erledigen / Archivieren.
- `window.vxRenderRequestsDetailV2` bleibt als öffentlicher Name bestehen — rund
  zwanzig Aufrufstellen zeigen darauf — ist aber nur noch ein Alias.

### Zwei Rahmungen, ein Mount-Pfad

```
vxOpenEntryDetailV2(id)          ← einziger Router
  ├── openSplitV2()   → frame 'panel'    (#requests-detail-v2)
  └── openFullscreenV2() → frame 'overlay' (#vx-detail-v2-full-content)
        └── beide über mountDetail(record, hostEl, frame)
              └── releaseAllHostsExcept(hostEl)   ← Single-Mount-Invariante
              └── vxRenderEntryDetail(...)
```

`releaseAllHostsExcept()` stellt sicher, dass **genau eine** Fläche Inhalt
hält. Damit ist die ID-Kollision zwischen den Hosts strukturell ausgeschlossen,
ohne die Audio-Bridge oder deren Tests anzufassen.

### Ein Stylesheet

`<style id="vx-entry-detail-css">`, an die Shell-Klasse `.vx-dv2-shell`
gebunden statt an Host-IDs. Die vier Host-Kopien und der String-Replace-Block
entfallen. Eine weitere Fläche kostet damit keine CSS-Kopie mehr.

Design-System-Checkliste: `.vx-dv2-card` nutzt `var(--vx-ui-card-radius)`
(kanonisch 12px) statt eines hart geschriebenen Werts; die Anliegen-Karte nutzt
`var(--vx-font-serif)` (Newsreader), gleiche Sprache wie der Heute-Screen.

### Lebenszyklus

Der Router lehnt Anrufe in der Live-Phase ab — solange die Leitung steht,
existiert kein Eintrag. Bewusst `vxIsCallInLivePhase()` und **nicht**
`vxIsLiveCall()`: letzteres zählt `processing`/`in_progress` mit, also die Phase
**nach** dem Auflegen, die sich sehr wohl öffnen lassen muss („Wird
verarbeitet"). Siehe `docs/LIVE_CALL_LIFECYCLE_2026-08-07.md` §4.1.

Die Listen filtern Live-Phasen-Anrufe bereits an der Quelle; der Router war
weiterhin über eine ID erreichbar (Hash `#call/<id>`, Benachrichtigung,
`vxOpenPriorityRecord`).

---

## 3. Legacy-Vollseite: entkoppelt, nicht gelöscht

Renderer A bleibt in diesem Schritt bestehen. Entfernt sind nur seine
Verbindungen in die Panel-Fläche — er war über drei Wege ein zweiter Einstieg
dorthin:

1. `showCallDetail()` (Legacy) rendert nicht mehr in `#requests-detail-v2`.
2. `showTaskDetail()` (Legacy) hängt `#call-detail-page` nicht mehr in
   `#anrufe-split-right` um.
3. `hideCallDetail()` stellt die Legacy-Seite nicht mehr als Panel wieder her.

Erreichbar ist Renderer A jetzt über genau einen Pfad: `forceLegacy`, wenn sich
ein Datensatz nicht auflösen lässt. Dieser Pfad ist im Headless-Test geprüft
(siehe 5.).

**Löschung folgt als eigener Schritt** (~1.100 Zeilen JS plus 11 CSS-Blöcke),
damit dieser Diff prüfbar bleibt.

---

## 4. Zwei Funde am Rand

**`#archiv-detail-v2` war totes Gerüst.** `vxArchivRowClick()` suchte
`#archiv-split-right` / `#archiv-detail-v2`, rief den Renderer direkt auf und
hatte als zweiten Zweig den einzigen verbliebenen UI-Aufruf von
`renderCallDetailPage()`. Diese Elemente existieren nicht mehr im Markup, seit
Archiv eine Filter-Pille im Anfragen-Screen ist — nur `getElementById`-Abfragen,
nirgends erzeugt. Die Funktion routet jetzt über den Router; archivierte Zeilen
öffnen dasselbe Detail wie jede andere Zeile.

Nicht angefasst: die verwaisten Layout-Regeln zu `#archiv-detail-v2` /
`#archiv-split-*` in der CSS. Sie gehören zum entfernten Archiv-Tab, nicht zur
Detailansicht — Aufräumen gehört in den Löschschritt.

**`openDetail()` trug ein totes Template.** Die Funktion routete in ihren ersten
beiden Zeilen weg; die rund 60 Zeilen Overlay-Template danach waren
unerreichbar. Entfernt; die Aufrufstellen bleiben unverändert. Das
`#detail-overlay`-Markup und `closeDetail()` bleiben stehen — `closeDetail()`
wird noch von generischem Overlay-Schliess-Code gerufen. Beides gehört in den
Löschschritt.

**Zusätzlich behoben:** `resolveEntryRecord()` las für Anrufe sowohl die
lexikalische Variable als auch den `window`-Spiegel, für Aufgaben nur die
lexikalische. Die fehlende Symmetrie ist ergänzt.

---

## 5. Verifikation

### Statisch — `scripts/verify-customer-detail-consolidation.mjs` (CI)

Prüft die Invarianten, deren Verlust die Rückkehr zum Ausgangszustand bedeutet:

- jedes Inline-Script parst
- `window.vxRenderRequestsDetailV2` wird **genau einmal** zugewiesen
- kein Weiterreichen an einen vorherigen Detail-Renderer (`prevDetail`, `prevRender`, `previousRenderer`)
- die Shell wird nur an einer Stelle erzeugt
- kein Detail-CSS an Host-IDs, kein String-Replace-Kopieren
- `.vx-dv2-card` am kanonischen Radius-Token; Token-Owner steht auf 12px
- die Komponente wird nur in `mountDetail()` gemountet
- Legacy rendert nicht in die Panel-Fläche und wird nicht dorthin umgehängt
- der Router prüft die Live-Phase, und im Detail-Bereich taucht `vxIsLiveCall(` nicht auf
- kein Nachschreiben im DOM nach dem Rendern

### Headless-Browser gegen synthetische Daten

Chromium, `index.html` lokal serviert, Supabase gestubbt, fünf synthetische
Anrufe (offen / geplant / erledigt / live / processing) und eine Aufgabe.
**34 von 34 Prüfungen bestanden**, u.a.:

- Panel und Overlay erzeugen **identisches** Detail-Markup — für Anfrage und für Aufgabe
- im ganzen Dokument immer genau **eine** Detail-Instanz, eine `#vx-call-audio-card`, ein `#vx-dv2-note`
- `border-radius` der Karten in beiden Rahmen berechnet 12px; Anliegen in Newsreader
- Aktionszeile enthält Erledigen / Anrufen / Rückruf planen / Archivieren, ohne Duplikate
- Live-Phasen-Anruf lässt sich nicht öffnen, `processing`-Anruf sehr wohl
- Mobile (390×844) nutzt den Overlay-Rahmen
- keine neuen JS-Fehler

Separat geprüft: der `forceLegacy`-Pfad (unauflösbare ID) öffnet die
Legacy-Vollseite als Vollbild und hängt sich **nicht** in die Panel-Fläche.

Screenshots: Split-Panel Anfragen, Vollbild von Heute, Aufgabe in beiden
Rahmen, erledigter und geplanter Anruf, Mobile, Legacy-Fallback.

### Bestehende Prüfungen

Alle acht `customer-dashboard/tests/*.cjs` grün, ebenso
`audit-customer-runtime-reachability`, `audit-customer-design-ownership`,
`verify-customer-design-foundation`, `verify-customer-navigation-unified`,
`verify-customer-actions`.

---

## 6. Was offen bleibt

- **Nicht live getestet.** Alle Aussagen stammen aus Code, Tests und
  Headless-Browser gegen synthetische Daten. Verhalten gegen echte
  Supabase-Daten, echte Audio-Aufnahmen und echte Realtime-Updates ist im
  Deploy-Preview zu prüfen.
- **Löschung von Renderer A** (~1.100 Zeilen JS, 11 CSS-Blöcke) plus
  `#detail-overlay`, `closeDetail()` und die verwaisten Archiv-CSS-Regeln:
  eigener Folgeschritt.
- **Teil B** (Terminverwaltung, Rückruf-Ergebnis, KI-Korrektur) setzt auf dieser
  Struktur auf.
- `vxSplitUpdateActionBar()` ist seit v2.66 ein leerer Rumpf und hat jetzt keine
  Aufrufer mehr. Nicht entfernt, gehört in den Löschschritt.
