# Modal-Inventar Customer Dashboard — 2026-08-08

Bestandsaufnahme aller Modal- und Dialog-Komponenten im Customer Dashboard.
**Reine Bestandsaufnahme — es wurde nichts davon geändert.** Grundlage für die
gemeinsame Planung, was in welcher Reihenfolge vereinheitlicht wird.

Farbwerte sind die *berechneten* Werte aus dem laufenden Dashboard (Chromium,
Desktop 1440px), nicht die im Quelltext notierten Tokens. Wo ein Token
dazwischenliegt, ist es mit angegeben.

---

## Der zentrale Befund

Für „die eine bestätigende Aktion" existieren im Customer Dashboard **drei
verschiedene Primärfarben** nebeneinander:

| Farbe | Token | Wer benutzt sie |
|---|---|---|
| `#1A6FE8` generisches Blau | `--vx-blue` / `--blue` / `--vx-color-brand` | Alle klassischen Modals (`.btn--primary`), Plan-&-Optionen (`.modal-btn-p`), Support-Anfrage |
| `#0D1F3C` Night-Navy | `--vx-color-night` | Detail-Vollansicht (`.vx-dv2-btn-primary`), Produkt-Tour |
| `#0F2347` zweiter Navy | `--vx-brand-dark` | Assistent-Dialoge (`.vx-ap-btn`) |

Der gemeldete Datenpunkt — „Ja, erledigen" im Dialog *Anfrage als erledigt
markieren?* nutzt generisches Blau statt Night-Navy — ist damit **kein
Einzelfall**, sondern die Regel für die gesamte klassische Modalfamilie. Die
Detailansicht direkt dahinter zeigt gleichzeitig Night-Navy. Beide sind im
selben Klick-Pfad sichtbar.

Dazu kommen **drei Button-Geometrien** (gemessen, siehe Korrektur unten):

| Klasse | Höhe | Radius | Vorkommen |
|---|---|---|---|
| `.btn` | 44px | 10px (`--btn-radius`) | klassische Modals |
| `.modal-btn-p` / `.modal-btn-s` | 44px | 10px | Plan & Optionen |
| `.vx-ap-btn` | 40px | 12px (`--vx-radius-control`) | Assistent |
| `.vx-dv2-btn` | 32px | 999px (Pille) | Detail-Vollansicht |

> **Korrektur (bei S1 gemessen):** Diese Tabelle nannte zuerst vier Geometrien
> mit `.modal-btn-p` auf 42px/11px — das ist der Wert, wie er in der CSS-Regel
> steht. Eine spätere Regel erzwingt `min-height:44px; height:44px;
> border-radius:10px` mit `!important` für `.modal-btn-p`, `.modal-btn-s` und
> `.modal-btn-danger`. Im Browser sind es also 44px/10px, identisch mit `.btn`.
> Der Umfang von S5 schrumpft entsprechend auf zwei zusammenzuführende
> Geometrien statt drei.

Der Modal-Radius selbst ist dagegen konsistent: **18px** (`--vx-radius-modal`)
in allen Containern der klassischen Familie, im Support-Modal und im
Assistent-Dialog.

---

## Modal-Familien

Sechs eigenständige Bau- und Stilsysteme:

1. **Klassische Modalfamilie** — `.overlay` + `.modal` + `.modal-shell` /
   `.modal-head` / `.modal-body` / `.modal-footer`. Dunkler Kopf `#0D1F3C`,
   Radius 18px, Footer aus `.btn--secondary` + `.btn--primary`.
   Sechs Dialoge.
2. **Commercial** — gleicher Rahmen, aber eigene Button-Klassen und
   `!important`-Stil-Owner in `shared/customer-runtime-modal-cancellation.js`.
3. **Assistent-Profil** — `.vx-ap-modal` / `.vx-ap-dialog` / `.vx-ap-btn`,
   erzeugt in `shared/customer-runtime-assistant-profile.js`, gestylt in
   `shared/customer-assistant-components.css`. **Kein dunkler Kopf.**
4. **Support** — `#vox-support-request-overlay`, erzeugt in
   `shared/customer-runtime-case-intake.js`, gestylt in
   `shared/customer-support-components.css`. Eigener Kopf, aber Footer aus
   der klassischen `.btn`-Familie.
5. **Detail-V2 Vollansicht** — `#vx-detail-v2-fullscreen` + `.vx-dv2-btn`.
   Kein Overlay-Dimm, sondern eine Vollbild-Ebene.
