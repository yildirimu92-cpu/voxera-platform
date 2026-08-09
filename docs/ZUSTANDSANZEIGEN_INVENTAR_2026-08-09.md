# Inventar: Zustandsanzeigen dashboardweit (Toasts, Live-Anruf-Karte, Speicher-Rückmeldungen)

**Datum:** 2026-08-09 · **Branch:** `claude/toasts-zustandsanzeige-7fghjh` · **Status: AUDIT, kein Code geändert.**

Auftragsgrundlage: Briefing "Alle Zustandsanzeigen dashboardweit aufs Design-System bringen".
Auftragspunkt 2 verlangt die Rückmeldung der Liste, bevor grossflächig geändert wird — das ist
dieses Dokument.

Geltungsbereich: `customer-dashboard/`. Das Admin-Portal wurde geprüft und enthält keinen
einzigen `toast(`-Aufruf (`admin-panel/index.html`, `login.html`, `offer-pdf.html` = 0 Treffer),
es ist also nicht nur per Scope-Entscheid, sondern faktisch nicht betroffen.

Kennzeichnung nach No-Assumption-Regel: **Fakt** = im Code belegt, **Bewertung** = Einschätzung,
**Unverifiziert** = nicht geprüft.

---

## Kurzfassung

Die befürchtete Streuung tritt bei den Toasts **nicht** ein: es gibt genau **einen** lebenden
Renderer, alle ~167 Aufrufe laufen durch ihn. Die Umstellung ist dort im Kern eine CSS-Arbeit an
einem Block.

Dafür fördert die Inventarisierung drei Dinge zutage, die das Briefing nicht kennen konnte:

1. Ein **zweites, totes Toast-System** (`vx-toast` / `vxToast()`) — inklusive einem **echten
   Laufzeitfehler**, der bei jeder eingehenden Realtime-Benachrichtigung ausgelöst wird.
2. Die **Live-Anruf-Karte ist optisch bereits auf dem Design-System** — die Briefing-Prämisse
   ist an diesem Punkt überholt. Offen sind Inhalt und ein fehlendes Absenderzeichen.
3. Die dunkle Fläche **oben rechts**, an der es dem User aufgefallen ist, ist mit hoher
   Wahrscheinlichkeit **gar kein Toast**, sondern `#incoming-banner` — eigene Fläche, eigenes
   CSS, eigener Timer, nicht über `toast()`.

---

## Familie 1 — Toasts

### 1A. `toast()` / `showToast()` — der lebende Renderer (IN SCOPE)

| | |
|---|---|
| Renderer | `toast(msg, type)` — `index.html:16097` |
| Adapter | `showToast(msg, type)` — `index.html:16132`, delegiert 1:1 an `toast()` |
| Markup | genau ein Knoten: `<div class="toast" id="toast">` — `index.html:8748` |
| CSS | `index.html:1943–1975` (Basis) · `2231` (Bottom-Nav) · `4207–4223` (Mobile-Override) |
| Aufrufe | 131× `toast(...)` + 33× `showToast(...)` in `index.html`, 3× aus Shared-Modulen |

Die drei Aufrufe aus Shared-Modulen gehen defensiv über `root.toast` / `w.toast`:
`customer-runtime-commercial-controller.js:287`, `customer-runtime-case-intake.js:90`,
`customer-runtime-help-route.js:74`.

**Fakt — aktuelles Aussehen:** dunkle Glas-Pille, `background:rgba(15,23,42,0.88)`, weisse
Schrift, `backdrop-filter:blur(20px)`, Rahmen `rgba(255,255,255,0.16)`. Desktop unten zentriert,
Mobile volle Breite unten über der Tab-Bar.

**Fakt — Tonalitäten:** vier — `success` / `info` / `warning` / `error`. Getragen werden sie
**ausschliesslich** vom 18px-Icon-Kreis; Fläche, Rahmen und Textfarbe sind bei allen vier
identisch. Hartkodiert sind dabei vier `rgba()`-Werte im CSS (`1970–1973`) und vier
`stroke`-Hexwerte in den Inline-SVGs (`16110–16114`).

**Fakt — Typ-Herleitung:** nur 49 der ~167 Aufrufe übergeben einen expliziten Typ
(5× `error`, 12× `info`, 7× `success`, 25× `warning`). Die restlichen ~118 verlassen sich auf
die Regex-Ableitung in `toast()` (`/fehler|nicht|ungültig|konnte nicht|fehlgeschlagen/i` → error,
`/bitte|warn|achtung/i` → warning, `/info|hinweis/i` → info, sonst success).

