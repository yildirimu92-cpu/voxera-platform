# Modal-Inventar Customer Dashboard — 2026-08-08

Bestandsaufnahme aller Modal- und Dialog-Komponenten im Customer Dashboard,
plus Protokoll der daraus abgeleiteten Umsetzung.

> **Zum Lesen:** die Abschnitte bis einschliesslich *Querschnittliche
> Beobachtungen* beschreiben den **Ist-Zustand vom 08.08.2026, vor den
> Änderungen** — sie sind die Bestandsaufnahme und bleiben als Ausgangsbild
> stehen. Was daraus geworden ist, steht im *Umsetzungsplan* darunter, Schritt
> für Schritt. Wer den heutigen Stand sucht, liest dort.

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

> **Zweimal korrigiert — die Zahlen oben sind die Klassendefinitionen, nicht
> das Gerenderte.** Erste Fassung: vier Geometrien aus dem Quelltext gelesen.
> Zweite Fassung (bei S1): `.modal-btn-p` isoliert gemessen, dabei kam 44/10
> heraus. Dritte und gültige Fassung (bei S5): **im echten Dialog** gemessen —
> dort ist derselbe Button 52px hoch, weil die Commercial-Runtime ihn
> überschreibt, und `btn btn--primary` rendert je nach Dialog 44, 48 oder 52px.
>
> Die Lehre für weitere Schritte: eine Klasse isoliert zu messen sagt nichts
> darüber, wie sie an ihrem Einsatzort aussieht. Der Ist-Zustand steht in der
> Ergebnisliste von S5 weiter unten.

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
| ~~`#vx-preview-modal`~~ | **entfernt (S10).** Toter Dialog ohne Aufrufer. Nicht zu verwechseln mit `vxPendingPreview()`, das weiterhin die Sprachprobe im Assistent-Tab abspielt. | – |
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
- `vxFocusDialog` setzt den Fokus **synchron**. Zwischenzeitlich stand hier
  eine Kette aus bis zu vier Versuchen über 120 ms, eingebaut weil der
  Commercial-Dialog den Fokus nicht annahm. Die Ursache war aber eine andere —
  die Runtime überschreibt `vxCommercialOpen`, weshalb der Helfer dort gar
  nicht aufgerufen wurde. Nach der Behebung blieb die Kette ohne Grund stehen;
  ein Review hat darauf hingewiesen. Nachgemessen: der synchrone Versuch
  greift bei allen Dialogen, weil jede Aufrufstelle den Dialog vorher sichtbar
  macht.
- **Ein Dialog hat zwei Einstiege.** `vxOnboardingRestart()` (Hilfe →
  Einrichtung) setzte nur `display`, ohne `aria-hidden` zu räumen, Fokus zu
  setzen oder ihn zurückzugeben. Nach der Einführung von `aria-hidden` in S3
  war der Dialog auf diesem Weg **sichtbar, aber für Screenreader nicht
  vorhanden** — für diesen Pfad schlechter als vorher. Beide Einstiege laufen
  jetzt über `vxOnboardingShow()`. Ein Sweep über alle elf Dialoge zeigt: das
  war die einzige solche Stelle.
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

### S4b · Fokusfalle — **erledigt**

Ausgangslage, gemessen: im Nachfassen-Dialog sprang der Fokus beim **17. Tab**
aus dem Dialog auf die Seite dahinter (Glocke in der Seitenleiste) und wanderte
dort weiter. `aria-modal="true"` sagte Screenreadern, der Dialog sei modal —
für die Tastatur stimmte das nicht.

**Umsetzung: Marker statt `preventDefault`.** Der naheliegende Weg, Tab
abzufangen und umzuleiten, zerstört die Segmentnavigation in
`input[type="datetime-local"]`: dort passiert jeder Tab-Schritt *innerhalb*
desselben Elements, von aussen nicht unterscheidbar vom Verlassen des Feldes.
Das Nachfassen-Modal hat genau so ein Feld, mit sieben internen Tab-Stopps.

