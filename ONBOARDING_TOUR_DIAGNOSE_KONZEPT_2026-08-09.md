# Onboarding-Tour — Diagnose und Neukonzept

**Datum:** 09.08.2026 · **Status:** Audit + Zielbild, **keine Code-Änderung** (AGENTS.md: Umsetzung erst nach Freigabe)
**Betroffene Datei:** `customer-dashboard/index.html` (Zeilenangaben = Stand `2b91179`)

---

## 0. Zusammenfassung

Der Vollbild-Overlay ist **kein sporadischer Fehler, sondern der Normalfall der bestehenden
Tour auf Mobile.** Zwei unabhängige Ursachen greifen ineinander:

1. **Anzeige:** `tourDrawOverlay()` füllt bei fehlendem Ziel-Element den **gesamten Bildschirm**
   deckend ein (`ctx.fillRect(0,0,W,H)`, Zeile 30947–30948). Auf Mobile fehlt bei **jedem** der
   sieben Schritte ein Ziel — die Tour zeigt dort auf die Desktop-Sidebar, die unter 768 px
   `display:none!important` trägt. Ergebnis: 7 von 7 Schritten sind eine dunkle Vollfläche.
2. **Auslösung:** Der „schon gesehen"-Merker liegt **nur** in `localStorage`
   (`voxera_tour_v2_done`, Zeile 30907) — nicht kundenbezogen, nicht in der Datenbank — und wird
   bei jedem Speicher-Engpass von `vxCleanupNonCriticalVoxeraStorage()` mitgelöscht (Zeile 9179–9192).
   Damit kann die Tour ohne bewusstes Zutun erneut starten.

Zusätzlich laufen **zwei getrennte Willkommens-Ebenen** unkoordiniert nebeneinander (Willkommens-Karte
nach 800 ms, Tour nach 1400 ms), die Tour legt sich per z-index über die Karte.