> **Bewertung, relevant für Auftragspunkt 3 ("Tonalität nicht einebnen"):** die Unterscheidung
> ist heute schon extrem schwach — ein 18px-Kreis auf sonst identischer Fläche. Beim Umbau auf
> die helle Karte muss die Tonalität *sichtbarer* werden als heute, sonst wird der Auftrag
> formal erfüllt und praktisch eingeebnet.

> **Bewertung, Risiko:** die Regex-Ableitung ist eine stille Fehlerquelle — `toast('Rückruf als
> neue Aufgabe geplant')` ohne Typ wird zu `success`, `toast('Bitte bestätigen Sie das
> Ergebnis.')` zu `warning`. Das ist heute kaum sichtbar, weil sich die vier Tonalitäten kaum
> unterscheiden. Wird die Unterscheidung deutlicher, werden auch die Fehlableitungen sichtbar.
> **Nicht Teil dieses Auftrags**, aber vor dem Umbau zu benennen.

### 1B. `vx-toast` / `vxToast()` — totes Zweitsystem **und ein echter Bug** (ENTSCHEIDUNG NÖTIG)

| | |
|---|---|
| CSS | `index.html:381–398` — "IN-APP TOAST v3.0 (Voxera CI)" |
| Markup | `<div id="vx-toast-container">` — `index.html:8443` |
| Renderer | **existiert nicht.** `vxToast()` ist nirgends definiert. |

**Fakt:** Der Codekommentar bei `index.html:17253` benennt das bereits ausdrücklich
("*vxToast() ist im Repo aber nur dokumentiert und nirgends implementiert*"). An der damaligen
Fundstelle wurde der Aufruf entfernt — **drei weitere blieben stehen**:

| Stelle | Zustand |
|---|---|
| `index.html:10394` | **ungeschützt** — im Realtime-`INSERT`-Callback für `notifications` |
| `index.html:10422` | ungeschützt, in `vxBellAdd()`; `vxBellAdd()` hat selbst keinen Aufrufer mehr |
| `index.html:22293` | mit `typeof`-Wächter — feuert also stillschweigend nie |

**Fakt — Folgeschaden bei `10394`:** Das `try/catch` in `vxNotifSubscribe()` umschliesst nur den
Aufbau der Subscription, nicht den später asynchron laufenden Callback-Körper. Der
`ReferenceError` bricht den Callback ab, und die **direkt darauffolgende Zeile 10395** wird nicht
mehr erreicht:

```js
vxToast({ ... });                                    // ← wirft ReferenceError
if (_vxBellOpen) { vxBellRender(); vxBellPageRender(); }   // ← wird nie erreicht
```

Konkrete Auswirkung: Badge-Zähler wird noch aktualisiert (Zeile davor), aber **bei geöffnetem
Glocken-Popover erscheint eine neu eintreffende Benachrichtigung nicht in der offenen Liste** —
sie taucht erst beim nächsten Öffnen auf.

**Unverifiziert:** Nicht im Browser gegen eine echte Realtime-Zustellung nachgestellt. Die
Ableitung ist reine Code-Lesung; der fehlende Renderer ist dagegen per Grep belegt.

### 1C. `#incoming-banner` — dieselbe Designsprache, kein Toast im Code (ENTSCHEIDUNG NÖTIG)

| | |
|---|---|
| CSS | `index.html:1336–1364`, Breakpoints `2195`, `2539` |
| Markup | `index.html:7357–7364` |
| Renderer | `showIncomingBanner(count, newRecords)` — `index.html:19878` |

**Fakt:** Dunkle Glasfläche `rgba(17,24,39,0.92)`, weisse Schrift, eigener 8-Sekunden-Timer,
eigenes Markup, **nicht** über `toast()`. Position: `top:96px`, horizontal über der
Content-Spalte zentriert (`left:calc(232px + (100vw - 232px)/2)`) — also rechts der Sidebar und
oben.

> **Bewertung:** Das ist mit hoher Wahrscheinlichkeit die Fläche aus dem User-Screenshot
> ("Anruf-Toast oben rechts"). Der eigentliche `toast()` sitzt unten zentriert, der tote
> `vx-toast` unten rechts — keiner der beiden passt zu "oben rechts". Nicht endgültig belegt,
> da der Screenshot hier nicht vorliegt.