Stattdessen steht am Anfang und am Ende jedes Dialogs ein unsichtbares,
fokussierbares Markerelement. Wer einen erreicht, wollte den Dialog gerade
verlassen und wird ans andere Ende gesetzt. Die natürliche Tab-Reihenfolge
bleibt vollständig unangetastet, zusammengesetzte Felder funktionieren normal.

**Selbstheilung statt Registrierungspflicht.** Die Marker werden beim Öffnen
gesetzt — aber Dialoge, die ihren Fokus selbst setzen, laufen nie durch
`vxFocusDialog`: Notiz und Support-Anfrage entkamen deshalb im ersten Anlauf
weiterhin. Jetzt setzt ein `focusin`-Fallback die Marker, sobald der Fokus in
irgendeinen Dialog fällt. Damit greift die Falle auch für Dialoge, die später
dazukommen, ohne dass jemand daran denken muss.

**Dabei gefunden:** `vxVisibleFocusable` zählte Elemente in einem
zugeklappten `<details>` mit. Der Browser überspringt die in der
Tab-Reihenfolge, liefert aber weiterhin Rechtecke. Wäre der Sprung am
Dialogrand dort gelandet, hätte er kein fokussierbares Ziel gefunden und der
Fokus wäre auf den Body gefallen — also genau wieder aus dem Dialog heraus.

**Geprüft** (Chromium, je 45× Tab und 45× Shift+Tab pro Dialog):

- Alle zwölf Dialoge halten den Fokus, vorwärts wie rückwärts.
- Jedes bedienbare Element bleibt per Tab erreichbar — die Falle ist nicht zu
  eng: 10/10, 4/4, 13/13, 9/9, 4/4, 2/2, 2/2, 2/2, 2/2, 2/2, 8/8, 5/5.
- Nachträglich aufgeklapptes Accordion: 8 → 10 bedienbare Elemente, alle 10
  erreichbar.
- Bestätigen-Dialog über dem Nachfassen-Dialog: 20 von 20 Tabs bleiben im
  oberen Dialog; Escape schliesst den oberen zuerst und gibt den Fokus an den
  darunter zurück.

### Phase 3 — Form und Struktur — **erledigt**

**S5 · Button-Geometrie zusammengeführt.**

Die Messung im echten Kontext ergab ein anderes Bild als die beiden früheren
Zählungen: es waren nicht vier Familien mit je einer Geometrie, sondern
**dieselbe Klasse mit vier verschiedenen Höhen, je nachdem in welchem Dialog
sie steht**. `btn btn--primary` rendert 44px in Notiz, Neue Anfrage,
Bestätigen und Support — aber 48px in Nachfassen und Aufgabe und 52px in
Plan & Optionen.

- Ursache 1: `#followup-overlay .modal-footer .btn, #manual-task-overlay
  .modal-footer .btn{height:48px!important}` — eine gescopte Regel für genau
  zwei Dialoge, die dort auch `.btn--sm` aufhob.
- Ursache 2: der Commercial-Dialog erzwang `min-height:52px;
  border-radius:14px` in seiner Runtime-Datei.
- Ursache 3: „Abbrechen" trug in fünf Dialogen `.btn--sm` (36px) und in drei
  nicht — der Abbruch war mal kleiner als die Bestätigung, mal gleich gross.
- Ursache 4: Chips standen in Nachfassen auf der globalen 44px-Untergrenze
  für Buttons, in Aufgabe auf den 34px ihrer eigenen Klasse.

Neue Tokens `--vx-btn-height`, `--vx-btn-radius`, `--vx-chip-height`,
`--vx-chip-radius`, `--vx-action-pill-height`. Alle vier Ursachen behoben,
`.vx-ap-btn` von 40/12 auf die kanonische Geometrie gezogen.

**Ergebnis, gemessen:** 24 Dialog-Aktionen über elf Dialoge auf 44/10, acht
Chips auf 34/7, fünf Aktionen der Detailansicht auf der bewussten Pillenform
32/999. Einzige weitere Abweichung ist der Textlink „Überspringen" der Tour —
randlos ohne Radius, aber mit voller Tipphöhe.

