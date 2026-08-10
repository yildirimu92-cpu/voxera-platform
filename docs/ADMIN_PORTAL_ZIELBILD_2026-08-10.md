# Admin-Portal — Zielbild

**Stand:** 10.08.2026 · **Grundlage:** `ADMIN_PORTAL_VEREINFACHUNG_DIAGNOSE_2026-08-10.md`
**Status:** Vorschlag zur Besprechung. **Keine Umsetzung ohne Freigabe.**

---

## 0. Was sich durch deine vier Antworten geändert hat

| Deine Antwort | Folge für das Zielbild |
|---|---|
| **W0 wartet** — erst Gesamtzielbild, dann zusammen | Kein Vorab-PR. Die vier Sofortpunkte sind unten in die Wellen eingearbeitet: Weiss-auf-Weiss und Preistext fallen in **Welle 2**, Demo-Daten in **Welle 7**. |
| **Aktivität, Insights, Verträge bleiben** — regelmässig genutzt | Dimension 3 schrumpft auf toten Code. Und die Befunde drehen sich um: Diese drei Screens sind heute **schlecht erreichbar** (kein Desktop-Eintrag) und **unbedienbar** (Insights und Aktivität haben je null Bedienelemente). Sie brauchen nicht weniger, sondern mehr. |
| **Alle 29 Patches auflösen** | Das Zielbild ist ein echter Architekturschnitt, keine Symptombehandlung. Unten steht für jeden einzelnen Patch, wohin er geht. |
| **Tote-Code-Liste separat** | Eigenes Dokument: `ADMIN_PORTAL_TOTER_CODE_LISTE_2026-08-10.md`. Nicht in den Customer-Dashboard-Aufräum-Auftrag eingespeist. |

RLS/Staging ist raus — geht in den „kleinere Restfunde"-Chat.

**Eine Zahl vorweg, damit sie nicht am Ende überrascht:** Alle 29 Patches aufzulösen sind
nach meiner Schätzung **16–24 Arbeitstage**. Der Fahrplan führt für den Launch noch
~6–10 Tage Restaufwand. Dieses Vorhaben ist also grösser als der gesamte verbleibende
Launch-Weg. Abschnitt 8 macht daraus drei Optionen — das ist die wichtigste Entscheidung
in diesem Dokument.

---

## 1. Neue Erkenntnisse seit der Diagnose

Für das Zielbild habe ich einen **Ablationstest** gefahren: jeden der 29 Patches einzeln
blockiert, das Portal starten lassen und über alle acht Screens gemessen, was sich ändert.

### 1.1 Die Patch-Schicht trägt weniger, als sie aussieht

| Ergebnis | Zahl |
|---|---|
| Patches, ohne die der Start **bricht** | **1** (`cases-state-hotfix`, 6 Fehler) |
| Patches, deren Entfernen die Oberfläche **sichtbar** verändert | **6** (`ui`, `navigation`, `cases`, `payment-account`, `voices`, `v3-regression-fix`) |
| Patches ohne messbare Wirkung im geprüften Ausschnitt | **22** |

**Wichtige Einschränkung:** „Keine messbare Wirkung" heisst *nicht* „tut nichts". Der Test
zählt sichtbare Bedienelemente je Screen im Ausgangszustand — er öffnet keine Dialoge und
durchläuft keine Abläufe. Patches wie `invoice-adjustments`, `launch-p0` oder
`prompt-builder-v2` wirken genau dort. Was der Test zeigt, ist etwas anderes und für den
Umbau Entscheidendes: **ihre Wirkung ist eng umgrenzt und lokalisierbar.** Genau das macht
sie einzeln ablösbar, statt nur alle zusammen.

### 1.2 Die Kopfzeilen-Ursache ist isoliert nachgewiesen

| Konfiguration | Kopfzeilen gesamt | unlesbar | navy |
|---|---|---|---|
| Alle Patches (= heutiger Zustand) | 33 | **30** | 0 |
| **Ohne `admin-runtime-ui.js`** | 32 | **0** | 0 |
| Ohne design-system-v2 + v3 + regression-fix | 33 | **0** | 30 |

Zwei Dinge sind damit bewiesen:

1. **Die Kontrast-Heuristik in `admin-runtime-ui.js` ist die alleinige Ursache.** Ohne sie
   ist keine einzige Kopfzeile unlesbar — die weisse Kopfzeile aus design-system-v2 trägt
   für sich schon die richtige Schriftfarbe.