**Fakt — Nebenfund Vier-Familien-Regel:** Der pulsierende Punkt ist `#22c55e` — Grün. Nach der
Farbrollen-Regel ist Grün den Abschluss-Aktionen zugeordnet (Erledigen, Checkmarks). Ein
eingehender Anruf ist kein Abschluss. Die Live-Anruf-Karte löst denselben Sachverhalt bereits
korrekt über `--vx-color-danger` (Rot = Dringlichkeit). Zwei Anzeigen für "es passiert gerade
etwas", zwei verschiedene Farbfamilien.

---

## Familie 2 — Live-Anruf-Karte

| | |
|---|---|
| Renderer | `updateLiveHero(records)` — `index.html:17284–17345` |
| Host | `#dash-live-ambient` — `index.html:7649` (`role="status" aria-live="polite"`) |
| CSS | `index.html:363–378` |
| Test | `customer-dashboard/tests/live-call-lifecycle.test.cjs` |
| CI | `.github/workflows/verify-live-call-lifecycle.yml` |

**Fakt — die Optik ist bereits umgestellt.** Der Kommentar bei `index.html:355–362` dokumentiert
den Umbau: die rote linke Kante ist bereits entfernt, die Karte nutzt durchgängig
`--vx-ui-row-*` (Fläche, Rahmen, Radius, Typo), das "Live"-Abzeichen läuft über
`--vx-color-danger` / `--vx-color-danger-bg`. **Die Briefing-Prämisse "fällt sichtbar aus der
Designsprache" trifft auf die Fläche nicht mehr zu.**

**Auftragspunkt 5 verlangt ausdrücklich "prüfen, nicht annehmen" beim roten Abzeichen —
Ergebnis: es passt.** Rot = Dringlichkeit, ein laufendes Gespräch ist der Live-Zustand
schlechthin, und die Rollen-Tokens sind bereits verwendet. Keine Änderung nötig.

**Was tatsächlich offen ist:**

1. **Inhalt (User-Wunsch, Kern des Auftrags).** `index.html:17308–17311`:
   - `'Ein Anruf läuft gerade'` bzw. `n + ' Anrufe laufen gerade'`
   - `'Der Eintrag erscheint, sobald das Gespräch beendet ist.'`

   Rein technische Sprache, während der Rest des Screens aus der Assistenten-Perspektive
   spricht.

2. **Fehlendes Absenderzeichen — der eigentliche Designbruch.** `.vx-live-avatar` ist unter
   `index.html:373` vollständig definiert (34px, Night-Fläche, weisse Initiale), **wird im
   Markup bei `index.html:17332–17338` aber nie ausgegeben.** Die Karte hat damit als einzige
   Zustandsfläche auf Heute kein Absenderzeichen — genau das Merkmal, über das die
   Lara-Übergabekarte "Assistent spricht" signalisiert. Totes CSS und die eigentliche Lücke
   fallen hier zusammen.

3. **Korrektur zum Briefing:** Das Briefing nennt bei der Lara-Übergabekarte eine
   "Gold-Avatar-Initiale". **Fakt:** Der Avatar ist Night, nicht Gold — `index.html:7396–7405`,
   `background:var(--vx-color-night,#0D1F3C)`, weisse Schrift, 15px/700 Sans, bewusst identisch
   zu `.vx-dv2-avatar` im Detail-Panel. Gold wäre nach der Vier-Familien-Regel auch falsch
   (Gold = ausschliesslich Lead-Qualität). Der Live-Avatar auf Night anzulehnen ist damit
   sowohl das bestehende Muster als auch regelkonform.

**Fakt — Assistentenname ist verfügbar und darf nicht hartkodiert werden.**
`customerMeta.assistantName` wird in `vxHeuteRenderLaraHandover()` bereits so gelesen
(`index.html:20679`, Fallback `'Lara'`), inklusive Initiale via `.charAt(0).toUpperCase()`.
`vxSyncAssistantNameCopy()` (`index.html:20768`) zieht statische Textstellen nach und läuft bei
jedem `renderDashboard()`. `updateLiveHero()` läuft ebenfalls in diesem Zyklus — eine Umbenennung
zieht also ohne Zusatzarbeit mit.

**Fakt — Testbindung.** Der Regressionstest prüft die Textkonstanten wörtlich:
`live-call-lifecycle.test.cjs:332` (`'Ein Anruf läuft gerade'`) und `:341`
(`'2 Anrufe laufen gerade'`). Eine Textänderung ist ohne Testanpassung nicht möglich. Der Test
schützt daneben zwei echte Invarianten (kein Live-Anruf in einer Liste; Knoten-Identität über
Re-Renders) — die bleiben unangetastet.