**S6 · `confirm-tone-*` ist jetzt der einzige Steuerpfad.**

Dabei zeigte sich, dass die Tone-Klasse vorher **gar nichts** steuerte: die
Buttonfarbe lief über einen zweiten Zweig in `openConfirmModal()`, und die
Symbolregeln zielten auf `.confirm-icon` — eine Klasse, die das Symbol nicht
trägt (es hat `id="confirm-icon"` und die Klassen `modal-head-icon
vx-modal-icon`). Beide Tone-Regeln waren tot.

- Die Tone-Klasse färbt jetzt den Bestätigen-Button; die Variantenklasse am
  Button entfällt, das Markup trägt nur noch `.btn`.
- Das Symbol bleibt bewusst neutral: es sitzt im Night-Kopfbereich als
  durchscheinendes weisses Feld. Eine rote oder graue Fläche wäre dort falsch,
  und `.modal-head-icon` setzt den Hintergrund ohnehin mit `!important`. Die
  Tonunterscheidung trägt der Button.
- `.btn--neutral` entfernt: einziger Nutzer war dieser Dialog, und sein Hover
  `#13284D` war nach S1 identisch mit dem Primär-Hover — ein grauer Button,
  der beim Überfahren aussah wie die primäre Aktion.
- **Grün-Entscheidung umgesetzt:** kein grüner Ton in diesem Dialog. Der
  „Erledigen"-Button bleibt grün als Abschluss-Signal, die Bestätigung darin
  bleibt Night.

**S7 · Onboarding und Tour auf Klassen und Tokens.** Beide trugen ihre
gesamte Gestaltung im `style`-Attribut und hingen an keinem Token. Werte
unverändert, jetzt in benannten Klassen.

Dabei zwei Dinge gelernt:
- Die Runtime-Stylesheets werden erst zur Laufzeit an `<head>` gehängt und
  liegen damit **hinter** allen Inline-`<style>`-Blöcken. Sie präfixen
  durchgehend mit `body.vx-customer-design-foundation` und tragen dadurch
  (0,1,1). Eine reine Klassenregel im Dokument (0,1,0) verliert gegen sie —
  die neuen Regeln sind deshalb über die Overlay-ID gescopt.
- Ein `min-height:auto` auf dem Textlink „Überspringen" liess das Tippziel auf
  12px schrumpfen. Die globale 44px-Untergrenze für Buttons wird dort jetzt
  bewusst nicht überschrieben.

**S8 · z-index als Token-Skala.** Eine Ebene pro Rolle:
`--z-mobile-nav`, `--z-login`, `--z-onboarding`, `--z-commercial`, `--z-tour`,
`--z-detail-fullscreen`, `--z-overlay`, `--z-row-menu`,
`--z-row-menu-floating`, `--z-context-menu`, `--z-support`, `--z-toast`.

- Die Zahlen bleiben die bisher gerenderten Werte. Bewusst **nicht** auf eine
  kleine Skala umnummeriert: im Dashboard liegen weitere hartkodierte
  z-index-Werte zwischen diesen Stufen, ein Umnummerieren würde sie
  stillschweigend nach oben schieben. Wer aufräumt, fängt bei diesen Namen an.
- Tote Tokens entfernt: `--z-overlay: 200` und `--z-overlay-detail: 220`
  beschrieben die Realität nicht mehr (dieselben Overlays lagen per
  `!important` auf 10200), `--z-vx-overlay: 9001` hatte keinen Nutzer.
- Die Support-Anfrage lag auf `100000` und damit über dem Toast —
  Bestätigungen aus diesem Dialog waren unsichtbar. Sie steht jetzt in der
  Skala unter dem Toast. Gemessen: die Ebenenfolge ist lückenlos aufsteigend.

### Phase 4 — Aufräumen — **erledigt**

**S9 · `#vx-preview-modal` entkoppelt und dokumentiert.**