2. **Beide Generationen funktionieren allein.** Ohne das neue Designsystem sind alle 30
   Köpfe wieder navy und lesbar. Kaputt ist ausschliesslich die Kombination.

Das ist die beste Nachricht in diesem Dokument: Der sichtbarste Fehler des Portals ist
kein Umbau, sondern eine Löschung.

### 1.3 Zwei Patches verstecken Bedienelemente

Beim Entfernen tauchen Bedienelemente *auf* — die Patches blenden sie also aus:

- **`v3-regression-fix`**: Einstellungen 56 → **68** Bedienelemente. Der Patch versteckt
  **12 Elemente** (Alt-Zahlungslinks) per CSS, statt sie aus dem Markup zu nehmen.
- **`cases.js`**: Assistenten 4 → **16**. Der Patch versteckt **12 Elemente** auf dem
  Assistenten-Screen und baut den Änderungsanfragen-Bereich neu.

Beides ist kein Fehler, sondern gewollte Konsolidierung — aber sie steht an der falschen
Stelle. Im Zielbild verschwindet das Markup, statt dass CSS es verdeckt.

### 1.4 Die Aufrufkette ist neunfach, nicht sechsfach

Genauere Zählung: **9 Dateien** weisen `callAdminFunction` neu zu (in der Diagnose stand 6 —
`cases-state-hotfix`, `invoice-only-ch` und `invoice-mail-routing-fix` nutzen ein anderes
Zuweisungsmuster und waren durchgerutscht). Zwei davon prüfen vorher mit einer
Marker-Schleife, ob sie schon in der Kette hängen. Der Aufwand, den diese Schicht betreibt,
um sich selbst nicht doppelt einzuhängen, ist das Argument gegen sie.

### 1.5 Die drei Plan-Input-Patches zeigen im Test keine Wirkung

`plan-input-cleanup`, `plan-input-render-fix` und `plan-placeholder-visibility` (280 Zeilen,
34 `!important`) erzeugen mit und ohne exakt dieselben berechneten Werte auf den
Plan-Feldern. **Verdacht:** eine Kette von Symptom-Patches gegen ein Problem, das es nicht
mehr gibt. **Unverifiziert** — vor dem Löschen an der Produktion gegenprüfen, weil der
Auslöser womöglich einen Zustand braucht, den meine Testdaten nicht erzeugen.

---

## 2. Die sechs Regeln

Das Zielbild in Regelform. Jede Regel benennt den Befund, den sie verhindert.

| # | Regel | verhindert |
|---|---|---|
| **R1** | **Eine Quelle pro Bildschirm.** Kein Skript ändert nachträglich, was ein anderes gebaut hat. | 51 Zuweisungen an globale Funktionen |
| **R2** | **Kein Monkey-Patching.** Wer Verhalten ändern will, ändert die Quelle. Wrapper nur für echte Querschnittsthemen (Protokoll, Fehler) und dann genau einmal. | die neunfache `callAdminFunction`-Kette |
| **R3** | **CSS gehört in Dateien.** Kein `<style>` aus JavaScript. `!important` nur mit Begründung im Kommentar. | 16 injizierte Stylesheets, 868 `!important` |
| **R4** | **Ein Weg zum Server, eine Fehlerbehandlung, eine Tonalität.** | 3 Feedback-Systeme, 44 native Browser-Kästen |
| **R5** | **Kein Zustand aus dem DOM.** Kein Positionsindex, kein Textvergleich als Selektor. Wer Daten braucht, liest sie aus `state`. | `patchWorkspace` (`btns[0]`, `textContent === 'Details'`) |
| **R6** | **Kein Dauer-Timer.** Wer auf Änderungen reagieren muss, wird gerufen — nicht alle 500 ms geweckt. | 8 Timer, 12 MutationObserver |

R1 und R5 sind die wichtigsten: Sie sind der Grund, warum die vier Bedienfehler aus der
Diagnose überhaupt entstehen konnten.

---

## 3. Zielbild A — Sitemap und Screen-Zuschnitt

### 3.1 Die eine Routentabelle

Heute gibt es **drei Navigationen mit drei verschiedenen Landkarten** (Diagnose 4.3). Im
Zielbild gibt es **eine Tabelle**, aus der alle drei erzeugt werden:

```js
// core/routes.js — die einzige Wahrheit über die Struktur des Portals
{ id:'overview',          gruppe:'Arbeitsbereich', label:'Cockpit',         mobilePrimär:true  }
{ id:'offers',            gruppe:'Arbeitsbereich', label:'Sales'                               }
{ id:'contracts',         gruppe:'Arbeitsbereich', label:'Verträge'                            }
{ id:'customers',         gruppe:'Arbeitsbereich', label:'Kunden',          mobilePrimär:true  }
{ id:'customer-workspace',gruppe:null,             label:'Kunden-Workspace', unterseiteVon:'customers' }
{ id:'onboarding',        gruppe:'Arbeitsbereich', label:'Onboarding',      mobilePrimär:true  }
{ id:'billing-finance',   gruppe:'Arbeitsbereich', label:'Billing',         mobilePrimär:true  }
{ id:'cases',             gruppe:'Arbeitsbereich', label:'Cases & Support'                     }
{ id:'ai-setup',          gruppe:'Steuerung',      label:'Assistenten'                         }
{ id:'insights',          gruppe:'Analyse',        label:'Insights'                            }
{ id:'activity',          gruppe:'Analyse',        label:'Aktivität'                           }
{ id:'settings',          gruppe:'System',         label:'Einstellungen'                       }
```

