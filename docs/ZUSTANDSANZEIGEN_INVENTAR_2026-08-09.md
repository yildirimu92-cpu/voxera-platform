# Inventar: Zustandsanzeigen dashboardweit (Toasts, Live-Anruf-Karte, Speicher-Rückmeldungen)

**Datum:** 2026-08-09 · **Branch:** `claude/toasts-zustandsanzeige-7fghjh`
**Status: Inventar (Teil 1) + Umsetzung (Teil 2, siehe Abschnitt "Umsetzung" am Ende).**

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

---
---

# Teil 2 — Umsetzung

Die drei Entscheidungsfragen aus Teil 1 blieben unbeantwortet. Umgesetzt wurde jeweils die
empfohlene Variante; jede Annahme steht unten benannt und ist einzeln zurücknehmbar.

## Getroffene Annahmen (Rückfragen blieben offen)

| Frage | Angenommen | Rücknahme |
|---|---|---|
| `#incoming-banner` mitnehmen? | **Ja.** Sonst bliebe ausgerechnet die Fläche dunkel, an der es aufgefallen ist. | CSS-Block `.incoming-banner*` zurücksetzen; sonst nichts betroffen. |
| Totes `vx-toast`-System + Realtime-Bug jetzt? | **Ja, beides.** Das Aufräumen schliesst den Bug ohnehin mit. | Eigenständig, hängt an keiner anderen Änderung. |
| Grenzfälle | **`changePassword()` gelöscht, `vxDv2SaveNote()` gezogen, Aktivierungsflow NICHT angefasst.** | Aktivierungsflow bleibt offener Folgepunkt, siehe unten. |

## Was geändert wurde

### Familie 1 — Toasts

- **`toast()` auf helle Karte** (`--vx-ui-card-*`, Night-Text, `--vx-shadow-lg`). Glas-Optik
  (`rgba(15,23,42,.88)` + `backdrop-filter`) entfernt.
- **Tonalität verstärkt statt eingeebnet.** Sie lag vorher auf *einem* Träger (18px-Icon-Kreis)
  bei sonst identischer Fläche. Jetzt auf **zwei** — linker Kante und Icon-Kachel — beide aus
  derselben Rollenvariable `--vx-toast-role` / `-role-bg`. Zuordnung gegen die
  Vier-Familien-Regel geprüft: success→Grün (Abschluss), error→Rot (Dringlichkeit),
  warning→Amber (dieselbe Rolle wie die Banner aus PR #886), info→Blau ("interaktiv"/Hinweis
  seit F7). Ohne erkannte Tonalität: Night.
- **Eine Farbquelle statt zwei.** Die vier SVG-Icons trugen feste Hexwerte *neben* vier
  `rgba()`-Werten im CSS; jetzt `stroke="currentColor"`, die Kachel führt.
- **Totes Zweitsystem entfernt:** `.vx-toast`-CSS-Block, `#vx-toast-container` samt
  Mobile-Override, `vxBellAdd()`, die tote `.vx-toast-icon`-Grössenregel und alle drei
  `vxToast()`-Aufrufe.
- **Realtime-Bug geschlossen** (Nebeneffekt, aber der wertvollste Teil): der `ReferenceError`
  bei `index.html:10394` brach den `notifications`-INSERT-Callback ab, wodurch die Folgezeile
  `if (_vxBellOpen) { vxBellRender(); vxBellPageRender(); }` nie lief. Bei geöffnetem
  Glocken-Popover erschien eine neu eintreffende Benachrichtigung deshalb nicht in der offenen
  Liste. Der DOM-Wächter beobachtet statt des gelöschten Containers jetzt `#toast`.
- Der dritte Aufruf (`renderAnrufeInbox`, hinter `typeof`-Wächter, feuerte also nie) geht auf
  den lebenden `toast()` — der Hinweis "Auswahl aufgehoben" beim Zuklappen des Detailpanels war
  seit jeher unsichtbar.
- **`#incoming-banner`** auf dieselbe helle Karte. Puls-Punkt `#22c55e` → `--vx-color-danger`:
  Grün gehört zu Abschluss-Aktionen, ein eingehender Anruf ist keiner — und die Live-Karte löst
  denselben Sachverhalt bereits über Rot.

### Familie 2 — Live-Anruf-Karte

- **Text in der Assistenten-Sprache:** „*[Name] ist gerade im Gespräch*" bzw. „*[Name] führt
  gerade N Gespräche*"; Unterzeile „*Sobald aufgelegt wird, erscheint die Anfrage hier.*"
  Dritte Person, nicht erste: während das Gespräch läuft, berichtet die Karte *über* den
  Assistenten, sie ist nicht seine Stimme.
- **Name live aus `customerMeta.assistantName`**, gleiche Quelle und gleicher Fallback wie
  `vxHeuteRenderLaraHandover()`. Kein Literal.