Der Totbefund hielt der genauen Prüfung stand: kein Codepfad setzt `.open`,
keiner ruft `setOverlayAriaHidden(…, false)` dafür. Nur die drei
Bedienelemente im Dialog rufen `vxClosePendingPreview()`.

**Aber daneben lebt `vxPendingPreview()`** — eine aktive Funktion am Button
`.vx-btn-preview` im Assistent-Tab, die eine Sprachprobe von `/preview-voice`
holt und über ein `Audio`-Objekt abspielt. Der Dialog kommt darin nicht vor.
Die beiden Namen sehen aus wie Öffnen und Schliessen desselben Dialogs und
haben nichts miteinander zu tun. Beide Fundstellen tragen jetzt einen
Kommentar, der genau das festhält — das war der Grund, die Löschung als
eigenen Schritt zu führen.

**Dabei gefunden:** der Overlay-Guard `_anyOverlayOpen()`, der das
Kontextmenü unterdrückt, solange ein Dialog offen ist, prüfte acht fest
verdrahtete IDs. **Fünf davon zeigten ins Leere** (`detail-overlay`,
`vx-detail-v2`, `vx-upgrade-modal`, `vx-minutes-modal` und der tote
`vx-preview-modal`), während die meisten echten Dialoge fehlten. Bei offenem
Nachfassen-, Aufgaben-, Support-, Commercial-, Setup-Hilfe- oder Tour-Dialog
liess er das Kontextmenü also durch. Ersetzt durch eine Abfrage über
`role="dialog"` — das trägt seit Phase 2 jeder Dialog. Geprüft über
`getClientRects()`, weil `getComputedStyle` den eigenen `display`-Wert auch
dann liefert, wenn ein Vorfahr `display:none` trägt; bei den Dialogen mit
`role` am inneren `.modal` wäre das immer „offen".

**S10 · Gelöscht**, als eigener Commit. `vxPendingPreview()` unangetastet.

### S11 · Zweites Akzent-Blau — **erledigt**

`--vx-brand: #3478ED` gegen das kanonische `--vx-color-brand: #1A6FE8`:
18 `var(--vx-brand)`-Nutzungen (7× `color`, 6× `background`, 4×
`border-color`) plus drei abgeleitete `rgba(52,120,237,…)`-Werte.

**Es war nicht nur eine Inkonsistenz.** `#3478ED` erreicht gegen Weiss
**4.15:1** und lag damit unter der 4.5:1-Schwelle; der kanonische Ton
erreicht **4.68:1**. Bei 13 der 18 Nutzungen ist der Wert Textfarbe oder
Hintergrund unter weisser Schrift — die Zusammenführung behebt dort einen
Kontrastfehler.

- `--vx-brand` ist jetzt Alias auf `--vx-color-brand`, dieselbe Mechanik wie
  bei `--vx-brand-dark` in S1.
- Die drei abgeleiteten Alphawerte (Fokusring, Navigations-Hover,
  Auswahl-Schatten) auf den kanonischen Ton gezogen.
- Vier Streu-Literale `#eef4ff` zeigen jetzt auf das bereits benannte Token
  `--vx-ui-badge-info-bg` — gleicher Wert, keine sichtbare Änderung, nur ein
  Literal weniger.

### S12 · Der dunkle Dialogkopf — **erledigt**

Nachtrag vom selben Tag, aus dem Design-System-Token-Pass heraus gemeldet:
„Nachfassen planen" und „Anfrage als erledigt markieren?" nutzen noch das
Navy-Header-plus-weisser-Body-Muster.

Der Befund stimmte, war aber nicht auf die zwei Dialoge beschränkt. Das Band
kam aus `--vx-modal-head` und traf damit **jeden** Dialog der klassischen
Familie; der Support-Dialog hielt sich in `customer-support-components.css`
eine zweite, eigene Fassung davon. Nach S1 war Night gleichzeitig die Farbe
der bestätigenden Aktion — Kopfband und Button trugen also denselben Wert in
zwei verschiedenen Rollen, was die in S1 gewonnene Bedeutung wieder
verwässerte.