Der Zusammenhang mit der Assistenten-Umbenennung („Rolf") ist **nicht bestätigt** — es existiert
kein Code-Pfad vom Namen zum Tour-Auslöser. Details in A6.

---

## Teil A — Diagnose

### A1 · Fakt: Zwei Erstlauf-Ebenen, die nichts voneinander wissen

| Ebene | Element | Auslöser | z-index |
|---|---|---|---|
| Willkommens-Karte „Willkommen bei Voxera" | `#vx-onboarding-overlay` (Z. 8445) | `vxOnboardingInit()` **800 ms** nach `customerMeta`-Aufbau (Z. 16367) | `--z-onboarding: 9000` (Z. 175) |
| Spotlight-Tour „1 / 7" | `#tour-overlay` (Z. 29616) | `tourCheckFirstLogin()` → `setTimeout(tourStart, 1400)` (Z. 29265, 31107–31109) | `--z-tour: 10000` (Z. 177) |

Beim allerersten Login erscheinen **beide**. Die Tour startet 600 ms nach der Karte und legt sich
darüber. Es gibt keine gemeinsame Bedingung, keinen gegenseitigen Ausschluss, keine gemeinsame
Ablage. Die beiden Ebenen erklären dieselbe Sache zweimal, mit unterschiedlichem Text.

### A2 · Fakt: Die Vollfläche ist der eingebaute Rückfall, kein Absturz

```js
// Zeile 30940–30948
function tourDrawOverlay(rect) {
  ...
  ctx.fillStyle = 'rgba(13,31,60,0.72)';
  if (!rect) {
    ctx.fillRect(0,0,W,H);        // ← komplette Fläche, deckend
  } else { ... /* Ausschnitt um das Ziel */ }
}
```

`rect` ist `null`, sobald `tourGetTargetRect()` (Z. 30929–30938) kein Element findet **oder das
gefundene Element 0 × 0 gross ist**:

```js
var el = document.getElementById(id);
if (!el) return null;
var r = el.getBoundingClientRect();
if (r.width === 0 && r.height === 0) return null;
```

`tourStart()` setzt dazu `overlay.style.pointerEvents = 'all'` (Z. 31072) — die Fläche fängt
alle Klicks ab. Sichtbares Ergebnis: dunkler Schleier über der ganzen Seite, Bedienung blockiert.
Schritt 1 und Schritt 7 haben `target: null` **absichtlich** (zentrierte Karten) — dort ist die
Vollfläche gewollt. Genau diesen Schritt 1 zeigt der Fahrplan-Fund („Vollbild, 1/7 Willkommen
bei Voxera").

### A3 · Fakt: Auf Mobile trifft der Rückfall **alle** Schritte

Alle sechs Schritte mit Ziel setzen `mobileTarget` auf **dieselbe ID wie `target`** — also auf
die Einträge der Desktop-Sidebar (Z. 30920–30924):

```js
{ tab:'assistent', target:'nav-assistent', mobileTarget:'nav-assistent', ... }
{ tab:'anrufe',    target:'nav-anrufe',    mobileTarget:'nav-anrufe',    ... }
```

Die Sidebar ist unter 768 px abgeschaltet:

```css
/* Zeile 2182, identisch nochmals Zeile 2529 */
@media(max-width:768px){ .sidebar{display:none!important;} }
```

Die Mobile-Navigation hat **eigene IDs** (`mnav-dashboard`, `mnav-anrufe`, `mnav-assistent`, …,
Z. 8361–8386), die die Tour nie benutzt. Der Mobile-Zweig in `tourGetTargetRect()` ist damit
funktionslos: `document.getElementById('nav-anrufe')` liefert auf dem Handy zwar ein Element,
aber mit 0 × 0 → `null` → Vollfläche.

**Auf Mobile ergibt jeder der sieben Schritte eine deckende Vollfläche.** Das deckt sich exakt
mit dem Fahrplan-Fund („erscheint unerwartet (Vollbild …) auf Mobile").

### A4 · Fakt: Drei von sieben Zielen existieren auch auf Desktop nicht mehr

Geprüft per ID-Suche über `customer-dashboard/index.html`:

| Schritt | Ziel-ID | vorhanden? |
|---|---|---|
| 2 Assistent | `nav-assistent` | ja |
| 3 Begrüssung | `assistent-greeting-visible` | **nein (0 Treffer)** |
| 4 Geschäftsprofil | `vxi-profil-desc` | **nein (0 Treffer)** |
| 5 Anrufe | `nav-anrufe` | ja |
| 6 Tages-Cockpit | `nav-heute` | **nein (0 Treffer)** — der Eintrag heisst `nav-dashboard` |

Schritt 6 ruft zusätzlich `showTab('heute')` auf (Z. 30924). `showTab()` bricht bei unbekanntem
Namen still ab (`var targetTab = document.getElementById('tab-' + name); if (!targetTab) return;`,
Z. 25781–25782) — es gibt kein `#tab-heute`, der Tab heisst `dashboard`. Der Schritt navigiert
also nirgendwohin und zeigt eine Vollfläche mit dem Text „Ihr Tages-Cockpit".

Das bestätigt die Annahme aus dem Briefing: die Tour zeigt auf UI, die es in dieser Form nicht
mehr gibt. Auch die Inhalte sind veraltet — Schritt 5 heisst „Jeder Anruf", der Bereich heisst
heute **Anfragen**; die Willkommens-Karte verweist auf „unter **Mehr**" (Z. 20634), der
Navigationseintrag heisst seit dem Redesign **Einstellungen** (Z. 7302–7305).

### A5 · Fakt: Warum die Tour ohne bewussten Reset wiederkommt

Der Merker ist eine reine Browser-Notiz:

```js
var TOUR_STORAGE_KEY = 'voxera_tour_v2_done';                       // Z. 30907
function tourCheckFirstLogin() {
  if (!localStorage.getItem(TOUR_STORAGE_KEY)) setTimeout(tourStart, 1400);  // Z. 31107–31109
}
```

Drei belegbare Wege, auf denen er verschwindet:

1. **Speicher-Aufräumer löscht ihn mit.** `vxCleanupNonCriticalVoxeraStorage()` entfernt
   *jeden* Schlüssel mit Präfix `vx_` oder `voxera_` (Z. 9179–9192). `voxera_tour_v2_done` fällt
   darunter. Ausgelöst wird der Aufräumer bei jedem Speicher-Engpass (Z. 9212, 8874). Dass ein
   solcher Engpass realistisch ist, zeigen die Cache-Grössen im selben Code:
   `voxera_ai_report_*` bis 80 KB pro Eintrag (Z. 15790, 15803, 15813), `voxera_seen_calls_*`
   bis 50 KB (Z. 9270) — auf iOS-Safari mit knappem Kontingent erreichbar.
   *Nebenwirkung derselben Zeile:* auch `vx_onboarding_dismissed_*` und
   `voxera_setup_finished*` werden mitgelöscht.
2. **Kein Kundenbezug, keine Datenbank.** Die Willkommens-Karte hat ein DB-Flag
   (`customers.onboarding_completed`, Z. 15488/15549) **und** einen kundenbezogenen lokalen
   Schlüssel (`vx_onboarding_dismissed_<customerId>`, Z. 15485). Die Tour hat **keins von beidem**.
   Jeder neue Browser, jedes neue Gerät, jedes privates Fenster und jede andere Herkunft
   (Netlify-Preview vs. `dashboard.voxera.ch` — getrennter `localStorage`) startet sie erneut.
3. **Browser-seitige Räumung.** iOS-Safari (ITP) räumt `localStorage` von Seiten ohne
   kürzliche Interaktion nach sieben Tagen. *Bewertung: plausibel, hier nicht nachgestellt.*

### A6 · Bewertung: Zusammenhang mit der Assistenten-Umbenennung

**Kein Kausalpfad gefunden.** Geprüft:

- `customer-dashboard/shared/customer-runtime-assistant-profile.js` schreibt **nichts** in
  `localStorage`/`sessionStorage` und löst kein `location.reload()` aus (Suche ohne Treffer).
- Es existiert keine Stelle, die beim Speichern des Assistentennamens Speicher leert, den
  Tour-Merker entfernt oder `tourStart()` aufruft. `tourStart()` hat genau **einen** Aufrufer:
  `tourCheckFirstLogin()`.
- Ein Fehler in `tourBuildSteps()` (dort wird der Name gelesen, Z. 30914) könnte die Tour nicht
  *öffnen* — die Funktion läuft als erste Zeile von `tourStart()`, vor dem Einblenden.

Was den Eindruck einer Kopplung erzeugt haben dürfte: die Schritttexte setzen den Namen zur
Laufzeit ein („**Rolf** spricht in Ihrem Namen"). Nach einer Umbenennung liest dieselbe, nie
zugestellte Tour sich neu — sie wirkt dadurch wie frisch ausgelöst. Der eigentliche Auslöser ist
mit hoher Wahrscheinlichkeit einer der drei Wege aus A5 (Test auf Mobile, anderes Gerät/Fenster
oder geleerter Speicher). **Nicht abschliessend bewiesen** — beweisbar wäre es nur mit dem
`localStorage`-Stand des betroffenen Testgeräts zum Zeitpunkt des Vorfalls.

### A7 · Nebenfunde (dieselbe Baustelle, für die Neukonzeption relevant)

1. **Die Tour ist nicht wiederholbar.** `tourStart()` hat keinen Bedienelement-Einstieg. Wer sie
   überspringt, sieht sie nie wieder (bis der Speicher geleert wird). Der Knopf im Hilfe-Bereich,
   der laut Beschriftung eine „Tour" anbietet (Z. 8293–8312), ruft `vxOnboardingRestart()` auf —
   also die **Willkommens-Karte**, nicht die Tour. Diese Karte liegt zudem in `#tab-einstellungen`,
   dem laut Code-Kommentar abgelösten Alt-Screen (Z. 8326–8330); die lebende Hilfe-Seite ist
   `#mehr-sub-hilfe` und hat keinen solchen Eintrag.
2. **`tourDone()` springt am Ende hart auf `showTab('dashboard')`** (Z. 31104) — wer die Tour
   irgendwo mittendrin abbricht, wird aus seinem Kontext gerissen.
3. **Ausstieg existiert:** „Überspringen" (Z. 29622) und Escape (`ESCAPE_DIALOGS`, Z. 24857).
   Die Fläche blockiert also die Sicht, nicht den Ausweg — deckt sich mit dem Fahrplan-Hinweis
   „Für jetzt: Überspringen zum Testen nutzen".
4. **Der Fahrplan-Eintrag „Onboarding-Wizard-Wiederholung — Bug noch real?"** hat vermutlich
   dieselbe Wurzel wie A5.1: derselbe Aufräumer löscht auch `vx_onboarding_dismissed_*`.

---

## Teil B — Was eine neue Einführung heute erklären müsste

Durchgang durch den aktuellen Funktionsumfang (Navigation Z. 7285–7307, Tabs Z. 7544 ff.):

| Bereich | Was der Kunde dort tut | Erklärungsbedarf beim ersten Login |
|---|---|---|
| **Heute** (`dashboard`) | Aufmerksamkeit, Heute passiert, Anrufe heute, Heute erledigt | **Gering.** Selbsterklärend, beim ersten Login ohnehin leer („Alles im Griff"). |
| **Anfragen** (`anrufe`) | Anrufe und Aufgaben, Detailansicht, Nachfassen | **Hoch — das ist der Kern.** „Hier landen die Anrufe, die Voxera für Sie entgegennimmt." |
| **Assistent** (`assistent`) | Eine Seite, vier Abschnitte: Band *Aktuell*, *Kernidentität*, *Geschäftswissen*, *Grenzen und Eskalation*; Formulare als Drill-in | **Mittel.** Wichtig ist nur eine Aussage: „Alles ist eingerichtet, Sie können es hier ändern." Vier Abschnitte einzeln zu erklären ist beim ersten Login Überforderung. |
| **Bericht** (`auswertung`) | Auswertung | **Keiner beim ersten Login** — ohne Anrufe gibt es nichts zu sehen. |
| **Einstellungen** (`mehr`) | Profil, Benachrichtigungen, Rufumleitung, Abo, Kalender, Hilfe | **Punktuell:** nur die **Rufumleitung**. |
| **Rufumleitung** | Ohne sie erreicht Voxera kein einziger Anruf | **Der einzige echte Startpunkt.** |

**Ableitung:** Von den alten sieben Schritten sind vier gegenstandslos (Stimme/Ton,
Begrüssungstext, Geschäftsprofil, Tages-Cockpit — alles bereits von Voxera eingerichtet oder
selbsterklärend). Übrig bleiben drei Aussagen: *wo die Anfragen landen*, *wo der Assistent
geändert wird*, *dass die Rufumleitung noch fehlt*.

---

## Teil C — Zielbild: drei Optionen

Prüffrage für alle drei (Grundsatz 15): **Versteht eine 60-jährige Sanitär-Betriebsinhaberin ohne
Hilfe, was sie als Nächstes tun soll?**

### Option A · Kurze Schritt-für-Schritt-Tour (3 Schritte statt 7)

Spotlight bleibt, aber auf drei Ziele reduziert: Anfragen → Assistent → Rufumleitung.

- **Dafür:** vertrautes Muster; zeigt buchstäblich, wo man klicken muss.
- **Dagegen:** Der Mechanismus, der uns diesen Bug beschert hat, bleibt. Jede Spotlight-Tour
  koppelt sich an Element-IDs und Positionen — der nächste UI-Umbau bricht sie wieder, und zwar
  **still**. Auf Mobile, wo unsere Zielgruppe überwiegend unterwegs ist, muss der ganze
  Mobile-Zweig (`mnav-*`) erst gebaut werden. Sie unterbricht, bevor jemand etwas tun wollte.

### Option B · Eine Willkommens-Karte mit benannten Zielen ← **Empfehlung**

**Genau eine** Ebene beim allerersten Login. Kein Schleier über der Seite, kein Fortschrittsbalken,
kein „1 / 7". Inhalt:

> **Willkommen bei Voxera, {Vorname}.**
> {Assistentenname} ist eingerichtet und nimmt Anrufe für Sie entgegen.
>
> · **Anfragen** — hier sehen Sie jeden Anruf, den {Name} für Sie entgegengenommen hat.
> · **Assistent** — was {Name} sagt und weiss, ändern Sie hier.
> · **Noch offen: Rufumleitung** — damit Ihre Anrufe bei {Name} ankommen.
>
> [ Rufumleitung jetzt einrichten ]   [ Später ]

- **Dafür:**
  - Erfüllt Grundsatz 15 am direktesten: **eine** Karte, **eine** Hauptaktion, kein Durchklicken.
  - Erfüllt Grundsatz 13: Der einzige gezeigte Zustand („Rufumleitung offen") hat direkt daneben
    seine Handlung.
  - Beseitigt die Doppelung aus A1 — die Karte **existiert bereits**, hat bereits ein
    DB-Flag und bereits einen Wiederhol-Einstieg. Die Tour (~210 Zeilen, Canvas, Positionslogik)
    entfällt ersatzlos.
  - Hängt an **keiner** Element-Position. Der nächste Navigations-Umbau kann sie nicht brechen;
    schlimmstenfalls veraltet ein Wort, was sichtbar ist statt still.
  - Identisch auf Desktop und Mobile (Grundsatz 11) — ohne zweiten Codepfad.
- **Dagegen:** Zeigt nicht physisch auf ein Element. Bewertung: bei fünf Navigationseinträgen mit
  Klartext-Beschriftung („Heute", „Anfragen", „Assistent", „Bericht", „Einstellungen") ist der
  Zeigefinger entbehrlich; der Name im Text genügt.

### Option C · Kontextuelle Hinweise pro Bereich

Beim ersten Besuch eines Bereichs ein kleiner Hinweis an Ort und Stelle.

- **Dafür:** erscheint dann, wenn es relevant ist; nichts blockiert.
- **Dagegen:** verteilt Zustand über fünf Bereiche (fünf Merker statt einem), sagt beim ersten
  Login **nichts** über die fehlende Rufumleitung — dem einzigen wirklich dringenden Punkt — und
  wirkt bei einer nicht digital-affinen Zielgruppe leicht wie „schon wieder ein Kästchen".

### Vorschlag zu Auslösung und Wiederholbarkeit (gilt für die gewählte Option)

| Frage | Vorschlag |
|---|---|
| Wann automatisch? | **Nur beim allerersten Login**, gesteuert über das bestehende DB-Feld `customers.onboarding_completed`. Kein zweiter, rein lokaler Merker. |
| Was, wenn der lokale Speicher geleert wird? | Nichts — die Datenbank entscheidet. Der lokale Schlüssel bleibt nur als Zusatzabsicherung, nie als alleinige Quelle. |
| Wiederholbar? | **Ja**, über Einstellungen → Hilfe & Support → „Erste Schritte nochmals ansehen" — auf der **lebenden** Hilfe-Seite (`#mehr-sub-hilfe`), nicht im Alt-Screen. |
| Nach dem Schliessen? | Bleibt geschlossen — auch wenn der DB-Schreibvorgang scheitert (Muster von `vxOnboardingDismissNow()`, Z. 15540 ff., ist dafür bereits richtig gebaut). |
| Gleichzeitig mit anderen Dialogen? | Nie. Ein Wächter prüft vor dem Öffnen, ob bereits ein Dialog offen ist. |

---

## Teil D — Damit der Fehler nicht mitwandert

Unabhängig von der gewählten Option, als Teil der Umsetzung:

1. **Vollflächen-Rückfall abschaffen.** Kein Codepfad darf eine deckende Fläche zeichnen, weil ein
   Element *fehlt*. Fehlt ein Anker, wird der Schritt übersprungen oder die Ebene gar nicht erst
   geöffnet — ein fehlendes Element ist ein Grund, weniger zu zeigen, nicht mehr.
   *(Entfällt vollständig, wenn Option B gewählt wird: dann gibt es keine Zeichenfläche mehr.)*
2. **Speicher-Aufräumer eingrenzen.** `vxCleanupNonCriticalVoxeraStorage()` (Z. 9179–9192) darf
   Zustimmungs-/Abschluss-Merker nicht mit den Caches wegwerfen. Vorschlag: Positivliste der zu
   schützenden Schlüssel (`*_onboarding_*`, `*_setup_finished*`), statt „alles mit Präfix `vx_`
   oder `voxera_`". **Das ist der eigentliche Wiederholungs-Auslöser und betrifft auch den
   offenen Fahrplan-Punkt „Onboarding-Wizard-Wiederholung".**
3. **Nur eine Erstlauf-Ebene.** Die zweite ersatzlos entfernen, inklusive der irreführenden
   „Tour"-Beschriftung im Alt-Screen (Z. 8293–8312).
4. **Kein zweiter, rein lokaler Merker.** Datenbank führt, lokal sichert nur ab.
5. **Abnahmeprüfungen:** erster Login Desktop und Mobile (Grundsatz 11); Wiederholung über Hilfe;
   Schliessen bei fehlgeschlagenem DB-Schreibvorgang; Verhalten nach geleertem `localStorage`;
   voller Verifier-Sweep, weil `customer-dashboard/index.html` von allen Screens geteilt wird
   (Grundsatz 14).

---

## Offene Entscheidungen (vor der Umsetzung)

1. **Welche Option?** — Empfehlung: **B** (eine Willkommens-Karte, Spotlight-Tour ersatzlos entfernen).
2. **Wortlaut der Karte** — der Entwurf in Teil C nennt drei Ziele. Sollen es drei sein, oder nur
   die Rufumleitung plus ein Satz?
3. **„Später"-Knopf** — soll die Karte einen Aufschub anbieten, oder ist „Verstanden" der einzige
   Ausgang (wie heute)?
4. **Punkt D.2 (Speicher-Aufräumer)** — im selben Auftrag mitkorrigieren oder als eigener Auftrag
   führen? Er reicht über das Onboarding hinaus.

---

## Nicht geprüft / offen

- Der `localStorage`-Stand des Testgeräts zum Zeitpunkt des „Rolf"-Vorfalls — ohne ihn bleibt A6
  eine begründete Bewertung, kein Beweis.
- Ob iOS-Safari-ITP im konkreten Testaufbau tatsächlich zugeschlagen hat (A5.3).
- Kein Live-Test auf `dashboard.voxera.ch` durchgeführt; alle Aussagen stammen aus dem Code auf
  `2b91179`.