- **Absenderzeichen wird endlich ausgegeben.** `.vx-live-avatar` war vollständig definiert und
  wurde vom Renderer nie gerendert. Night, 36px — das war ohnehin die Grösse, die die globale
  Avatar-Harmonisierung per `!important` erzwang; die 34px im Basisblock waren eine tote
  Zweitangabe und sind jetzt angeglichen.
- **Fingerprint kennt den Namen.** Sonst bliebe bei einer Umbenennung mitten im Gespräch der
  alte Name stehen, während `vxSyncAssistantNameCopy()` den Rest des Screens nachzieht.
- **Fläche und Live-Abzeichen unverändert** — geprüft, nicht angenommen: die Karte lag bereits
  vollständig auf `--vx-ui-row-*`, das Abzeichen bereits auf `--vx-color-danger`. Rot =
  Dringlichkeit, ein laufendes Gespräch ist der Live-Zustand schlechthin. **Kein Eingriff.**

### Familie 3 — Speicher-Rückmeldungen

- `vxSaveProfil()` und `vxSavePassword()` auf `vxInlineSaveStatus()`. Der Knopf trägt den
  Erfolg, der Statusknoten nur noch Validierungsfehler und Fehlschläge — dieselbe Aufteilung
  wie im Assistent-Tab.
- **Inline-Farben weg.** `fb.style.color = '#059669'` überschrieb stumm die Token-Farben von
  `.vx-settings-feedback[data-state]` — eine zweite, unsichtbare Farbquelle direkt neben der
  eigentlichen.
- `vxDv2SaveNote()` (Anfragen-Detail) auf denselben Helfer gezogen; `btn.style.background` mit
  drei Hexwerten entfernt. **Nebenfund dabei behoben:** die Funktion wertete den
  Supabase-Fehler nicht aus — `.update()` meldet ihn im Ergebnis, nicht per Rejection. Der
  Knopf hätte „Gespeichert ✓" gezeigt, ohne dass geschrieben wurde.
- `changePassword()` ersatzlos entfernt (toter Zweitpfad, alle fünf angesprochenen Elemente
  existieren nicht mehr) samt der vier ins Leere laufenden Ruecksetzungen.
- **Benachrichtigungsseite unangetastet** — der Verifier prüft das ausdrücklich, damit sie
  nicht versehentlich doch mitgezogen wird, solange der Parallelauftrag daran baut.

## Absicherung

- **Neuer Verifier** `scripts/verify-zustandsanzeigen.mjs` (+ CI-Workflow). Er prüft die
  konkreten historischen Fehler, nicht allgemeine Schönheit: dass das tote Zweitsystem nicht
  zurückkehrt, dass die Tonalität auf zwei Trägern bleibt, dass der Assistentenname aus
  `customerMeta` kommt, dass keine Inline-Farben zurückkommen — und dass die
  Benachrichtigungsseite ausgeklammert bleibt.
- **Gegenprobe gefahren:** 21 gezielte Mutationen eingebaut, **21 von 21 gefangen**, jede mit
  einer Meldung, die den Fehler benennt. Eine Lücke hat die Gegenprobe dabei selbst
  aufgedeckt (ein zusätzlicher dunkler Hintergrund im Banner-Block wäre durchgerutscht) und
  eine Schwäche im Verifier (ein zu weites `slice()` las in die Nachbarfunktion und hätte
  deren Fehler unter falschem Namen gemeldet) — beides behoben.
- **Tests:** 4 neue Fälle in `live-call-lifecycle.test.cjs` (Name aus `customerMeta`, Fallback,
  Umbenennung mitten im Gespräch, Absenderzeichen). **154/154 Dashboard-Tests grün.**
- **Verifier-Sweep (Grundsatz 14): 57/59 grün.** Die zwei Ausfälle sind umgebungsbedingt und
  auf dem `main`-Stand identisch rot: `verify-db-security-invariants` (keine
  DB-Zugangsdaten gesetzt) und `verify-prompt-builder-version-bump` (keine gemeinsame Basis mit
  `origin/main` im flachen Klon).
- **Keine `?v=`-Bumps nötig:** es wurde keine gemeinsam genutzte CSS-Datei angefasst, nur
  `index.html`. Damit entfällt die Verifier-Regressionsklasse aus Nachtrag 8b.

## Sichtprüfung (Grundsatz 11)

Gemessen mit Playwright gegen einen echten HTTP-Server mit `customer-dashboard/` als Wurzel —
**nicht** über `file://`, das die nachgeladenen `/shared/*.css`-Module verfehlt hätte. Attrappe
mit **echten** Stylesheets und **echten** Renderfunktionen (`toast()`, `updateLiveHero()`,
`showIncomingBanner()` aus `index.html` extrahiert, nicht nachgebaut). Beide Breakpoints:
1280×900 und 390×900.

Berechnete Farben statt behaupteter: Toast-Fläche `rgb(255,255,255)`, Text `rgb(13,31,60)`,
die vier linken Kanten `rgb(5,150,105)` / `rgb(26,111,232)` / `rgb(217,119,6)` /
`rgb(220,38,38)` mit den vier zugehörigen Kachel-Hintergründen — also vier klar
unterscheidbare Tonalitäten. Banner `rgb(255,255,255)` mit rotem Punkt und roter Kante.
Live-Karte: Avatar `rgb(13,31,60)`, 36px, Initiale „L"; Abzeichen `rgb(220,38,38)`; beide
Textvarianten korrekt.