Daraus entstehen automatisch: die Desktop-Seitenleiste (alle mit `gruppe`), die untere
Mobile-Leiste (`mobilePrimär` + „Mehr") und die Mehr-Schublade (der Rest). Ein neuer Screen
ist ein neuer Tabelleneintrag — nicht drei Stellen im Markup plus ein Patch.

**Was sich dadurch für dich ändert:** Aktivität und Verträge bekommen einen
Desktop-Eintrag. Beide sind heute auf dem Handy erreichbar und am Schreibtisch nur über die
URL — bei Screens, die du regelmässig nutzt, ist das der teuerste einzelne Bedienfehler im
Portal.

### 3.2 Screen für Screen

| Screen | bleibt | was sich ändert |
|---|---|---|
| **Cockpit** | Einstieg, 3 KPI + 2 Handlungslisten | Überschriften wieder lesbar. Die KPI-Logik aus `ui.js` wird Quelle statt Patch. |
| **Sales** | Offerten-Pipeline und Offerten-Assistent | Verliert den Verträge-Reiter → von 2'999 px auf rund 2'000 px. Die Reiterleiste entfällt ganz. **[Entscheidung 1]** |
| **Verträge** | eigener Screen, wie heute genutzt | **Eine** Tabelle statt zwei. Der `innerHTML`-Abgleich entfällt, damit auch der Handler-Verlust. Eigener Navigationseintrag. |
| **Kunden** | Liste mit Filtern und Karten | Die per Patch angehängten Kürzel (Rechnungen/Verträge je Karte) werden Teil des Karten-Markups. |
| **Kunden-Workspace** | Unterseite von Kunden | **9 Knöpfe → 5.** Und: Rechnungen und Verträge des Kunden werden **im Workspace** angezeigt statt weggesprungen. *Das ist eine Verbesserung, keine Aufräumung — als solche markiert.* |
| **Onboarding** | Warteschlange + Detail | 9 versteckte Stub-Elemente entfallen. |
| **Billing** | 4 Reiter (Aufgaben, Alle Rechnungen, Subscriptions, Überzug) | Zeilenaktionen kommen aus der Quelle statt vom 800-ms-Timer. Die 12 per CSS versteckten Alt-Zahlungslinks verschwinden aus dem Markup. |
| **Assistenten** | 4 Reiter (Änderungsanfragen, Konfiguration, Sync-Status, Stimmen) | Alle vier aus **einer** Reitertabelle. Heute sind drei per `onclick` verdrahtet und der vierte („Stimmen") wird von einem Patch nachträglich eingehängt. |
| **Insights** | Auslastung, Plan-Verteilung, Zahlungen, Marge | Bekommt einen Desktop-Eintrag und einen **Zeitraumfilter** — heute null Bedienelemente. Der Margen-Text kommt aus `format.js`, statt nachträglich zerlegt zu werden. |
| **Aktivität** | 5 Protokoll-Karten | Bekommt einen Desktop-Eintrag, einen **Zeitraum-/Kundenfilter** und einen Sprung ins jeweilige Objekt — heute null Bedienelemente. „Recent Onboarding Actions" wird deutsch. |
| **Einstellungen** | Konto, System, Benachrichtigungen, Admins, Pläne, Zahlungskonto | Feature-Flag-Stub und Demo-Admins raus. Für die Plan-Konfiguration siehe **[Entscheidung 2]**. |

### 3.3 Entscheidung 1 — wo leben die Verträge?

Heute existieren sie doppelt: als Route `#contracts` *und* als Reiter in Sales, synchron
gehalten per `innerHTML`-Kopie. Eine der beiden Wohnungen muss gehen.

- **Empfehlung: eigener Navigationseintrag, Sales behält nur Offerten.**
  Sales ist heute mit 2'999 px und 47 Bedienelementen der zweitgrösste Screen; der Schnitt
  halbiert ihn. Verträge nutzt du regelmässig — ein eigener Eintrag ist ein Klick statt
  zwei. `#offers` mit Vertragsreiter leitet auf `#contracts` um, alte Links bleiben gültig.
- **Alternative:** Verträge bleiben ein Sales-Reiter, die eigene Route wird ein Alias.
  Spricht dafür: der Ablauf Offerte → Vertrag bleibt räumlich zusammen.

Beides ist sauber umsetzbar; die Doppelung verschwindet so oder so.

### 3.4 Entscheidung 2 — Plan-Konfiguration

Die Seite zeigt vier Pakete nebeneinander mit je rund zwölf Feldern, alles gleichzeitig
editierbar, ein gemeinsamer Speichern-Knopf. **Vorschlag:** Übersicht mit vier Zeilen, und
„Bearbeiten" öffnet *ein* Paket. Ein Speichern-Vorgang betrifft dann ein Paket, und ein
Tippfehler in Paket 3 kann Paket 1 nicht mehr mitreissen.

Das ist ein Entwurfsvorschlag, kein Aufräumbefund — deshalb ausdrücklich als Frage
markiert. Wenn du die Nebeneinander-Ansicht bewusst willst, bleibt sie.

---

## 4. Zielbild B — Architektur

### 4.1 Ziel-Dateibaum

```
admin-panel/
  index.html                      ← nur noch: Rahmen, Screen-Container, Modal-Container
                                     (heute 17'109 Z. → Ziel < 2'000 Z. reines Markup)
  shared/
    admin-design-tokens.css       ← Farbrollen, Typo, Abstände, Radien — EINE Quelle
    admin-base.css                ← Reset, Grundtypografie, App-Layout
    admin-components.css          ← Karte, Kopfzeile, Tabelle, Knopf, Badge, Chip,
                                     Modal, Toolbar, Leerzustand, Reiter
    admin-responsive.css          ← Breakpoints, Tabelle→Karte auf Mobile
    js/
      core/
        api.js                    ← EIN Weg zum Server: Endpunkttabelle, Auth-Kopf,
                                     Fehlerwörterbuch, Wiederholung, Protokoll
        routes.js                 ← die Routentabelle aus 3.1
        router.js                 ← Routen setzen, Navigationen erzeugen, Sprünge
        state.js                  ← Datenhaltung + Laden
        format.js                 ← CHF, Datum, Telefon — beim Rendern, nicht danach
        feedback.js               ← ein Toast (mit Tonalität), ein Dialog
        lifecycle.js              ← Kundenstatus, Badges, Freigabelogik
      screens/
        cockpit.js   customers.js   workspace.js   onboarding.js
        sales.js     contracts.js   billing.js     assistants.js
        cases.js     activity.js    insights.js    settings.js
      components/
        modal.js     table.js       filterbar.js   empty-state.js
```

**Klassische Skripte, kein Bundler.** Der Netlify-Build führt heute nur
`build-runtime-config.mjs` aus. Das bleibt so — die Dateien werden in fester Reihenfolge
geladen wie heute, nur besitzt jede genau eine Sache. Kein neues Werkzeug, keine neue
Fehlerquelle im Deploy. *(Falls du später einen Bundler willst, ist dieser Schnitt die
Voraussetzung dafür — aber er ist nicht Teil dieses Vorhabens.)*

### 4.2 `core/api.js` — das Herzstück

Neun Dateien weisen heute `callAdminFunction` neu zu. Was sie eigentlich alle wollen, sind
vier Dinge, die in **eine** Datei gehören:

```js
// Statt: jeder Patch hängt sich in die Kette und leitet um.
// Sondern: eine Tabelle sagt, welche Aktion zu welchem Endpunkt geht.
const ENDPUNKTE = {
  'customers.update'      : 'admin-customer-update',   // aus data-integrity
  'contracts.terminate'   : 'contract-terminate',      // aus contract-termination
  'invoice.mail'          : 'invoice-mail-dispatch',   // aus invoice-mail-routing-fix
  …
};
// Ein Fehlerwörterbuch statt fünf Stellen mit eigenen Meldungen (aus voice-errors etc.).
// Eine Stelle, die den Auth-Kopf setzt. Eine Stelle, die protokolliert.
```

Damit lösen sich neun Wrapper in eine Tabelle und ein Wörterbuch auf. Das ist die einzige
Stelle des Umbaus, an der wirklich *weniger* Code entsteht statt nur besser sortierter.

**Vorbild ist das Backend.** `_lib/require-admin.js` macht im Server genau das: eine Stelle,
eine Rollentabelle, eine Capability pro Aktion, 39 von 54 Functions nutzen sie. `api.js`
ist das Gegenstück im Browser.

### 4.3 Die vier Ablösebewegungen

Jeder Patch macht genau eine dieser vier Bewegungen:

| | Bewegung | heisst |
|---|---|---|
| **E** | **Einbauen** | Das Verhalten wird gebraucht. Code zieht ins Zielmodul um, Patch wird gelöscht. |
| **T** | **Tokenisieren** | Ist CSS. Wandert in Token-/Komponentendatei, `!important` entfällt dabei. |
| **W** | **Wegfallen** | Repariert nur einen anderen Patch oder behandelt ein Symptom. Verschwindet mit der Ursache. |
| **L** | **Löschen** | Tot. |

### 4.4 Ablösetabelle — alle 30 Patches

Sortiert nach Welle. „Risiko" stammt aus dem Ablationstest (1.1).

| # | Patch | Z. | Bew. | Zielort | Risiko |
|---|---|---|---|---|---|
| **Welle 1 — Fundament** ||||||
| 1 | `data-integrity` | 33 | E | `core/api.js` (Endpunkttabelle) | gering |
| 2 | `invoice-mail-routing-fix` | 78 | E | `core/api.js` (Endpunkttabelle) | gering |
| 3 | `voice-errors` | 54 | E | `core/api.js` (Fehlerwörterbuch) | gering |
| 4 | `contract-termination` | 65 | E | `core/api.js` + `core/lifecycle.js` (2 Prädikate) | gering |
| 5 | `invoice-only-ch` | 210 | **W** | ersetzt durch `core/format.js` — formatiert beim Rendern statt nachträglich. Der Teil „Alt-Zahlungsfelder verstecken" fällt mit dem Markup weg. | gering |
| **Welle 2 — Design-System** ||||||
| 6 | `design-system-v2` | 370 | T | `admin-design-tokens.css` + `admin-components.css` (233 `!important`) | gering |
| 7 | `design-system-v3` | 98 | T | dieselben Dateien — v2 und v3 werden **eine** Tokenmenge (109 `!important`) | gering |
| 8 | `v3-regression-fix` | 159 | **W** | repariert nur v3 → entfällt. Der Teil, der 12 Alt-Zahlungslinks versteckt, wird zu einer Markup-Löschung. | **mittel** (versteckt 12 Elemente) |
| 9 | `mobile` | 145 | T | `admin-responsive.css` + `data-label` direkt im Markup (97 `!important`) | gering |
| 10 | `plan-input-cleanup` | 54 | **W** | Symptom-Patch, im Test wirkungslos — vorher an Produktion prüfen | gering |
| 11 | `plan-input-render-fix` | 121 | **W** | dito | gering |
| 12 | `plan-placeholder-visibility` | 105 | **W** | dito | gering |
| 13 | `admin-ui-cleanup` | 161 | **W** | kosmetische Reparaturen an fremden Screens → in die jeweiligen Screen-Quellen | gering |
| 14 | `ui` (CSS-Teil + Kontrast-Heuristik) | ~120 | **W/T** | **`applyDarkHeaderContrast` wird ersatzlos gelöscht** — nachgewiesene Alleinursache der 30 unlesbaren Köpfe. CSS → Komponentendatei. | **mittel** |
| **Welle 3 — Router & Navigation** ||||||
| 15 | `navigation` | 265 | E/**W** | Sprünge und Filter → `core/router.js`. `patchWorkspace` (Textvergleich + Positionsindex) fällt **W** — ersetzt durch echtes Workspace-Markup mit 5 Knöpfen. `patchCustomers` → `screens/customers.js`. | **hoch** |
| 16 | `ui` (Cockpit-Teil) | ~144 | E | `screens/cockpit.js` (KPI, Warteschlangen) + `core/lifecycle.js` (Status-Label, Badge, Snapshot) | **mittel** |
| **Welle 4 — Cases** ||||||
| 17 | `cases` | 300 | E | `screens/cases.js` + Navigationseintrag in die Routentabelle | **mittel** (versteckt 12 Elemente auf Assistenten) |
| 18 | `cases-state-hotfix` | 352 | E | `screens/cases.js` — **einziger Patch, ohne den der Start bricht.** Gemeinsam mit #17 migrieren, nicht danach. | **hoch** |
| 19 | `cases-admin-only` | 149 | E | `screens/cases.js` — wird eine Filterfunktion | gering |
| 20 | `cases-usability-fix` | 103 | **W** | nur Beschriftungen und Filter-Reset über `cases.js` → gehört in die Quelle | gering |
| 21 | `operations-v3` (Cases-Teil) | ~160 | E | `screens/cases.js` (Fälligkeitsfeld, Case-Tabelle) | gering |
| **Welle 5 — Billing** ||||||
| 22 | `invoice-adjustments` | 292 | E | `screens/billing/financial-action.js` (eigener Dialog) | gering |
| 23 | `billing-inline-qr` | 182 | E | `screens/billing.js` — Zeilenaktionen aus der Quelle, 800-ms-Timer entfällt | gering |
| 24 | `billing-ui-consolidated` | 132 | E | `screens/billing.js` (Aktionsmenüs, Leerzustände, Mahn-Dialog) | gering |
| 25 | `operations-v3` (Mahn-Teil) | ~127 | E | `screens/billing.js` (Mahnstufen) | gering |
| **Welle 6 — Assistenten & Wizard** ||||||
| 26 | `prompt-builder-v2` | 382 | E | `screens/assistants/wizard-steps.js` — **wird die Quelle des Schrittmodells.** `getWizardSteps` in `index.html` wird ersetzt, nicht umwickelt. | **hoch** (fachlich) |
| 27 | `launch-p0` | 536 | E | Website-Analyse → `wizard.js`; Go-Live-Modal → `screens/customers/go-live.js`; Routing → `core/api.js` | **hoch** |
| 28 | `sync` | 275 | E | `screens/assistants/sync-tab.js` | gering |
| 29 | `voices` | 428 | E | `screens/assistants/voices-tab.js`; Reiter kommt aus der Reitertabelle | gering |
| **Welle 7 — Rest** ||||||
| 30 | `payment-account` | 207 | E | `screens/settings/payment-account.js` | gering |
| 31 | `twilio-number-assignment` | 8.8 KB | E | `screens/customers/number-assignment.js` — eigenständigster Patch, praktisch konfliktfrei | gering |
| — | `qr-invoice-controls` | 8.7 KB | **L** | wird nicht geladen → löschen | keins |

**Bilanz:** 18× Einbauen, 3× Tokenisieren, 8× Wegfallen, 1× Löschen.
`ui` und `navigation` sind aufgeteilt und stehen deshalb zweimal.

**Rund 1'400 Zeilen fallen ersatzlos weg** (die acht W-Zeilen ohne `invoice-only-ch`s
Format-Anteil und ohne den Markup-Ersatz). Der Rest zieht um.

---

## 5. Reihenfolge und Abnahme je Welle

Reihenfolge nach zwei Kriterien: **Fundament vor Fassade** und **risikoarm vor riskant**.
Jede Welle ist ein eigener PR mit eigener Abnahme — nach jeder Welle läuft das Portal.

| Welle | Inhalt | Abnahmekriterium | Schätzung |
|---|---|---|---|
| **1 — Fundament** | `api.js`, `format.js`, `feedback.js` | Neun `callAdminFunction`-Zuweisungen → **1**. Alle Endpunktaufrufe funktionieren. Der Preistext lautet wieder `0.018 CHF/Minute`. 44 native Browser-Kästen → 0. | 1–2 T |
| **2 — Design-System** | Token-/Komponenten-/Responsive-Dateien; 9 CSS-Patches ablösen | **30 unlesbare Kopfzeilen → 0.** 16 injizierte Stylesheets → 0. 868 `!important` → < 50. Sichtprüfung aller 12 Screens auf zwei Breakpoints. | 3–4 T |
| **3 — Router** | Routentabelle, beide Navigationen erzeugt, Vertragsdoppelung auflösen, Workspace 9→5 | Desktop- und Mobile-Navigation zeigen dieselben Ziele. `contracts-table-body-inline` existiert nicht mehr. Kein `innerHTML`-Abgleich mehr im Repo. | 2–3 T |
| **4 — Cases** | 5 Patches (1'064 Z.) → `screens/cases.js` | `cases-state-hotfix` ist entfernt, **ohne dass der Start bricht.** Die 12 auf Assistenten versteckten Elemente sind entweder sichtbar oder aus dem Markup weg. | 3–4 T |
| **5 — Billing** | 4 Patches → `screens/billing.js` + Dialog | Alle vier Billing-Reiter bedienbar ohne Timer. Die 12 Alt-Zahlungslinks sind aus dem Markup entfernt, nicht per CSS versteckt. | 3–4 T |
| **6 — Assistenten** | Wizard-Schrittmodell, Website-Analyse, Sync, Stimmen | **Die Schrittliste im Code ist die Schrittliste im Browser.** Ein Wizard-Durchlauf pro Branchenvorlage. | 3–5 T |
| **7 — Rest & Aufräumen** | Zahlungskonto, Nummernzuweisung, Demo-Daten, toter Code, Hidden Stubs | 0 Laufzeit-Patches. `index.html` unter 2'000 Zeilen. Keine „Hidden stubs"-Blöcke mehr. | 1–2 T |

**Summe: 16–24 Arbeitstage.**

### Zielzahlen

| | heute | Ziel |
|---|---|---|
| Laufzeit-Patch-Skripte | 29 | **0** |
| Zur Laufzeit injizierte Stylesheets | 16 | **0** |
| `!important` | 868 | **< 50** |
| Dauer-Timer | 8 | **0** |
| MutationObserver | 12 | **0** |
| `callAdminFunction`-Zuweisungen | 9 | **1** |
| Feedback-Systeme | 3 | **1** |
| Unlesbare Kopfzeilen | 30 | **0** |
| `index.html` | 17'109 Z. | **< 2'000 Z.** |
| Navigationen mit eigener Landkarte | 3 | **1 Tabelle, 3 Ansichten** |

---

## 6. Wie abgenommen wird

Der Weiss-auf-Weiss-Fehler war im Code unsichtbar — beide beteiligten Regeln sehen für sich
korrekt aus. Er wurde erst beim Rendern sichtbar. Für einen Umbau dieser Grösse ist reine
Quelltextprüfung deshalb keine Abnahme.

**Vorschlag:** Der Aufbau aus der Diagnose wird ein Prüfskript im Repo — Chromium startet
das Portal gegen Testdaten und misst nach jeder Welle:

1. Startet das Portal ohne Konsolenfehler?
2. Rendern alle 12 Screens?
3. **Kontrastprüfung:** kein Text mit weniger als 4.5:1 gegen seinen Hintergrund.
4. **Strukturprüfung:** Zahl der injizierten Stylesheets, Dauer-Timer, `!important` — als
   Zähler, die nur fallen dürfen.
5. Ablation: Jeder verbleibende Patch einzeln blockiert — bricht etwas?

Punkt 3 hätte den heutigen Fehler beim Entstehen gefangen. Punkt 4 macht Rückfall unmöglich.

Das passt in das bestehende Muster: 38 Workflows und 69 `verify-*`-Skripte gibt es schon.
Aufwand für das Prüfskript: rund ein halber Tag, in Welle 1 enthalten.

---

## 7. Risiken

| Risiko | Einschätzung | Umgang |
|---|---|---|
| **Ein Patch tut mehr, als der Test sieht** | **hoch, wahrscheinlich** — 22 Patches zeigen im Ausgangszustand keine Wirkung, die meisten wirken in Dialogen und Abläufen | Vor jeder Welle die betroffenen Abläufe manuell durchklicken. Kein Patch wird gelöscht, ohne dass sein Verhalten im Zielmodul benannt ist. |
| **Cases-Welle** | 5 Patches, 1'064 Zeilen, einer bricht beim Entfernen den Start | Gemeinsam migrieren, nicht einzeln. Grösste Welle, eigene Abnahme. |
| **Wizard-Welle** | fachlich am heikelsten: das Schrittmodell wird umgedreht — der Patch wird Quelle, die Quelle Vergangenheit | Ein Durchlauf pro Branchenvorlage vor dem Merge. Berührt den Prompt-Bau, also auch `PROMPT_BUILDER_VERSION` und den Fan-out-Sync mitdenken. |
| **Kollision mit Launch-Arbeit** | **sicher** — 16–24 Tage gegen ~6–10 Tage Launch-Rest | Abschnitt 8. |
| **Migrations-Drift** | bekanntes Prozessthema | Dieses Vorhaben braucht **keine** Migration. Reine Frontend-Arbeit. |
| **Plan-Input-Patches löschen ein reales Verhalten** | gering, aber unverifiziert | An Produktion gegenprüfen, bevor sie fallen. |

---

## 8. Die eigentliche Frage: wann?

16–24 Tage sind mehr als der gesamte verbleibende Launch-Weg. Drei ehrliche Optionen:

**A — Vor dem Pilot, vollständig.** Der Launch verschiebt sich um rund drei bis vier Wochen.
Dafür startet der Pilot auf einer Architektur, in der jede weitere Änderung billig ist.

**B — Welle 1 + 2 vor dem Pilot, Rest danach.** Rund **5 Tage**. Damit sind erledigt: die
30 unlesbaren Kopfzeilen, der zerstörte Preistext, die neunfache Aufrufkette, die 44
Browser-Kästen und das Design-System. Also **alles, was ein Pilotkunde oder du selbst
täglich sieht.** Die Wellen 3–7 sind Wartbarkeit, keine Sichtbarkeit — die können nach dem
Pilotstart laufen.

**C — Komplett nach dem Pilot.** Nichts verzögert sich, aber der Pilot läuft auf einem
Portal mit 30 unsichtbaren Überschriften.

**Meine Empfehlung ist B.** Der Grund ist die Zahl aus 1.2: Der sichtbarste Fehler des
Portals wird durch eine *Löschung* behoben, nicht durch einen Umbau — und er liegt in
Welle 2, also früh. Das Kosten-/Nutzenverhältnis der ersten fünf Tage ist deutlich besser
als das der restlichen fünfzehn.

Das ist auch der Ort, an dem deine Entscheidung „W0 wartet" wieder auftaucht: In Option B
wartet W0 nicht lange — es ist Teil der ersten beiden Wellen und damit in rund einer Woche
erledigt, aber eben als Teil des Zielbilds statt als Einzelpflaster. Genau so, wie du es
wolltest.

---

## 9. Was du entscheiden musst

| # | Frage | Empfehlung |
|---|---|---|
| **1** | **Wann?** Option A (alles vor Pilot), **B** (Wellen 1+2 vor Pilot, ~5 Tage), oder C (alles danach)? | **B** |
| **2** | **Verträge:** eigener Navigationseintrag und Sales nur noch Offerten — oder Verträge bleiben Sales-Reiter? | eigener Eintrag |
| **3** | **Plan-Konfiguration:** vier Pakete nebeneinander wie heute, oder Übersicht + „ein Paket bearbeiten"? | ein Paket bearbeiten |
| **4** | **Workspace:** sollen Rechnungen und Verträge eines Kunden *im* Workspace erscheinen statt wegzuspringen? Das ist eine Verbesserung, kein Aufräumen — deshalb frage ich. | ja |

Sobald 1 beantwortet ist, kann Welle 1 starten. 2–4 werden erst in Welle 3 bzw. 7 gebraucht.

---

## 10. Was in dieser Runde nicht getan wurde

Kein Code geändert, kein Patch angefasst, nichts gelöscht. Neu sind zwei Dokumente: dieses
und `ADMIN_PORTAL_TOTER_CODE_LISTE_2026-08-10.md`.

Der Ablationstest lief lokal gegen Testdaten mit unverändertem Produktionscode. Die
Produktionsdatenbank wurde nicht angefasst.

Nicht Teil dieses Zielbilds und ausdrücklich offen gelassen: die 123 Spalten in
`customers`, die Toast-Tonalität als eigener Punkt (das Zielbild sieht in `feedback.js`
den Platz dafür vor, entscheidet aber nichts), alles im Customer Dashboard, Make,
E-Mail-Vorlagen, Szenario 09.