6. **Ad-hoc inline** — Onboarding und Produkt-Tour, vollständig über
   `style="…"` im Markup, ohne Anschluss an Klassen oder Tokens.

---

## Die Dialoge im Einzelnen

### `#followup-overlay` — Nachfassen planen / Fälligkeit setzen
- **Wo:** Aktionszeile der Detailansicht („Rückruf planen"), Zeilenmenü in
  Anfragen/Heute, Aufgaben-Fälligkeit.
- **Familie:** klassisch · Kopf `#0D1F3C` · Radius 18px
- **Buttons:** „Nachfassen speichern" `.btn--primary` — bg `#1A6FE8`, fg
  `#FFFFFF`, border `#1A6FE8` · „Abbrechen" `.btn--secondary btn--sm` — bg
  `#FFFFFF`, fg `#27334D`, border `#E2E8F0`
- **Chips:** `.vx-modal-chip` — bg `#FFFFFF`, fg `#4A5568`, border `#E4EAF2`,
  Radius 7px; aktiv `#EFF6FF` / `#1A6FE8`
- **a11y:** `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-hidden`
  gepflegt ✓

### `#notiz-overlay` — Notiz
- **Wo:** Zeilenmenü „Notiz", Detailansicht.
- **Familie:** klassisch · Kopf `#0D1F3C` · Radius 18px
- **Buttons:** „Speichern" `.btn--primary` `#1A6FE8` · „Abbrechen"
  `.btn--secondary btn--sm` `#FFFFFF` / `#E2E8F0`
- **a11y:** vollständig ✓

### `#manual-task-overlay` — Aufgabe erstellen / bearbeiten
- **Wo:** „+ Aufgabe", Zeilenaktion „Aufgabe erstellen", Detailansicht
  „Bearbeiten", Aufgabe aus Anruf.
- **Familie:** klassisch · Kopf `#0D1F3C` · Radius 18px
- **Buttons:** „Aufgabe erstellen" `.btn--primary` `#1A6FE8` · „Abbrechen"
  `.btn--secondary btn--sm`
- **Chips:** `.vx-modal-chip.vx-cd-due-chip`, aktiv `#EFF6FF` / `#1A6FE8` /
  border `#1A6FE8`
- **a11y:** vollständig ✓

### `#manual-request-overlay` — Neue Anfrage
- **Wo:** „+ Neue Anfrage" in Anfragen.
- **Familie:** klassisch · Kopf `#0D1F3C` · Radius 18px
- **Buttons:** „+ Neu anlegen" `.btn--primary` `#1A6FE8` · „Abbrechen"
  `.btn--secondary btn--sm`
- **a11y:** vollständig ✓

### `#confirm-overlay` / `#confirm-modal` — generischer Bestätigen-Dialog
Ein einziges Markup, neun Aufrufer:

| Aufrufer | Titel | Bestätigen-Label | `tone` |
|---|---|---|---|
| `confirmTaskDone` | Anfrage / Aufgabe als erledigt markieren? | Ja, erledigen | primary |
| `confirmArchiveInquiry` | Anfrage archivieren? | Archivieren | primary |
| Aufgabe archivieren | Aufgabe archivieren? | Archivieren | primary |
| Anfrage archivieren (Detail) | Anfrage archivieren? | Archivieren | primary |
| Live-Guard | Anruf noch nicht beendet | OK | primary |
| Statuswechsel | Status aktualisieren? | Speichern | primary |
| Kündigung zurückziehen | Möchten Sie Ihre Kündigung wirklich zurückziehen? | Ja, zurückziehen | *(nicht gesetzt → primary)* |
| Kündigungs-Assistent | *(ohne Titel)* | Weiter → | *(nicht gesetzt → primary)* |
| Abmelden | Wirklich abmelden? | Abmelden | **danger** |

- **Familie:** klassisch, Variante `.overlay--center .confirm-variant`,
  `max-width:360px` · Kopf `#0D1F3C` · Radius 18px
- **Buttons je `tone`:**
  - `primary` → `.btn--primary` — bg `#1A6FE8`, fg `#FFFFFF`
    ← **der gemeldete Datenpunkt („Ja, erledigen")**
  - `danger` → `.btn--danger` — bg `#FEF2F2`, fg `#DC2626`, border `#FECACA`
    (heller Outline-Look, kein gefülltes Rot; einziger Aufrufer: Abmelden)
  - `neutral` → `.btn--neutral` — bg `#94A3B8`, hover `#13284D`
    (**ein vierter Navy-Ton**; derzeit von keinem Aufrufer benutzt)
  - „Abbrechen" immer `.btn--secondary btn--sm`
- **Hinweis:** die Klasse `confirm-tone-*` am Modal steuert ausschliesslich
  das **Icon** (`.confirm-tone-danger .confirm-icon` usw.). Die Buttonfarbe
  läuft über einen separaten Zweig in `openConfirmModal()`. Beide Systeme
  können auseinanderlaufen.
- **a11y:** vollständig ✓

### `#vx-commercial-overlay` — Plan & Optionen / Kündigung
- **Wo:** Einstellungen → Abo/Vertrag.
- **Familie:** Commercial · Kopf `#0D1F3C` · Radius 18px · z-index 9800
- **Buttons:** „Anfrage übermitteln" `.modal-btn-p` — bg `#1A6FE8`, fg
  `#FFFFFF`, Höhe 42px, Radius 11px, zusätzlich
  `box-shadow: 0 6px 16px rgba(26,111,232,.20)` · „Abbrechen" `.modal-btn-s` —
  bg `#FFFFFF`, fg `#27334D`, border `#E2E8F0`
- **Besonderheit:** Stil wird in `customer-runtime-modal-cancellation.js`
  fast vollständig mit `!important` gesetzt; Änderungen am Basisstil greifen
  hier nicht.
- **a11y:** `role="dialog"` auf `.modal`, `aria-hidden` am Overlay ✓

### `#vox-support-request-overlay` — Support-Anfrage
- **Wo:** Hilfe/Support.
- **Dateien:** `shared/customer-runtime-case-intake.js` (Markup),
  `shared/customer-support-components.css` (Stil)
- **Kopf:** `#0D1F3C` (`--vx-color-night`) · Radius 18px · **z-index 100000**
- **Buttons:** „Anfrage senden" `.btn--primary` `#1A6FE8` · „Abbrechen"
  `.btn--secondary`
- **a11y:** `role="dialog"`, `aria-modal`, `aria-labelledby` ✓ (kein
  `aria-hidden`-Pflegepfad, Sichtbarkeit läuft über `.open`)

### `#vx-assistant-voice-modal` — Stimme übernehmen?
- **Wo:** Einstellungen → Assistent → Stimme auswählen.
- **Datei:** `shared/customer-runtime-assistant-profile.js`
- **Familie:** Assistent-Profil · **kein dunkler Kopf** · Dialog-Radius 18px,
  Button-Radius 12px
- **Buttons:** „Stimme übernehmen" `.vx-ap-btn` — bg `#0F2347`
  (`--vx-brand-dark`), fg `#FFFFFF`, Höhe 40px · „Abbrechen"
  `.vx-ap-btn.ghost` — bg `#F9FBFD`, fg `#667085`, border `#E4EAF2`
- **a11y:** `role="dialog"`, `aria-modal`, `aria-labelledby` ✓

### `#setup-help-overlay` — Setup-Hilfe
- **Wo:** Aktivierung → „Anleitung", Testanruf-Hilfe, Rufumleitung.
- **Familie:** klassischer Sheet-Rahmen, Inhalt vollständig dynamisch.
- **Buttons im Inhalt:** „Code kopieren" / „Direkt anwenden" als
  `.btn--secondary` — kein Primärbutton im Dialog.
- **a11y:** **kein `role="dialog"`, kein `aria-modal`, kein
  `aria-labelledby`** ✗

### `#activation-flow-overlay` — Aktivierungs-Flow (Schritt 1/2 und 2/2)
- **Wo:** Aktivierung, Testanruf-Bestätigung.
- **Familie:** klassischer Sheet-Rahmen, Inhalt dynamisch.
- **Buttons:** „Jetzt aktualisieren" `.btn--primary` `#1A6FE8` · „Später"
  `.btn--secondary`, in `.modal-actions` statt `.modal-footer`
- **a11y:** **kein `role="dialog"`, kein `aria-modal`,
  kein `aria-labelledby`** ✗

### `#vx-onboarding-overlay` — Willkommen bei Voxera
- **Wo:** erster Login nach Aktivierung.
- **Familie:** ad-hoc inline · z-index 9000
- **Stil:** vollständig `style="…"` im Markup. Kopf
  `background: var(--vx-color-night)`, Body-Button
  `background: var(--vx-color-brand,#1A6FE8)`, Radius **10px**, Höhe über
  `padding:12px` statt `min-height`, `font-size:13px`, keine `.btn`-Klasse.
- **a11y:** **kein `role="dialog"`, kein `aria-modal`** ✗

### `#tour-overlay` / `#tour-card` — Produkt-Tour
- **Wo:** Tour-Start aus Einstellungen/Onboarding.
- **Familie:** ad-hoc inline · z-index 10000 · Karten-Radius **20px**
- **Buttons:** „Weiter" — inline `background:#0D1F3C`, fg `#FFFFFF` ·
  „Zurück" `#94A3B8` und „Überspringen" `#CBD5E1` als transparente Textlinks ·
  Fortschrittsbalken `#1A6FE8`
- **a11y:** **kein `role="dialog"`, kein `aria-modal`** ✗

### `#vx-detail-v2-fullscreen` — Detail-Vollansicht
- **Wo:** Anfrage oder Aufgabe öffnen (Heute-Liste und Mobile).
- **Familie:** Detail-V2 · Kopf `#0D1F3C`, Kopfhöhe 64px · z-index 10040
- **Buttons:** `.vx-dv2-btn` — Höhe 32px, Radius **999px (Pille)**;
  primär `.vx-dv2-btn-primary` bg **`#0D1F3C`** fg `#FFFFFF` ·
  „Erledigen" `.vx-dv2-btn-done` bg `#ECFDF5`, fg `#047857`, border `#047857` ·
  restliche Aktionen auf Zeilen-Hintergrund mit Zeilen-Rahmen
- **a11y:** `aria-hidden` wird gepflegt, aber **kein `role="dialog"`** ✗

---

## Nicht-Dialoge, die in derselben Ebene liegen

| Element | Was es ist | Werte |
|---|---|---|
| `#account-overlay` | **kein Modal** — versteckter Datenspeicher für `customerRecordId`, `display:none`. Der Kommentar im Quelltext sagt das auch. Konto-Inhalte liegen im Einstellungen-Tab. | – |
| `#vx-preview-modal` | **toter Code** — „Assistent Vorschau". Markup und `vxClosePendingPreview()` existieren, es gibt aber **keine Stelle, die den Dialog öffnet**. | Kopf `#0D1F3C`, nur „Schliessen" `.btn--secondary btn--sm` |
| `.vx-row-menu` / `#vx-ctx-menu` | Popover-Menüs, kein Dialog | Radius 12px, z-index 12050 / 13050 / 99999 |
| `.toast` | Bestätigungsleiste | bg `rgba(15,23,42,.88)`, fg `#FFFFFF`, Radius `--r-xl` |

---

## Querschnittliche Beobachtungen

**Layering ohne Skala.** Die vergebenen z-index-Werte:
`50` (Mobile-Nav) · `200` / `220` (Overlay-Tokens) · `999` (Login) ·
`9000` (Onboarding) · `9800` (Commercial) · `10000` (Tour) ·
`10040` (Detail-Vollansicht) · `10200` (Modal-Overlays) ·
`12050` / `13050` (Zeilenmenüs) · `13060` (Toast) · `99999` (Kontextmenü) ·
`100000` (Support-Anfrage). Die Tokens `--z-overlay: 200` und
`--z-overlay-detail: 220` beschreiben die tatsächliche Ordnung nicht mehr;
`--z-vx-overlay: 9001` wird nirgends benutzt.

> Das Toast-Token stand bis zu diesem Branch auf `9000` und lag damit **unter**
> der Detail-Vollansicht (`10040`) — die Bestätigung nach dem Speichern war
> dort unsichtbar. Im Zuge von Teil A auf `13060` angehoben. Über der
> Support-Anfrage (`100000`) liegt der Toast weiterhin nicht.

**Zwei Sekundär-Konventionen.** `.btn--secondary` (`#FFFFFF` auf `#E2E8F0`)
gegen `.vx-ap-btn.ghost` (`#F9FBFD` auf `#E4EAF2`) — beinahe, aber nicht
identisch.

**a11y-Lücken.** Vier Overlays ohne `role="dialog"` / `aria-modal`:
Setup-Hilfe, Aktivierungs-Flow, Onboarding, Tour. Die Detail-Vollansicht
pflegt `aria-hidden`, hat aber keine Dialog-Rolle.

**`!important`-Insel.** Der Commercial-Dialog wird von
`customer-runtime-modal-cancellation.js` mit `!important` überschrieben. Jede
Vereinheitlichung am Basisstil muss dort separat nachgezogen werden.

---

## Umsetzungsplan

**Festgelegt:** Night-Navy `#0D1F3C` ist der kanonische Wert für die
bestätigende Aktion, **produktweit** — nicht nur in Dialogen. Blau `#1A6FE8`
bleibt Akzentfarbe für Links, Auswahl, Chips, Fokusring und Fortschritt.
`#0F2347` ist Drift und entfällt.

### Messungen, die die ursprüngliche Reihenfolge verändert haben

1. **`.btn--primary`**: 35 Render-Stellen (23 im Markup, 12 aus JS-Strings) und
   24 CSS-Selektoren. Darunter **vier Regeln, die Blau erneut festschreiben** —
   drei davon mit `!important`:
   `#tab-assistent [id^="accbody-"] .btn--primary`,
   `.dpr-action-panel-premium .btn--primary`, `.dpr-btn-primary`,
   `.dpr-btn.btn--primary`. Ohne sie bleibt eine Änderung an der Basisregel
   wirkungslos. Sie gehören deshalb in denselben Schritt, nicht in einen
   späteren.
2. **Navy hat bereits zwei Hover-Töne**: `#13284D` (15 Fundstellen, u.a.
   `.btn--dark` und `.btn--neutral`) und `#132A52` (3 Fundstellen, Handover
   und Audio). Wird der Hover nicht mitkanonisiert, verschiebt sich die Drift
   nur von der Grund- auf die Hover-Farbe.
3. **Es gibt keinen Dark Mode.** Der Token-Block ist leer, `prefers-color-scheme`
   kommt in keiner Datei vor. Damit entfällt das grösste Risiko bei einer
   dunklen Primärfläche.
4. **Der Escape-Handler kennt nur vier Overlays** (confirm, manual-task,
   followup, notiz). Die Barrierefreiheitslücke ist grösser als „Attribut
   fehlt“ und braucht einen eigenen, vollständigen Schritt.
5. **`#0F2347` ist kein eigener Schritt mehr.** Es ist dieselbe Zeile wie die
   Token-Umstellung — der ursprüngliche Schritt 2 geht in Schritt 1 auf.

### Phase 1 — Farbe und Wert — **erledigt**

**S1 · Semantisches Token einführen und alle Primärbuttons darauf zeigen.**
`--vx-action-primary: var(--vx-color-night)` und
`--vx-action-primary-hover: #13284D`. Umgestellt werden `.btn--primary`,
`.modal-btn-p`, `.vx-ap-btn` (damit fällt `#0F2347`) und
`.vx-dv2-btn-primary`. Die vier blau-festschreibenden Override-Regeln werden
mitgezogen oder entfernt. `#132A52` wird auf `#13284D` vereinheitlicht.
Blau bleibt unverändert als `--vx-color-brand` für Akzentrollen.

**S2 · Sichtprüfung der Nicht-Dialog-Stellen**, Desktop und Mobile.
Erwarteter Sonderfall bestätigt: der Accordion-Body unter `#tab-assistent`
steht selbst auf `#0D1F3C`. Er bleibt als einzige **benannte** Ausnahme blau,
über `--vx-action-primary-on-night` statt über hartkodiertes Blau in einer
Override-Regel.

**Ergebnisse von S1/S2:**

- Es waren **sechs** blau-festschreibende Regeln, nicht vier.
  Die fünfte (`.modal-btn-p` mit `!important`, weiter unten im Dokument als die
  bereits bekannte) wurde erst durch die Laufzeitmessung sichtbar: der Button
  blieb blau, obwohl beide vorher gefundenen Regeln umgestellt waren. Die
  sechste (`.dpr-btn-primary`, frühe Definition) wird von einer späteren
  `!important`-Regel überstimmt und war deshalb in keiner Messung sichtbar —
  sie wurde beim statischen Nachlauf gefunden und mit umgestellt, weil sie
  sonst wieder greift, sobald jemand die `!important`-Regeln aufräumt.
- Alle 14 geprüften Primärbutton-Kontexte liefern jetzt Grund `#0D1F3C`,
  Hover `#13284D`, Text `#FFFFFF`. Die Night-auf-Night-Ausnahme greift
  (`#1A6FE8` / Hover `#1560C8`).
- Kontrastmessung über alle im DOM vorhandenen Primärbuttons: kein Button
  verschwindet auf seinem Grund, Textkontrast überall ≥ 4.5:1
  (Night auf hellen Flächen: 15–16:1). Die Messung deckt die statisch
  vorhandenen Buttons ab; datenabhängig gerenderte Buttons nutzen dieselben
  Klassen und damit dasselbe Token.
- `--vx-brand-dark` ist jetzt Alias auf Night. Damit fällt `#0F2347` nicht nur
  im Assistent-Button, sondern in allen sieben Flächen dieser Familie.
- Akzentrollen unverändert: `.btn--secondary`, `.vx-modal-chip.is-active`,
  Fokusring und Fortschritt tragen weiterhin Blau.

### Phase 2 — Barrierefreiheit — **erledigt**

**S3 · Die vier Overlays auf den vollen Dialog-Vertrag heben:**
Setup-Hilfe, Aktivierungs-Flow, Onboarding, Tour erhalten `role="dialog"`,
`aria-modal`, `aria-labelledby`, gepflegtes `aria-hidden`, Escape und
Fokus-Rückgabe. Vorarbeit je Dialog: Setup-Hilfe und Aktivierungs-Flow
brauchen erst eine stabile Überschrift im injizierten Inhalt; Onboarding
braucht eine echte Überschrift statt eines `div`; die Tour hat mit
`#tour-title` bereits ein Ziel.

**S4 · Escape und Fokus-Rückgabe nachziehen** für die Overlays, die zwar eine
Dialog-Rolle haben, aber nicht im Escape-Handler stehen: `manual-request`,
`vx-commercial`, `vox-support-request`. Die Detail-Vollansicht bringt ein
eigenes Escape mit und braucht nur die Rolle.

**Ergebnisse von S3/S4:**

- Der Escape-Handler war eine fest verdrahtete `if`-Kette über vier der
  dreizehn Dialoge — neun reagierten gar nicht. Er ist jetzt eine nach
  Layer-Reihenfolge sortierte Tabelle: der oberste offene Dialog schliesst
  zuerst, der Bestätigen-Dialog vor dem Modal darunter. Neue Dialoge sind eine
  Zeile.
- **Anfangsfokus fehlte in zwölf von dreizehn Dialogen.** Nur die
  Support-Anfrage setzte den Fokus beim Öffnen selbst (auf ihr Nachrichtenfeld)
  und gab ihn beim Schliessen zurück. Überall sonst blieb der Fokus auf dem
  auslösenden Element hinter dem Overlay. Neuer Helfer `vxFocusDialog()`,
  einheitlich an allen Dialogen; `openNotiz` behält seinen eigenen, gezielteren
  Fokus auf die Textarea.
- **`vxCommercialOpen`/`vxCommercialClose` in `index.html` sind toter Code.**
  `customer-runtime-commercial-controller.js` überschreibt beide Namen beim
  Installieren (`root.vxCommercialOpen = open`). Dieselbe Falle wie bei den
  CSS-`!important`-Regeln, nur in JavaScript: die sichtbare Definition ist
  nicht die wirksame. Der Dialog-Vertrag steht jetzt in der Runtime; die
  Fassung in `index.html` bleibt als Fallback konsistent gepflegt.
- `focus()` in einem `requestAnimationFrame`-Callback läuft noch vor dem
  Layout und verpufft auf einem gerade erst eingeblendeten Element.
  `vxFocusDialog` versucht es deshalb über mehrere Ticks und hört auf, sobald
  der Fokus im Dialog liegt.
- `manual-task-overlay` und `manual-request-overlay` fehlte `tabindex="-1"` am
  `.modal`; ein `focus()` darauf lief ins Leere.
- Die Detail-Vollansicht hat jetzt `role="dialog"`, `aria-modal`,
  `aria-labelledby` und Fokus-Rückgabe. Der Fokus landet auf dem
  Zurück-Button.

**Geprüft:** alle elf Dialoge liefern jetzt Rolle, `aria-modal`, ein
auflösbares `aria-labelledby`, gepflegtes `aria-hidden`, Anfangsfokus im
Dialog, Schliessen per Escape und Fokus-Rückgabe an das auslösende Element.
Der zwölfte (Support-Anfrage) erfüllte den Vertrag bereits. Keine
JS-Fehler; Teil A und S1 unverändert.

### S4b · Fokusfalle — vorgeschlagen, nicht umgesetzt

Gemessen im Nachfassen-Dialog: nach dem letzten Element springt der Fokus beim
**17. Tab** aus dem Dialog auf die Seite dahinter (Glocke in der Seitenleiste)
und wandert dort weiter. `aria-modal="true"` sagt Screenreadern, der Dialog sei
modal — für die Tastatur stimmt das nicht. Das betrifft alle dreizehn Dialoge
gleichermassen und ist ein eigener, zentral lösbarer Schritt: eine
`keydown`-Behandlung für Tab im obersten offenen Dialog, analog zur
Escape-Tabelle. Bewusst nicht in S3/S4 mitgenommen, weil es Tastaturverhalten
in allen Dialogen ändert und eine eigene Prüfung verdient.

### Phase 3 — Form und Struktur

**S5 · Button-Geometrie zusammenführen.** 44/10, 42/11 und 40/12 auf ein Paar.
Die Pillenform 32/999 der Detail-Aktionszeile bleibt bewusste Ausnahme.

**S6 · `confirm-tone-*` und Buttonfarbe auf einen Steuerpfad legen**, damit
Icon und Button nicht mehr getrennt gesetzt werden. `.btn--neutral` entfällt
dabei: es hat keinen Aufrufer, und sein Hover `#13284D` kollidiert nach S1 mit
dem Primär-Hover.

**S7 · Ad-hoc-Dialoge angleichen.** Onboarding und Tour von Inline-Stilen auf
Klassen und Tokens. Beide werden in S3 ohnehin angefasst.

**S8 · z-index als Token-Skala** neu vergeben, tote Tokens entfernen. Dabei zu
klären: Toast über die Support-Anfrage (`100000`) heben oder Support senken.

### Phase 4 — Aufräumen

**S9 · `#vx-preview-modal` entkoppeln** und als tot dokumentieren.
**S10 · Löschung als eigener Mini-PR.**

### Nach Phase 3 vorgemerkt

**S11 · Zweites Akzent-Blau zusammenführen.** `--vx-brand: #3478ED` in
`customer-design-system.css` gegen das kanonische `--vx-color-brand: #1A6FE8`,
21 Nutzungen (Filter-Pillen, Auswahl-Rahmen, Icon-Flächen, Fokusring).
Dieselbe Drift-Mechanik wie bei `#0F2347`, eine Ebene weiter — in der Akzent-
statt der Aktionsfarbe. Bewusst aus S1 herausgehalten, weil S1 die
Aktionsfarbe zusammenführt und Blau unberührt lässt.

### Entschieden

- **Grün ist Zustandston, kein Aktionston.** `.vx-dv2-btn-done` („Erledigen“)
  bleibt grün als Abschluss-/Erfolgssignal, der Bestätigen-Dialog dahinter
  bleibt Night — die Bestätigung ist die primäre Handlung *in diesem Dialog*
  und erbt nicht die Farbe ihres Auslösers. Andernfalls hinge die
  Bestätigungsfarbe von der Auslöserfarbe ab, was die Zweiteilung nur an eine
  neue Stelle verschöbe. Passt zum bestehenden Vier-Farben-System:
  Night = Marke und primäre Aktion, Rot = Dringlichkeit, Gold = Lead-Qualität,
  Grün = Abschluss. Gilt für S6.
- **Primärbuttons auf dunklem Grund** — eine Fläche betroffen
  (`#tab-assistent` Accordion-Body), als benannte Ausnahme gelöst.

### Neu aufgefallen, ausserhalb des Umfangs

- **Zwei Akzent-Blau nebeneinander** — als **S11** nach Phase 3 vorgemerkt,
  siehe oben.
- **Keine Fokusfalle in irgendeinem Dialog** — als **S4b** vorgeschlagen,
  siehe Phase 2.
- **Dialog-Funktionen, die von Runtime-Dateien überschrieben werden.**
  `vxCommercialOpen`/`-Close` in `index.html` sind wirkungslos, weil
  `customer-runtime-commercial-controller.js` dieselben Namen auf `window`
  setzt. Ob es weitere solche Paare gibt, wurde nicht systematisch geprüft —
  lohnt einen eigenen Durchgang, weil jede Änderung an der wirkungslosen
  Fassung stillschweigend nichts tut.