**Die Sichtprüfung hat zwei Fehler in der Attrappe selbst gefunden** (geklonte Kind-IDs
fingen die Icon-Zuweisung ab; das Umbenennen der `#live-call-row`-ID nahm der Karte ihr
gesamtes Styling, weil die Regel ein ID-Selektor ist). Beide hätten zu einem falschen
„sieht gut aus" geführt — quelltextgeprüft wäre keiner aufgefallen.

## Bewusst nicht angefasst

- **Aktivierungsflow** (`index.html` `activationConfirmDeactivation`, `activationStartSmartphone`):
  „Wird gespeichert…" ohne Fertig-Zustand. Eigener Screen mit eigener Renderlogik
  (`renderActivationV2()` rendert direkt nach dem Speichern neu und würde das Knopf-Label
  ohnehin überschreiben) — die Umstellung ist dort kein Einzeiler. Offener Folgepunkt.
- **`vxCommercialSubmit()`**: `#vx-commercial-status` ist eine *Quittung* mit bleibendem Inhalt
  (Referenznummer), keine Speicher-Rückmeldung. Der flüchtige `vxInlineSaveStatus()`-Zyklus
  würde sie wegräumen. Gleiche Fehlerklasse wie die 14 bewusst unangetasteten Amber-Stellen in
  PR #886: gleiche Optik, andere Bedeutung.
- **Alt-Screen `#tab-einstellungen`** mit den doppelten `inapp-setting-*`-IDs (Befund B3) —
  gehört in den parallelen Benachrichtigungs-Umbau.
- **Modals/Dialoge** — eigene Familie mit eigenem Token-Satz, wie im Briefing abgegrenzt.
- **Admin-Portal** — geprüft: kein einziger `toast(`-Aufruf, faktisch nicht betroffen.

## Nebenfunde, nicht behoben (eigene Aufträge)

1. **Die Tonalität wird bei ~118 von ~167 Toast-Aufrufen per Regex geraten.** Nur 49 übergeben
   einen expliziten Typ. `toast('Rückruf als neue Aufgabe geplant')` wird zu `success`,
   `toast('Bitte bestätigen Sie das Ergebnis.')` zu `warning`. Das war bisher fast unsichtbar,
   weil sich die vier Tonalitäten kaum unterschieden — jetzt, wo sie es tun, werden auch die
   Fehlableitungen sichtbar. **Bewertung, nicht gemessen:** die Trefferquote der Regex ist
   nicht ausgezählt. Sinnvoller eigener Auftrag: Aufrufstellen durchgehen und Typ setzen.
2. **Zwei Verblassungsgrade für denselben Zustand.** `.btn:disabled` liegt bei `opacity:.45`,
   `.vx-ap-btn:disabled` bei `.55` — derselbe „Gespeichert ✓"-Zustand sieht in den
   Einstellungen anders aus als im Assistent-Tab. Angleichen wäre eine Design-System-Änderung
   über alle deaktivierten Knöpfe hinweg, kein Nebenprodukt dieses Auftrags.
3. **`.vx-settings-feedback` nutzt abgedunkelte Hexwerte statt der Rollen-Tokens**
   (`#247c5b` / `#b42318`). Das ist **kein** vergessener Token, sondern nachgerechnet nötig:
   `--vx-color-success` (#059669) erreicht als Text auf Weiss nur **3.77:1** und verfehlt
   WCAG AA (4.5:1). Wer diese Werte „aufräumt", verschlechtert die Lesbarkeit. Gehört als
   Text-auf-Weiss-Variante ins Tokenset statt als Literal — eigener, kleiner Auftrag.

## Was weiterhin nicht verifiziert ist

- **Kein echter Live-Anruf.** Die Sichtprüfung lief gegen die Attrappe mit echten Stilen und
  echter Renderfunktion; ein echter oder simulierter Anrufzustand gegen die laufende Anwendung
  wurde nicht hergestellt. Gehört in den manuellen Abnahmelauf.
- **Der geschlossene Realtime-Bug ist code-gelesen, nicht live nachgestellt.** Dass
  `vxToast` nirgends existiert, ist per Grep belegt; dass deshalb das offene Glocken-Popover
  nicht nachrendert, ist eine Ableitung aus dem Kontrollfluss.
- **Die Zuordnung „oben rechts" = `#incoming-banner`** bleibt eine Bewertung aus Positionsdaten
  (`top:96px`, über der Content-Spalte zentriert), kein Abgleich mit dem User-Screenshot.
- **Kein Klicktest in der laufenden Anwendung** — Speichern auf der Profil-Seite, Notiz-Speichern
  im Anfragen-Detail und der Fehlerpfad sind nicht gegen echte Supabase-Antworten gelaufen.
