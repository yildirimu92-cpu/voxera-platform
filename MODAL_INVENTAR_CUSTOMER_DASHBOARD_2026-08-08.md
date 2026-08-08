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

Dazu kommen **vier Button-Geometrien**:

| Klasse | Höhe | Radius | Vorkommen |
|---|---|---|---|
| `.btn` | 44px | 10px (`--btn-radius`) | klassische Modals |
| `.modal-btn-p` / `.modal-btn-s` | 42px | 11px (`!important`-Override) | Plan & Optionen |
| `.vx-ap-btn` | 40px | 12px (`--vx-radius-control`) | Assistent |
| `.vx-dv2-btn` | 32px | 999px (Pille) | Detail-Vollansicht |

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

## Vorschlag für die Reihenfolge (zur Abstimmung, nichts davon umgesetzt)

1. **Primärfarbe entscheiden.** Night-Navy `#0D1F3C` oder Blau `#1A6FE8` für
   die bestätigende Aktion — eine Entscheidung, die alle anderen Schritte
   festlegt. Betroffen: `.btn--primary`, `.modal-btn-p`, `.vx-ap-btn`,
   `.vx-dv2-btn-primary`.
2. **`.vx-ap-btn` auf den gewählten Wert ziehen.** `#0F2347` gegen `#0D1F3C`
   ist ein Unterschied, den niemand beabsichtigt hat — der billigste Schritt.
3. **Button-Geometrie zusammenführen.** Vier Höhen/Radien auf ein Paar
   reduzieren; die Pillenform der Detailansicht ist dabei die bewusste
   Ausnahme für Aktionszeilen und kann bleiben.
4. **`confirm-tone-*` und Buttonfarbe zusammenlegen**, damit Icon und Button
   nicht mehr getrennt gesteuert werden.
5. **Ad-hoc-Dialoge angleichen** (Onboarding, Tour) — Inline-Stile auf
   Klassen und Tokens umstellen.
6. **z-index-Skala als Token-Satz** neu vergeben und die toten Tokens
   entfernen.
7. **a11y-Attribute** an den vier Overlays ergänzen.
8. **Toten `#vx-preview-modal` entfernen.**
