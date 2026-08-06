# B-P1-01: Anfragen-Detailauswahl folgt jetzt dem aktiven Filter — 2026-08-06

**Baseline:** `origin/codex/restore-customer-launch-checks` (enthält die gemergten PRs #805–#808)
**Source finding:** Design-Audit PR #804, B-P1-01
**Datei:** `customer-dashboard/index.html`, Funktion `renderAnrufeInbox()` (Zeile ~23156)

Kein Deploy durchgeführt. Alle Zahlen unten stammen aus echten Chromium/Playwright-Messungen gegen die tatsächliche `index.html`, wie bei den letzten beiden Fixes lokal per Static-Server ausgeliefert.

## Root Cause: aktualisiert gegenüber der Vorgabe

Die vorgegebene Root Cause nannte `searchList()` (Zeile ~27121), das nur `.hidden` auf `.call-row`-Elementen toggelt. Das stimmt für den Code, den der Design-Audit damals analysiert hat — **im aktuellen Stand ist `searchList()` für den Anfragen-Tab aber toter Code**: `_vxFbListMap`/`_vxFbState` kennen nur noch den einzigen Key `anrufe`, und `vxFbSearch('anrufe', ...)` ruft für diesen Key nicht `searchList()` auf, sondern `renderAnrufe()` (`index.html:25145-25146`). `searchList()` wird nirgends mehr für die Anfragen-Suche erreicht.

Der reale, aktuell aktive Mechanismus: `renderAnrufe()` berechnet aus `allRecords`/`allManualTaskRecords` über `vxGetAnfragenSourceRecords()` eine gefilterte, sortierte Liste (`sorted`) — Filter-Chip, Sub-Filter UND `window._anrufeSearchQuery` (die Sucheingabe) fließen hier zusammen — und übergibt sie an `renderAnrufeInbox('anrufe-list', sorted, filter)`. Diese Funktion wendet eine weitere Ausschluss-Regel an (`vxIsExcludedNormalCall` — blendet z. B. Live-Calls aus) und rendert erst dann die eigentliche Liste bzw. den Empty-State.

**Der Bruch:** Nirgends in dieser Kette wird geprüft, ob der Datensatz, der *aktuell rechts im Detail* offen ist (`window._vxActiveRecordId`, gerendert in `#requests-detail-v2`/`.vx-dv2-shell` — der tatsächlich lebende Pfad, bestätigt in PR #808; `#call-detail-page` ist auf jeder Desktop-Breite tot, siehe dort), noch Teil der neu berechneten `visibleRecords` ist. `renderAnrufe()` ruft zwar `vxSetActiveRequestRow(window._vxActiveRecordId)` erneut auf, um die Zeilen-Hervorhebung zu aktualisieren (`index.html:23114`) — aber `vxSetActiveRequestRow` (`index.html:10778`) toggelt nur `sp-active` auf vorhandenen Zeilen; findet es keine passende Zeile mehr, passiert schlicht nichts. Das Detail-Panel bleibt unangetastet.

## Wo genau der Fix sitzt

In `renderAnrufeInbox()`, direkt nach der Berechnung von `visibleRecords` (der Liste, die *tatsächlich* gleich gerendert wird — nach allen Filtern inklusive `vxIsExcludedNormalCall`) und vor dem Empty-State-Branch:

```js
if (
  typeof getCurrentTabName === 'function' && getCurrentTabName() === 'anrufe' &&
  window._vxActiveRecordId &&
  !visibleRecords.some(function(rec) { return rec && String(rec.id) === String(window._vxActiveRecordId); })
) {
  if (typeof vxForceCloseCallDetail === 'function') vxForceCloseCallDetail('active-record-filtered-out');
  if (typeof vxToast === 'function') {
    vxToast({ type: 'info', title: 'Auswahl aufgehoben', sub: 'Die geöffnete Anfrage ist im aktuellen Filter nicht mehr sichtbar.' });
  }
}
```

Bewusste Entscheidungen:

- **`renderAnrufeInbox()` statt `renderAnrufe()`**, weil erstere Funktion die *endgültige* sichtbare Liste berechnet (inklusive der `vxIsExcludedNormalCall`-Ausschlüsse). Ein Check in `renderAnrufe()` gegen `sorted` allein hätte den in Abschnitt „Realtime-Fall" beschriebenen Fall (Datensatz wird live zum Live-Call und dadurch ausgeschlossen) verpasst.
- **Wiederverwendung von `vxForceCloseCallDetail()`** statt einer neuen Reset-Routine — das ist bereits die im Code etablierte Funktion für „Detailansicht zwangsweise schließen und in konsistenten Zustand bringen" (u. a. von `vxEnsureNoOrphanDetailView()` für einen strukturell verwandten Fall verwendet: URL-Hash und Detail-Sichtbarkeit laufen auseinander). Sie schließt sowohl `#call-detail-page` als auch `#requests-detail-v2`, leert `window._vxActiveRecordId`/`_vxCurrentCallId`/`_vxCurrentTaskId`, stellt den Empty-State wieder her und hebt die Zeilen-Hervorhebung auf — alles in einem Aufruf, keine Duplikation.
- **Gate auf `getCurrentTabName() === 'anrufe'`**: `renderAnrufe()`/`renderAnrufeInbox()` laufen bei *jedem* Poll- und Realtime-Refresh im Hintergrund mit, unabhängig davon, welcher Tab gerade aktiv ist (bestätigt: derselbe zentrale Refresh-Zyklus, der auch `renderDashboard`, `renderRueckrufe`, `renderArchiv`, `updateLiveHero` aufruft, `index.html:21061-21065`). `#requests-detail-v2` ist aber nur dann die sichtbare Detailansicht, wenn der Anfragen-Tab aktiv ist (`useDetailV2` erfordert `anrufeTabActive`, `index.html:~19100`). Ohne dieses Gate hätte der Fix einen auf einem *anderen* Tab (z. B. „Heute") offenen Task/Call-Detail fälschlich geschlossen, nur weil er zufällig nicht im aktuellen Anfragen-Filter auftaucht — mit Playwright verifiziert, siehe unten.
- **Auswahl aufheben statt „außerhalb des Filters" markieren** — Begründung im nächsten Abschnitt.

## UX-Entscheidung: Aufheben statt Markieren

Zwei Optionen standen zur Wahl. Empfehlung: **Auswahl aufheben (Empty-State), nicht als „außerhalb des Filters" markiert weiter anzeigen.**

Gründe:
1. **Konsistenz mit dem bereits etablierten Pattern.** `vxForceCloseCallDetail()` ist im Code schon die anerkannte Antwort auf „Detailansicht und tatsächlicher Zustand laufen auseinander" (siehe `vxEnsureNoOrphanDetailView()`). Eine zweite, abweichende Behandlung nur für den Filter-Fall wäre eine neue, konkurrierende UX-Regel für dieselbe Problemklasse.
2. **Der Realtime-Fall macht „weiter anzeigen, nur markiert" riskant.** Wenn ein Datensatz während der offenen Ansicht live seinen Status ändert (z. B. wird zum aktiven Call, wird von jemand anderem archiviert), zeigt ein reines Badge weiterhin die alten Detaildaten — der Nutzer könnte auf Basis veralteter Information handeln (z. B. zurückrufen, obwohl der Fall bereits erledigt wurde). Schließen ist die sicherere Antwort, weil sie erzwingt, dass jede angezeigte Information frisch ist.
3. **Geringerer Implementierungsaufwand für denselben Nutzen.** Eine „außerhalb des Filters"-Markierung bräuchte eigene UI, eine Entscheidung, welche Aktionen dabei noch erlaubt sind, und einen Rückweg in den passenden Filter — für einen Effekt, der praktisch selten und meist beabsichtigt ist (der Nutzer hat aktiv gesucht oder gefiltert; dass sein vorheriger Treffer nicht mehr passt, ist der erwartete Fall, kein Fehler).
4. **Der Empty-State kommuniziert bereits klar, warum nichts (mehr) passt** — links und rechts zeigen dann dieselbe Aussage, statt sich zu widersprechen (genau der im Audit beschriebene Bug).

Als Kompromiss für die Kontinuität: ein kurzer Toast erklärt, *warum* die Auswahl aufgehoben wurde („Die geöffnete Anfrage ist im aktuellen Filter nicht mehr sichtbar."), statt dass das Panel kommentarlos zuklappt.

## Weitere Stellen mit derselben Inkonsistenz-Klasse — geprüft

Wie gefordert wurde gezielt nach weiteren Stellen gesucht, an denen Live-Daten-Änderungen dieselbe Diskrepanz auslösen könnten:

- **Alle Datenquellen für die Anfragen-Liste laufen durch `renderAnrufeInbox()`.** `renderAnrufe()` wird sowohl von der Such-/Filter-UI als auch vom zentralen Poll-/Realtime-Refresh-Zyklus aufgerufen (`index.html:21062`, Teil derselben Funktion, die `updateLiveHero()` und die übrigen Tab-Renderer triggert) — beide Pfade münden in `renderAnrufeInbox()`, wo der Fix sitzt. Ein separater Hook für „Realtime" wäre redundant gewesen; der gewählte Ansatzpunkt deckt beide Auslöser mit derselben Prüfung ab. Mit Playwright verifiziert (Szenario 3 unten): ein Datensatz, der *ohne* Suchänderung allein durch eine Felddatenänderung (`live_status` wechselt zu `active`) aus `visibleRecords` fällt, schließt das Detail genauso zuverlässig.
- **`#dash-priority-list` (Heute-Tab)** hat kein äquivalentes „Detail bleibt offen, Liste ändert sich"-Problem in derselben Form, weil dort keine mit `#requests-detail-v2` vergleichbare eingebettete Detailansicht existiert, die von einer Live-Neuberechnung der Liste getrennt aktualisiert wird — offene Details werden dort (sofern nicht auf dem Anfragen-Tab) über `#call-detail-page` im Fullscreen-Modus gezeigt, dessen Sichtbarkeit nicht an eine gefilterte Zeilen-Liste gekoppelt ist. Nicht Teil dieses Fixes, aber als eigenständig geprüft und für nicht betroffen befunden.
- **Der Sortier-/Filter-Chip-Pfad** (`vxFbFilter`, `anrufeChipFilter`) läuft ebenfalls über `renderAnrufe()`/`renderAnrufeInbox()` — derselbe Fix greift dort automatisch mit, kein Sonderfall nötig.

## Verifikationsmethode

Wie bei den letzten beiden Fixes: `customer-dashboard/` lokal über `python3 -m http.server` ausgeliefert, echte `index.html` unverändert in Playwright/Chromium geladen, alle Netzwerkaufrufe außer zum lokalen Server geblockt. Zusätzlich neu in diesem Test: der App-eigene Auto-Refresh-Timer (`autoRefreshTimer`, ruft `loadData()`/`renderAnrufe()` alle ~9–12 Sekunden auf, unabhängig vom Testzustand) musste explizit still gelegt werden (`clearInterval`/`clearTimeout` über den gesamten ID-Bereich), da er sonst mit leeren `allRecords` im Hintergrund echte `renderAnrufeInbox()`-Aufrufe auslöste und die Testzustände zwischen den Prüfschritten verfälschte — ein reines Testartefakt, keine Auswirkung auf den eigentlichen Fix, aber ein wichtiger Fund für zukünftige Tests an diesem Refresh-Zyklus.

Vier Szenarien, `renderAnrufeInbox()` direkt mit kontrollierten Eingaben aufgerufen (deterministisch, ohne auf echte Suchtext-Eingabe/Sortierlogik angewiesen zu sein):

1. **Suche liefert null Treffer, Detail ist offen** → Detail schließt: `window._vxActiveRecordId` wird `null`, `#requests-detail-v2` wird `display:none` mit geleertem `innerHTML`, der Empty-State-Platzhalter wird wieder sichtbar, ein Toast erklärt den Vorgang.
2. **Gefilterte Liste enthält den offenen Datensatz weiterhin** → Detail bleibt unverändert offen, kein Toast.
3. **Datensatz fällt durch eine reine Felddatenänderung aus der Liste** (`live_status` wechselt zu `active`, keine Sucheingabe beteiligt) → schließt genauso wie Szenario 1 — das ist der angeforderte Realtime-Nachweis.
4. **Anfragen-Tab ist nicht aktiv** (`#tab-dashboard` aktiv) → ein dort offenes Detail bleibt unangetastet, kein Toast — bestätigt, dass das Gate korrekt verhindert, tab-fremde Detailansichten zu schließen.

**Negativkontrolle**, um zu belegen, dass die Testsuite den Bug tatsächlich erkennt: dieselben vier Szenarien liefen zusätzlich gegen die unveränderte Original-Datei. Ergebnis exakt wie erwartet:

```
FAIL — scenario1: detail closed ...
       activeRecordIdAfter: "call-a", detailV2Display: "block",
       detailV2Html: "...Detail for call-a...", listHtmlSnippet: "...Keine offenen Anfrag[en]..."
FAIL — scenario3: closes when the open record becomes a live call ...
       activeRecordIdAfter: "call-d", detailV2Display: "block", ...
PASS — scenario2, scenario4 (unverändert korrekt, da nie kaputt)
```

Das ist der Bug reproduziert und gemessen, nicht nur aus dem Code abgeleitet: die Liste zeigt bereits „Keine offenen Anfragen", während `#requests-detail-v2` weiterhin sichtbar den alten Datensatz zeigt — exakt der im Audit beschriebene Widerspruch. Szenario 2 und 4 bestehen auf beiden Ständen, was bestätigt, dass die Testsuite gezielt den Bug isoliert statt pauschal irgendetwas anders zu bewerten.

Alle Testskripte liefen im Scratchpad der Sandbox und wurden entfernt; beide lokalen HTTP-Server wurden gestoppt.

## Deploy-Preview-Checkliste (für wer auch immer den Fix anwendet)

- [ ] Anfragen-Tab öffnen, eine Anfrage auswählen, dann im Suchfeld einen Begriff eingeben, der auf keinen Treffer passt — Detailbereich muss auf den Empty-State zurückfallen, kurzer Toast erscheint.
- [ ] Dieselbe Anfrage erneut öffnen, dann Filter-Chip wechseln (z. B. „Offen" → „Erledigt"), sodass die Anfrage nicht mehr zum Filter passt — gleiches Verhalten erwartet.
- [ ] Eine Anfrage öffnen und währenddessen (z. B. über einen zweiten Tab/Admin) ihren Status live ändern, sodass sie aus der aktuellen Filteransicht fällt — Detail muss automatisch schließen.
- [ ] Sicherstellen, dass normales Suchen/Filtern *ohne* dass die offene Anfrage betroffen ist, das Detail unangetastet lässt.
- [ ] Ein Detail vom Heute-Tab aus öffnen und parallel im Hintergrund die Anfragen-Liste durch einen Poll-Refresh aktualisieren lassen — das Heute-Detail darf nicht geschlossen werden.

## Rollback

Reine, lokal begrenzte JS-Änderung (ein `if`-Block) in `customer-dashboard/index.html`, keine Migration, kein Schema. Revert des Commits und Redeploy des vorherigen Builds ist ein vollständiger Rollback.

## Nicht in diesem PR

- `searchList()` (Zeile ~27169) selbst — bleibt als toter Code bestehen; Aufräumen ist eine separate Entscheidung, nicht Teil dieses Fixes.
- P0-1–P0-4, A-P0-01, B-P0-01 — bereits in gemergten PRs #805–#808.