Der Kopf ist jetzt eine helle Fläche mit Haarlinie, Titel in Night, Symbol
und Schliessen-Knopf in einer 6%-Night-Tönung. Damit liegt der Dialog auf
derselben Linie wie `.vx-appbar`, deren Vertrag genau das schon festhält —
sie hat die dunklen Vollbreiten-Bänder auf allen Screens abgelöst, inklusive
dem Night-Banner der Detailansicht. Dialoge waren der letzte Ort, an dem das
Band überlebt hat.

- **Drei Ebenen setzten den Kopf**, zwei davon mit `!important`
  (Basisregeln, „Voxera Night Modal Headers", „FINAL MODAL POLISH"). Sie
  zeigen jetzt alle auf einen Tokensatz `--vx-modal-head*`, statt dass eine
  vierte Ebene sie überschreibt.
- **Der Trenner brauchte eine eigene Regel nach der `border:none`-Sperre**
  weiter unten im Dokument. Die Sperre („Avoid accidental inner white
  hairlines on modal headers") stammt aus der Zeit des Night-Kopfs, wo jede
  helle Linie ein Versehen war; auf der hellen Fläche ist sie das, was den
  Kopf als Kopf lesbar macht.
- **Zwei weitere Label-Sprachen gefunden.** `.modal-body label` (Versalien,
  gesperrt) und `.vx-modal-field label` (10px/700 auf `--vx-text3` = #94A3B8,
  2.9:1 auf Weiss und damit unter AA). Beide auf die Label-Rolle
  (12px/600, `--vx-ui-meta-color`, 4.83:1) gezogen; gemessen über vier
  Dialoge, alle Beschriftungen identisch.
- **Die S6-Begründung zum neutralen Symbol gilt weiter**, ihr Grund hat sich
  aber geändert: Das Symbol war neutral, *weil* es auf Night sass. Jetzt ist
  es neutral, weil die Tonunterscheidung weiterhin allein am Button hängt —
  dieselbe Entscheidung, neue Herleitung.

Geprüft: fünf Dialoge der klassischen Familie plus Support liefern Kopf
`#FFFFFF`, Titel `#0D1F3C`, Symbolfläche `rgba(13,31,60,.06)`.
`.detail-head` trägt seine Night-Regel noch, hat aber null Nutzer im Markup
und wurde deshalb nicht angefasst.

### Noch offen

- **Ein zweites Geometrie-Tokenpaar.** `--vx-control-min-height: 46px` und
  `--vx-radius-control: 12px` in `customer-design-system.css` gegen die in S5
  eingeführten `--vx-btn-height: 44px` und `--vx-btn-radius: 10px`. Die Regel,
  die sie anwendet, steht in `:where(…)` und hat damit Spezifität null: für
  `.btn` gewinnen die S5-Werte, für Klassen ohne eigene Geometrie —
  `.vx-ops-btn`, `.vx-as-capability-toggle` — greifen die 46/12. Dieselbe
  Drift-Mechanik wie bei `#0F2347` und `#3478ED`, diesmal in der Geometrie.
  Ausserhalb der Dialoge und damit ausserhalb des bisherigen Umfangs.

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

- ~~Zwei Akzent-Blau nebeneinander~~ — als **S11** erledigt, siehe oben.
- ~~Keine Fokusfalle in irgendeinem Dialog~~ — als **S4b** erledigt, siehe
  Phase 2.
- **Dialog-Funktionen, die von Runtime-Dateien überschrieben werden.**
  `vxCommercialOpen`/`-Close` in `index.html` sind wirkungslos, weil
  `customer-runtime-commercial-controller.js` dieselben Namen auf `window`
  setzt. Ob es weitere solche Paare gibt, wurde nicht systematisch geprüft —
  lohnt einen eigenen Durchgang, weil jede Änderung an der wirkungslosen
  Fassung stillschweigend nichts tut.