**Fakt — Fingerprint-Einschränkung.** `index.html:17303`: `var fingerprint = 'live:' +
liveRecs.length;` — der Knoten wird nur bei geänderter *Anzahl* neu bewertet. Wird der
Assistentenname Teil des Textes, zieht eine Umbenennung mitten im Gespräch nicht nach, weil der
Fingerprint gleich bleibt. Der Textpatch-Zweig (`17313–17322`) läuft ebenfalls nur bei
Fingerprint-Änderung. **Bewertung:** praktisch folgenlos (Umbenennung während eines laufenden
Gesprächs), aber der Fingerprint müsste den Namen mit aufnehmen, wenn man es sauber will —
eine Zeile.

---

## Familie 3 — Speicher-Rückmeldungen ausserhalb des Assistent-Tabs

Suchmuster (aus dem in PR #864 dokumentierten Vorgehen übernommen und erweitert): `vxInlineSaveStatus`,
`gespeichert`, `dataset.state`, `style.color = '#059669'`, `btn.textContent = 'Wird gespeichert`,
`vx-settings-feedback`, alle `onclick="…[Ss]ave…"`.

### Klar im Auftrag

| # | Stelle | Muster heute | Befund |
|---|---|---|---|
| 1 | `vxSaveProfil()` — `index.html:14772` | Statustext `#fb-profil-page`, `'✓ Profil aktualisiert.'` | Getrennter Statustext unter dem Knopf. **Zusätzlich:** `fb.style.color = '#059669'` bzw. `'#DC2626'` inline — überschreibt die Token-Farben von `.vx-settings-feedback[data-state]` und ist damit ein zweiter, hartkodierter Farbpfad. |
| 2 | `vxSavePassword()` — `index.html:14788` | Statustext `#fb-password`, `'✓ Passwort geändert.'` | identisch zu 1, gleiche Inline-Farben. |

Markup beider Knoten: `index.html:8015` und `8025`, Klasse `vx-settings-feedback`,
CSS in `shared/customer-settings-components.css:758`.

### Ausgeklammert (Briefing)

| # | Stelle | Grund |
|---|---|---|
| 3 | `vxSaveBenachrichtigungen()` — `index.html:14826`, Knoten `#fb-benachrichtigungen` (`8053`) | `#mehr-sub-benachrichtigungen` wird parallel neu gebaut. Nutzt als einzige der drei sauber `dataset.state` statt Inline-Farben. |

### Grenzfälle — Rückmeldung nötig, nicht eigenmächtig entschieden

| # | Stelle | Befund | Vorschlag |
|---|---|---|---|
| 4 | `changePassword()` — `index.html:25659` | **Toter Code.** Greift auf `#pw-new`, `#pw-confirm`, `#pw-save-btn`, `#pw-error`, `#pw-success` zu — **keines dieser Elemente existiert im Markup**; nur ein defensiver Reset bei `25068–25070` fasst zwei davon an. Kein Aufrufer. Ein zweiter, längst abgelöster Passwort-Pfad neben `vxSavePassword()`. | Ersatzlos entfernen (Grundsatz "add-only-Patches vermeiden", AGENTS.md). Nicht umstellen — das wäre Arbeit an unerreichbarem Code. |
| 5 | `vxDv2SaveNote()` — `index.html:31096` | Trägt den Zustand **bereits am Knopf** (`'Speichert…'` → `'Gespeichert ✓'` → `'Speichern'`) — richtiges Muster, aber eigener Nachbau statt `vxInlineSaveStatus()`, plus hartkodierte `#059669` / `#0D1F3C` / `#DC2626` über direktes `btn.style.background`. Liegt im Anfragen-Detail, nicht in den Einstellungen. | Auf `vxInlineSaveStatus()` + Rollen-Tokens ziehen. Die Fläche ist gemeinsam genutzt → Grundsatz 14. |
| 6 | `activationConfirmDeactivation()` — `index.html:26476`<br>`activationStartSmartphone()` — `index.html:26913` | `btn.textContent = 'Wird gespeichert…'`, **kein** Fertig-Zustand; Ergebnis kommt per Toast. Halbes Muster. | Im Aktivierungsflow, nicht in den Einstellungen. Bewertung: gehört fachlich dazu, ist aber ein eigener Screen mit eigener Zustandslogik (`renderActivationV2()` rendert direkt danach neu). Rückfrage statt Annahme. |
| 7 | `vxCommercialSubmit()` — `index.html:14781` und `shared/customer-runtime-commercial-controller.js:280–295` | `#vx-commercial-status` mit `dataset.state='success'` und einem **Block mit Referenznummer**; Knopf wird dauerhaft zu `'Übermittelt'`. | **Nicht umstellen.** Das ist keine Speicher-Rückmeldung, sondern eine *Quittung* mit bleibendem Inhalt (Referenz), die den flüchtigen `vxInlineSaveStatus()`-Zyklus nicht überleben würde. Gleiche Fehlerklasse wie die 14 bewusst unangetasteten Amber-Stellen in PR #886: gleiche Optik, andere Bedeutung. |

### Bereits erledigt — geprüft, keine Änderung nötig

| Stelle | Status |
|---|---|
| `shared/customer-runtime-calendar-settings.js:197, 213` | auf `vxInlineSaveStatus()` (PR #840 + #864) |
| `shared/customer-runtime-operational-updates.js:111, 112` | auf `vxInlineSaveStatus()` (PR #840) |
| `shared/customer-runtime-assistant-profile.js:1243` | auf `vxInlineSaveStatus()` (PR #840) |

Die verbliebenen Statuszeilen `#vx-calendar-status` und `#vx-ops-status` tragen **Lade- und
Sync-Warnungen**, keine Speicher-Bestätigungen (z.B. "Prompt-Sync ist noch ausstehend"). Sie
sind bewusst neben dem Knopf-Muster stehen geblieben und gehören nicht umgestellt.

### Ausserhalb: Alt-Screen `#tab-einstellungen`

**Fakt:** Der Alt-Screen (`index.html:8118 ff.`) enthält die Schalter-IDs
`inapp-setting-important-requests`, `inapp-setting-callbacks-and-tasks`, `inapp-setting-system`
**ein zweites Mal** — dieselben IDs wie auf `#mehr-sub-benachrichtigungen`. Das ist der bereits
dokumentierte Befund B3 aus der Benachrichtigungs-Diagnose. Erreichbar nur über zwei
Navigationseinträge mit `style="display:none"` (`index.html:7312`, `8414`).

**Nicht anfassen** — gehört in den parallel laufenden Benachrichtigungs-Umbau, sonst arbeiten
zwei Chats an denselben doppelten IDs.

---

## Modals / Dialoge (Auftragspunkt: "dokumentieren und nachfragen, falls identisches Muster")

Geprüft: nein, es ist kein identisches Muster. Die Modal-Familie hat einen eigenen
Token-Satz (`--vx-radius-modal`, `--vx-shadow-modal`, `--vx-shadow-modal-sheet`) und ein eigenes
Inventar (`MODAL_INVENTAR_CUSTOMER_DASHBOARD_2026-08-08.md`). Bleibt wie im Briefing
abgegrenzt draussen.

---

## Aufwandseinschätzung

| Block | Umfang | Bemerkung |
|---|---|---|
| 1A Toast-Renderer umstellen | ~40 CSS-Zeilen + 4 SVG-Stroke-Werte in `toast()` | ein Block, kein Aufrufer betroffen |
| 1B totes `vx-toast`-System | ~20 CSS-Zeilen + 1 Markup-Zeile löschen, 3 Aufrufe bereinigen | schliesst den Realtime-Bug mit |
| 1C `#incoming-banner` | ~30 CSS-Zeilen | nur falls freigegeben |
| 2 Live-Anruf-Karte | ~15 Zeilen JS + Testanpassung | Avatar ausgeben, Text, Fingerprint |
| 3 Speicher-Rückmeldungen #1/#2 | ~25 Zeilen | plus #4 löschen, #5 ziehen — falls freigegeben |

**Bewertung: der Auftrag ist kleiner als befürchtet**, weil die Toasts zentralisiert sind und die
Live-Karte optisch bereits stimmt. Der Mehraufwand liegt in den Funden, nicht im Briefing-Umfang.

---

## Was noch nicht verifiziert ist

- **Kein Screenshot-Beleg.** Beide Breakpoints (Desktop, 390px) sind noch nicht gemessen —
  gehört nach die Umsetzung, Auftragspunkt 6.
- **Der Live-Anruf-Zustand ist bisher nicht hergestellt** (weder echt noch simuliert). Ob eine
  Attrappe mit echten Stilen und echter Renderfunktion reicht, entscheidet sich beim Bauen; falls
  nicht herstellbar, wird das benannt statt behauptet (Auftragspunkt 6).
- **Der Realtime-Bug (1B) ist code-gelesen, nicht live nachgestellt.**
- **Die Zuordnung "oben rechts" = `#incoming-banner`** ist eine Bewertung aus Positionsdaten,
  kein Screenshot-Abgleich.
- **Kein Verifier-Sweep gelaufen** — es wurde nichts geändert.
