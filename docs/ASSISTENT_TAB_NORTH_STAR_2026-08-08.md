# Etappe 6 — Assistent-Tab: Ist-Zustand & North-Star-Konzept

**Datum:** 08.08.2026
**Status:** Konzept zur Entscheidung — **kein Umsetzungsauftrag**
**Vorbild:** gleiches Vorgehen wie beim Heute-Screen (North Star „Executive Brief" vor Umsetzung)
**Quellen:** voxera-fahrplan.html (Tabs „Fahrplan"/Etappe 6, „Masterassistent", „Design-System", „Seiten-Definitionen", „Sonstiges"/Strategische Zukunftsidee) + verifizierter Code-Stand `main` @ 5e3d960

---

## 0. Kurzfassung

Der Assistent-Tab ist heute **kein gebauter Screen, sondern eine Laufzeit-Reparatur**: Drei
Module bauen ihn nach dem Laden aus Teilen zusammen, die ursprünglich im Einstellungs-Tab
lagen. Der alte, vollständige Assistent-Screen liegt unverändert im Markup darunter und wird
per CSS versteckt — bis auf **eine** Karte, die ein Inline-`style="display:flex"` trägt und
deshalb von dieser Regel nicht erfasst wird. Das ist exakt die verwaiste Karte kurz vor der
Fusszeile („L" / „Lara" / „Aktiv — Keine Änderungen ausstehend"). Die Vermutung im Auftrag
war richtig: dasselbe Alt-Element-Muster wie beim Heute-Screen.

Beim Aufräumen sind drei Dinge aufgefallen, die inhaltlich schwerer wiegen als die Karte
selbst:

1. **Die Begrüssung ist unsichtbar geworden.** Der Satz, mit dem sich der Assistent bei
   Anrufenden meldet, war im alten Screen zu sehen. In der heutigen Ansicht kommt er nicht
   mehr vor. Bei einem Produkt, das für den Kunden ans Telefon geht, ist das die wichtigste
   einzelne Information auf dem Screen.
2. **Ton und Anrede sind nicht mehr editierbar.** Die Editoren existieren nur im
   versteckten Alt-Block. Die API akzeptiert die Felder weiterhin — die Bedienung fehlt.
3. **Weiterleitung und Notfallnummer kommen im Kunden-UI nicht mehr vor.** Also genau die
   Antwort auf „was passiert, wenn es dringend ist".

Zusätzlich ist die im Tab „Masterassistent" offene Frage nach der Prompt-Architektur
**beantwortbar**: Ein 3-Layer-System existiert und läuft produktiv (Abschnitt 2.5). Die dort
vermuteten Funktionsnamen `resolvePromptVariables()` / `buildAutoGreeting()` gibt es im Repo
nicht — die tatsächlichen heissen anders.

Das Zielbild in Teil 2 heisst **„Der Steckbrief spricht"** und ist bewusst als Folge kleiner
Schritte formuliert, nicht als Umbau.

---

# Teil 1 — Ist-Zustand

## 1.1 Wie der Screen technisch zustande kommt

Es gibt **keine** zusammenhängende Definition des Assistent-Screens. Was der Kunde sieht,
entsteht zur Laufzeit aus vier Quellen:

| Quelle | Rolle |
|---|---|
| `customer-dashboard/index.html:7978–8303` | **Alt-Screen** (Accordion-Version). Vollständig im DOM, per CSS versteckt. |
| `shared/customer-runtime-unified-navigation.js` | Baut Appbar + 3er-Umschalter + Host in `#tab-assistent` ein und zieht drei Seiten aus dem Einstellungs-Tab herüber. |
| `shared/customer-runtime-assistant-profile.js` | Rendert „Assistent" und „Geschäftsprofil". |
| `shared/customer-runtime-assistant-status.js` | Schiebt „Fähigkeiten" und „Betriebsstatus" nachträglich in die Assistent-Ansicht. |
| `shared/customer-runtime-operational-updates.js` | Rendert „Aktuelle Infos". |

Ablauf beim Öffnen des Tabs:

```
#tab-assistent
├── #vx-assistant-root-header      ← zur Laufzeit eingefügt (.vx-appbar, Etappe 2)
├── #vx-assistant-root-switch      ← zur Laufzeit eingefügt (Assistent | Geschäftsprofil | Aktuelle Infos)
├── #vx-assistant-root-host        ← zur Laufzeit eingefügt
│   ├── #mehr-sub-assistant-profile   (ursprünglich in #tab-mehr erzeugt)
│   ├── #mehr-sub-business-profile    (ursprünglich in #tab-mehr erzeugt)
│   └── #mehr-sub-betriebsinfos       (wird in #tab-mehr erzeugt und hierher verschoben)
└── ── ab hier: kompletter Alt-Screen, per CSS ausgeblendet ──
    ├── .vx-legacy-assistant-identity   ← BLEIBT SICHTBAR (Abschnitt 1.3)
    ├── #vx-pending-bar, #vx-success-bar
    ├── Gruppe „Grundeinrichtung": Rufumleitung · Geschäftsprofil & Leistungen · Erreichbarkeit
    ├── Gruppe „Assistent-Verhalten": Ton & Anrede · Stimme & Name · Weiterleitungsziele
    └── Gruppe „Support": Admin kontaktieren
```

Die drei Unterbereiche sind **keine Sub-Screens**, sondern ein sichtbarer Umschalter — deshalb
ist der Assistent-Root bewusst pfeillos (bereits in Etappe 2 entschieden und dokumentiert).

## 1.2 Was der Kunde heute tatsächlich sieht

### Ansicht 1 — „Assistent"

| Karte | Inhalt | Bearbeitbar? |
|---|---|---|
| **Stimme** | Aktuelle Stimme + „Anhören"; darunter aufklappbar „Andere Stimme wählen" mit Filter Alle/Weiblich/Männlich und Stimmen-Kacheln | ab Business (`plan_config.voice_selection_enabled`) |
| **Name und Auftreten** | Namensfeld + „Name speichern"; darunter Lesezeilen Kommunikationsstil / Ansprache / Assistent bereit | Name ab Business; **Stil und Ansprache nur lesbar** |
| **Fähigkeiten** | Kachelraster aus dem Status-Snapshot | nein (korrekt) |
| **Geschäftswissen** | Pill „x von 4 Bereichen" + Lesezeilen Unternehmen / Leistungen / Öffnungszeiten + Button „Geschäftsprofil öffnen" | nein (verlinkt) |
| **Betriebsstatus** | Ein Satz Zusammenfassung + `<details>` „Technische Details" (Assistent, Telefonie, Stimme & Einstellungen, Kalender) | nein |

### Ansicht 2 — „Geschäftsprofil"

Eine Karte, vier Textfelder (Unternehmensbeschreibung, Leistungen und Angebote, Standort und
reguläre Öffnungszeiten, Häufige Fragen und Buchungshinweise), ein Speichern-Button. Sauber,
aber ein klassisches Formular ohne Rückmeldung, was die Eingabe im Gespräch bewirkt.

### Ansicht 3 — „Aktuelle Infos"

Zwei Karten nebeneinander: links „Aktiv und geplant" (Liste mit Status-Badge, aufgeschlüsselter
Gesprächslogik, Bearbeiten/Zurückziehen), rechts „Neue aktuelle Änderung" (Typ-Auswahl aus
6 Vorlagen, Zeitraum, empfohlene Gesprächslogik mit Vorschau-Satz, zwei `<details>` für
Feinjustierung).

**Das ist der beste Teil des Screens.** Er macht bereits genau das, was die Strategische
Zukunftsidee unter „Konfiguration als Gespräch" und „robuste Bestätigungsschleife" fordert:
Der Kunde wählt eine Situation, das System schlägt eine sichere Gesprächslogik vor, zeigt
den resultierenden Satz („So informiert Voxera Anrufende") und fixiert unverhandelbare Regeln
sichtbar („Bestehende Termine … Notfälle …"). Das Zielbild in Teil 2 macht dieses Muster zur
Sprache des ganzen Tabs, statt es auf einen Unterbereich zu beschränken.

## 1.3 Die verwaiste Karte — Root Cause

**Markup** (`customer-dashboard/index.html:7981`):

```html
<div class="vx-legacy-assistant-identity" style="display:flex;align-items:center;gap:14px;">
  <div id="assistent-avatar" …>L</div>
  <div id="assistent-name-display">Lara</div>
  <div id="vx-ass-status" class="vx-ass-status">● Aktiv — Keine Änderungen ausstehend</div>
</div>
```

**Ausblend-Regel** (`shared/customer-assistant-components.css:829`):

```css
#tab-assistent > :not(#vx-assistant-root-header):not(#vx-assistant-root-switch):not(#vx-assistant-root-host) {
  display: none;
}
```

Drei Ursachen greifen ineinander:

1. **Inline schlägt Stylesheet.** `style="display:flex"` steht direkt am Element, die
   Ausblend-Regel hat kein `!important`. Also gewinnt das Inline-Attribut. Alle anderen
   Alt-Elemente haben keine Inline-`display`-Angabe und verschwinden korrekt — deshalb ist
   es genau **eine** übrig gebliebene Karte, nicht der ganze Alt-Screen.
2. **Position.** Header, Umschalter und Host werden als *erste* Kinder eingefügt. Der
   Alt-Block bleibt dahinter — die Karte landet dadurch ganz unten, direkt vor der Fusszeile.
3. **Toter Updater.** Die Funktion, die Name und Initiale aktualisiert
   (`index.html:14505 ff.`), startet mit `getElementById('assistent-requests-list')` und
   bricht ab, wenn dieses Element fehlt. Es existiert im Dokument **nicht mehr** — der
   Bezeichner kommt im ganzen Repo nur noch in dieser einen Abfrage vor. Deshalb bleiben
   „L" und „Lara" auf den fest im HTML stehenden Werten stehen, egal wie der Assistent
   des Kunden heisst.

Punkt 3 ist derselbe Mechanismus wie beim bereits gemeldeten Avatar-Initialen-Fund auf dem
Heute-Screen: Nicht die Namenslogik ist falsch, sondern ein Alt-Element, das von keinem
lebenden Codepfad mehr erreicht wird. **Empfehlung: löschen, nicht reparieren** — der
Alt-Block hat keinen erreichbaren Einstiegspunkt mehr.

Auch der Text der Karte ist inzwischen sachlich falsch: „Keine Änderungen ausstehend" gehört
zu einem Freigabe-Modell (Änderungen sammeln → Vorschau → „Live schalten"), das es nicht
mehr gibt. `customer-update-assistant.js` synchronisiert heute **sofort** beim Speichern
(`sync_status: 'success'`). Es kann also gar nichts „ausstehen". Ausnahme: Weiterleitungs-
felder werden bewusst nicht synchronisiert (`skipped_forwarding_only`), weil sie über den
Admin bestätigt werden.

## 1.4 Weitere Funde

| # | Fund | Bewertung |
|---|---|---|
| **F1** | **Begrüssung nicht mehr sichtbar.** Der Alt-Screen zeigte den automatisch erzeugten Begrüssungssatz (`#assistent-greeting-visible`). Die heutige Ansicht zeigt ihn nirgends. | **Grösster inhaltlicher Verlust.** Der Kunde kann nicht mehr nachlesen, wie sein Assistent sich meldet. |
| **F2** | **Ton & Anrede nicht mehr editierbar.** Die Editoren liegen im versteckten Alt-Block; die neue Ansicht zeigt beide nur als Lesezeile. `customer-update-assistant.js` akzeptiert `ai_tone` und `ai_address_form` weiterhin. | Funktionsverlust ohne Ersatzpfad. |
| **F3** | **Weiterleitungsziele + Notfallnummer fehlen im Kunden-UI.** Nur im Alt-Block vorhanden. | Vertrauenskritisch bei einem Empfangs-Produkt. |
| **F4** | **Rufumleitung doppelt gepflegt.** `#assistent-rufumleitung-shell` (Alt-Block) und `#mehr-sub-rufumleitung` (Einstellungen) rendern dieselbe Komponente. | Nach dem Löschen des Alt-Blocks bleibt die Einstellungen-Variante als einzige. |
| **F5** | **Zwei Module streiten um dieselben Karten.** `customer-runtime-assistant-status.js` erzeugt die Fähigkeiten-Karte mit „N weitere Fähigkeiten anzeigen"-Umschalter; `customer-runtime-unified-navigation.js` entfernt diesen Umschalter per MutationObserver sofort wieder. `simplifyTechnicalStatus()` ist inzwischen komplett wirkungslos, weil die Status-Datei die Struktur bereits selbst so erzeugt. | Tote und gegeneinander laufende Logik — Nachfolgemuster des Bug-Musters aus Etappe 4/5. |
| **F6** | **Tonalität ist nur im Frontend plan-gated.** `index.html:15437` sperrt `ai_tone` für Starter-Kunden clientseitig; die Function prüft das nicht. Name und Stimme sind dagegen serverseitig über `plan_config` abgesichert. | Vor Wiederherstellung von F2 entscheiden: Regel wegnehmen oder serverseitig nachziehen. |
| **F7** | **Blau als Akzentfarbe.** Der Assistent-Bereich nutzt `#1A6FE8` als Primärakzent. Die Vier-Familien-Regel im Tab „Design-System" (Navy = Marke, Rot = Dringlichkeit, Gold = Lead-Qualität, Grün = Abschluss) kennt kein Blau — das Tokenset führt es aber als `--vx-color-brand` („primary interactive"). | **Echter Widerspruch, Entscheidung nötig** (siehe Abschnitt 4). |
| **F8** | **Keine Serifen-Typografie.** Newsreader = „Stimme" ist als Regel festgehalten und auf Heute-Screen und Anfragen-Detail umgesetzt. Der Assistent-Tab — der Screen, auf dem es buchstäblich um eine Stimme geht — verwendet ausschliesslich Sans-Serif. | Auffälligste Abweichung vom Design-System. |

**Umfang des Alt-Blocks** (Grössenordnung, exakte Abgrenzung braucht einen eigenen Pass wie
bei der Etappe-4-Legacy-Löschung): ~325 Zeilen Markup (`index.html:7978–8303`), ~245 Zeilen
CSS (`index.html:~5656–5901`) und ~15 nur von dort erreichbare Funktionen
(`vxToggleAcc`, `vxiEdit/Cancel/Save`, `vxrEdit/Cancel/Save`, `vxFillAccordionRead`,
`vxPendingPreview`, `vxPendingGoLive`, `vxSaveSection`, `prefillAssistentChange`,
`submitAssistentChange`, `vxInitRufumleitung_old`, …) im Bereich `index.html:14840–16660`.

## 1.5 Prompt-Architektur — die offene Frage aus Tab „Masterassistent" ist beantwortet

Der Tab hält fest: *„Ist-Zustand ungeklärt — war die Rede von einem 3-Layer-System, aber
nicht mehr sicher."* Der Code-Stand ist eindeutig.

**Das 3-Layer-System existiert und läuft produktiv.**
Zentrale Datei: `admin-panel/netlify/functions/_lib/prompt-builder-v2.js`, Version `2.1`.

Die im Tab vermuteten Funktionsnamen `resolvePromptVariables()` und `buildAutoGreeting()`
existieren im Repo nicht. Die tatsächlichen sind:

| vermutet | tatsächlich |
|---|---|
| `resolvePromptVariables()` | `buildPromptV2({ customer, masterPrompt, industryPrompt, assistantRole, operationalUpdates })` — enthält intern `resolve()` für Platzhalter |
| `buildAutoGreeting()` | `buildGreeting(name, type, personName, firmName, language)` |

**Layer-Zuordnung wie tatsächlich gebaut:**

| Layer | Quelle | Zustand |
|---|---|---|
| **1 — Voxera-Kern** | `system_config`, Zeile `key = 'prompt_master_l1'`, Feld `value` | vorhanden; Fallback-Grundgerüst im Code, falls leer |
| **2 — Branche** | `industry_templates.prompt_block` über `customers.industry_template_id` | Mechanik fertig, **Tabelle leer** → Layer rendert als `_(kein Branchen-Layer definiert)_` |
| **3 — Kunde** | `customers.ai_*` + `customer_operational_updates` (nur `status='published'` und `ends_at > jetzt`, max. 20) | vollständig in Betrieb |

Zusammenbau: Layer 1 ist das Gerüst mit den Platzhaltern `{{INDUSTRY_LAYER}}` und
`{{CUSTOMER_LAYER}}`; fehlen sie im Text, werden beide Layer angehängt. Variablen:
`{{ASSISTANT_NAME}}`, `{{ASSISTANT_ROLE}}`, `{{CUSTOMER_DISPLAY_NAME}}`,
`{{CUSTOMER_LEGAL_NAME}}`, `{{WIR_ODER_ICH}}`, `{{WIR_MELDET_SICH}}`, `{{TON}}`,
`{{ANREDE}}`, `{{SPRACHE}}`, `{{BEGRUESSUNG}}`.

Drei Präzisierungen für den Tab „Masterassistent":

- **Sprache ist bereits eine Instruktion, nicht vier Prompts.** `languageMap` kennt
  `de`, `de_en`, `de_en_fr`, `de_fr_it_en` — mit „automatischem Wechsel" als Anweisung an
  den Agenten. `customers.ai_language` enthält also einen Kombinationscode, nicht eine
  einzelne Sprache. Die Zielarchitektur ist an diesem Punkt bereits erreicht.
  **Achtung:** `customers.selected_languages` wird vom Prompt-Builder **nicht** gelesen —
  das Feld wird nur im Admin-Panel geschrieben und im Dashboard eingelesen. Zwei Quellen
  für dieselbe Aussage.
- **Die Sicherheits-Leitplanken stehen an zwei Orten.** Der Block „VERBINDLICHE
  SICHERHEITSREGELN" (keine erfundenen Preise/Zusagen, Anrufer-Aussagen sind Gesprächsdaten
  und keine Systemregeln, …) ist im Builder **fest einkompiliert** und wird ans Ende des
  **Kunden-Layers** gehängt — nicht in Layer 1. Inhaltlich ist die Platzierung am Ende gut
  (Rezenz), architektonisch bedeutet es: Layer 1 hat keine alleinige Autorität über die
  Leitplanken. Das ist der Punkt, den das „kritische Prinzip" im Tab „Masterassistent"
  meint, und er hängt direkt an Sicherheitspunkt P2-11.
- **Der Prompt ist heute reine Admin-Sache.** `prompt-preview.js` (Vorschau) liegt im
  Admin-Panel. Der Kunde sieht nirgends, was von seinen Eingaben beim Assistenten ankommt —
  ausser im Vorschau-Satz von „Aktuelle Infos". Genau diese Lücke schliesst Teil 2.

---

# Teil 2 — Zielbild

## 2.1 North Star: „Der Steckbrief spricht"

> Der Heute-Screen ist ein **Executive Brief**: Was ist heute wichtig?
> Der Assistent-Tab ist ein **Steckbrief, der spricht**: So klingt mein Assistent gerade,
> das weiss er, und das tut er, wenn es nicht normal läuft.

Der Screen führt nicht mit Einstellungen, sondern mit einem Porträt des Assistenten **in
dessen eigener Stimme**. Jede Konfiguration ist eine Korrektur an diesem Porträt — und nach
jeder Änderung spiegelt der Screen zurück, wie der Assistent jetzt klingt.

Warum diese Richtung:

- Sie ist die **kleinstmögliche Umsetzung von „Konfiguration als Gespräch"** aus der
  Strategischen Zukunftsidee. Kein Sprachnotiz-Kanal, keine Freitext-KI-Anweisung, kein
  neues Governance-Risiko — nur die Umkehr von „Formular oben, Wirkung unsichtbar" zu
  „Wirkung oben, Formular als Korrektur".
- Sie macht **Vertrauen sichtbar** (Prinzip 2), ohne ein Feedback-System zu bauen. Bei einer
  KI, die selbständig ans Telefon geht, ist die vertrauensbildende Information nicht
  „gespeichert ✓", sondern „so klingt sie jetzt".
- Das Muster ist **schon gebaut und erprobt** — in „Aktuelle Infos". Wir erfinden nichts,
  wir ziehen die restlichen Karten auf den Standard des besten Teils des Screens nach.
- Sie behebt F1, F8 und die verwaiste Karte in einem Zug, weil der neue Kopfbereich exakt
  den Platz einnimmt, den die tote Identitätskarte beansprucht hat.

## 2.2 Zielstruktur

```
Assistent                                              ← .vx-appbar (unverändert, Etappe 2)
[ Assistent ] [ Geschäftsprofil ]                      ← Umschalter von 3 auf 2 (siehe 2.4)

┌───────────────────────────────────────────────────────────────────┐
│  SO MELDET SICH IHR ASSISTENT                                     │
│                                                                   │
│  „Grüezi, hier ist Lara von der Muster Sanitär AG.                │  ← Newsreader-Serife
│   Das Gespräch wird zur Bearbeitung aufgezeichnet.                │    = Stimme
│   Wie kann ich Ihnen helfen?"                                     │
│                                                                   │
│  Stimme Sofia · Sie-Form · warm-professionell     [ ▶ Anhören ]  │  ← Sans = Bedienung
│  Aktiv seit 14. Juli · alle Verbindungen betriebsbereit           │  ← EINE Statuszeile
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│  AKTUELL ABWEICHEND VOM NORMALBETRIEB              (nur wenn ja)  │  ← „ein Strom"
│  Bis 15. August geschlossen — Lara bietet Termine ab dem 16. an.  │
│                                     [ Bearbeiten ] [ Zurückziehen ]│
└───────────────────────────────────────────────────────────────────┘

┌─ Was Lara weiss ──────────────────────────────────────────────────┐
│  Drei von vier Bereichen sind hinterlegt. Häufige Fragen fehlen    │  ← Fliesstext
│  noch — sie helfen Lara am meisten bei Rückfragen.                 │    statt Pill
│                                          [ Geschäftsprofil öffnen ]│
└───────────────────────────────────────────────────────────────────┘

┌─ Was Lara kann ───────────────────────────────────────────────────┐
│  Fähigkeiten (unverändert aus dem Status-Snapshot)                 │
│                                                                   │
│  Immer gültig — von Voxera gesetzt                                │  ← NEU: Layer 1
│  Keine Rechts-, Medizin- oder Finanzberatung · Notfälle sofort    │    sichtbar
│  weiterleiten · keine Zusagen ohne Bestätigung. Nicht überschreibbar.│
│                                                                   │
│  Ihre Branche: noch keine Vorlage hinterlegt                      │  ← NEU: Layer 2
└───────────────────────────────────────────────────────────────────┘

┌─ Wenn es dringend wird ───────────────────────────────────────────┐
│  Notfall → 144                                                    │  ← behebt F3
│  Schadenmeldung, Panne → Schadenhotline +41 44 …                  │
│  Änderung bestätigt Voxera vor der Aktivierung.  [ Änderung melden ]│
└───────────────────────────────────────────────────────────────────┘
```

## 2.3 Die tragenden Ideen im Einzelnen

### A. Kopfbereich statt Avatar-Kreis

Die verwaiste Karte wollte inhaltlich das Richtige (wer ist mein Assistent, wie ist sein
Zustand) und hat es falsch gelöst: Initiale + Name + Status-Punkt sagen nichts darüber aus,
wie der Assistent klingt.

Der neue Kopfbereich zeigt stattdessen **den echten Begrüssungssatz**, gesetzt in Newsreader.
Das ist keine kosmetische Entscheidung: die Typografie-Regel („Serife = Stimme/Inhalt,
Sans = Bedienelemente") liest sich hier zum ersten Mal als Aussage statt als Konvention —
das ist wörtlich das, was der Anrufer hört.

- Datenquelle vorhanden: `ai_greeting`, sonst `buildGreeting()`. Beides liefert `firstMessage`.
- „Anhören" existiert bereits (`preview-voice`, im Stimme-Block verdrahtet).
- Kein Avatar-Kreis, keine Initiale → der Avatar-Initialen-Fehlerpfad entsteht hier gar nicht
  erst neu. (Der separat gemeldete Heute-Screen-Fix bleibt davon unberührt.)

### B. Eine Statuszeile statt vier Status-Anzeigen

Heute konkurrieren: die tote Zeile „● Aktiv — Keine Änderungen ausstehend", die
Betriebsstatus-Zusammenfassung, das aufklappbare „Technische Details" und die
Sync-Rückmeldungen einzelner Karten.

Ziel: **eine** Zeile im Kopfbereich, im Executive-Brief-Ton. Im Normalfall ein ruhiger Satz.
Bei Abweichung nennt dieselbe Zeile die Abweichung im Klartext, und nur dann erscheint
„Technische Details". Der Datenlieferant (`technical_status`) bleibt unverändert.

### C. Die drei Layer sichtbar machen

Der Kunde kann heute nicht unterscheiden, was er selbst gesetzt hat, was seine Branche
mitbringt und was Voxera unverhandelbar festlegt. Der Screen sollte das zeigen:

- **Immer gültig — von Voxera gesetzt** (Layer 1): die Grundregeln in Kategorien, ausdrücklich
  als nicht überschreibbar markiert.
- **Ihre Branche** (Layer 2): heute ehrlich „noch keine Vorlage hinterlegt", weil
  `industry_templates` leer ist. Das ist keine Schwäche der Anzeige — es macht die grösste
  bekannte Inhaltslücke intern sichtbar, statt sie zu kaschieren.
- **Von Ihnen gesetzt** (Layer 3): alles Übrige, editierbar.

Doppelter Nutzen: Es beantwortet die Vertrauensfrage („kann ich meiner KI etwas verbieten und
hält sie sich daran?") und es kommuniziert die Prompt-Injection-Leitplanke aus P2-11 als
Produktversprechen, statt sie zu verstecken.

**Wichtig:** angezeigt werden **Kategorien in Klartext, nie der Prompt-Wortlaut.** Der
Wortlaut ist Angriffsfläche und gehört ins Admin-Panel (wo `prompt-preview.js` bereits liegt).

### D. Aktuelle Infos als Band, nicht als Reiter

„Ein Strom statt zwei Listen" auf Screen-Ebene: Wenn eine temporäre Änderung aktiv oder
geplant ist, ist das die zweitwichtigste Aussage des Screens — sie gehört sichtbar unter den
Kopfbereich, nicht hinter einen Reiter, den man aktiv anwählen muss. Das Erfassungsformular
bleibt ein Drill-in.

Damit fällt der Umschalter von drei auf zwei Bereiche und der Screen bewegt sich einen Schritt
in Richtung der reduzierten IA („Start / Assistentin / Einblicke") — ohne Navigationsumbau.

### E. Bestätigungsschleife statt Freigabe-Modell

Das alte „Änderungen sammeln → Vorschau → Live schalten" kommt **nicht** zurück: Speichern
synchronisiert heute sofort, und die Interaktions-Richtlinien fordern optimistische Updates
mit Toast und Undo statt Bestätigungsdialogen.

Was stattdessen zurückkommt, ist der **inhaltlich wertvolle Teil** dieses Modells: Nach jedem
prompt-relevanten Speichern spiegelt der Kopfbereich das Ergebnis zurück — „Lara meldet sich
ab sofort so: …". Das ist die Bestätigungsschleife, welche die Strategische Zukunftsidee für
dialogische Konfiguration ausdrücklich verlangt, und sie ist billig zu haben, weil
`customer-assistant-profile` die nötigen Werte bereits liefert.

Die eine echte Ausnahme bleibt sichtbar: Weiterleitungsänderungen gehen **nicht** sofort live
(`skipped_forwarding_only`), sondern über die Admin-Bestätigung. Das muss der Block „Wenn es
dringend wird" sagen — heute steht diese Erklärung nur im versteckten Alt-Block.

### F. Was bewusst nicht in dieses Zielbild gehört

| Nicht drin | Grund |
|---|---|
| Daumen hoch/runter | Inline-Feedback (Prinzip 2) gehört an Anrufeinträge, nicht an einen Konfigurationsscreen. |
| Sprachnotiz / Freitext-Anweisung an die Assistentin | Der riskante Teil der Zukunftsidee. Braucht Governance-Klärung; kein Launch-Thema. |
| Prompt-Wortlaut im Kunden-UI | Angriffsfläche, siehe P2-11. Bleibt Admin. |
| Branchenvorlagen befüllen | Inhaltsarbeit, nicht Design-Etappe. Der Screen zeigt die Lücke, füllt sie aber nicht. |
| Navigation auf 3 Destinationen reduzieren | Struktureller Umbau — verstösst gegen „schrittweise, nie als grosser Umbau". |

## 2.4 Design-Sprache

| | Vorgabe |
|---|---|
| **Serife (Newsreader)** | Begrüssungssatz, Vorschau-Sätze („So informiert Voxera Anrufende"), Fliesstext-Zusammenfassungen — alles, was Stimme des Assistenten ist. |
| **Sans (Plus Jakarta Sans)** | Alle Bedienelemente, Labels, Pills, Umschalter, Buttons. |
| **Night-Navy `#0D1F3C`** | Marke und primäre Aktion. |
| **Gold `#E8C547`** | Plan-Hinweise („ab Business" bei Stimme und Name) — deckt sich mit `--vx-color-gold` („plan / badge accent") und mit dem bestehenden `.plan-badge`. |
| **Rot** | ausschliesslich Notfall/Dringlichkeit — hier: Notfallnummer. |
| **Grün** | nur Abschluss-Rückmeldungen. |
| **Karten** | kanonische `--vx-ui-card-radius`, Etappe-1-Bausteine; keine Sonderradien. |
| **Verhalten** | Interaktions-Richtlinien aus Etappe 3 gelten unverändert: ganze Karte klickbar wo Detail existiert, Buttons deaktivieren statt ausblenden, Toast mit Klartext bei Fehlern, optimistische Updates, 2-Zeilen-Kürzung. |

**Bewusst unaufgeräumt gelassen:** Ob Blau (`#1A6FE8`) bleibt, ist eine
Design-System-Entscheidung oberhalb dieser Etappe (F7). Das Zielbild funktioniert mit beiden
Antworten — aber die Antwort sollte vor der Umsetzung feststehen, sonst wird der
Assistent-Tab zum dritten Screen mit einer eigenen Auslegung.

**Layout-Kritik vom Heute-Screen nicht wiederholen:** Der offene Punkt dort lautet „drei
verschiedene linke Akzent-Ränder direkt übereinander gestapelt". Der Assistent-Tab bekommt
deshalb **keine** linken Akzentkanten — Trennung nur über Weissraum und Kartengrenzen.

## 2.5 Vorgeschlagene Schrittfolge

Bewusst so geschnitten, dass jeder Schritt einzeln lieferbar und einzeln verifizierbar ist.
Kein Schritt setzt einen späteren voraus.

| Schritt | Inhalt | Launch-kritisch | Modell/Effort |
|---|---|---|---|
| **S1** | **Alt-Block löschen** (Markup + CSS + tote Funktionen + die dann überflüssige `:not()`-Ausblendregel). Behebt die verwaiste Karte an der Wurzel. **Voraussetzung: S3 ist entschieden**, sonst geht Ton/Anrede endgültig verloren. | ja | Sonnet 5, Medium — nach eigenem Abgrenzungs-Pass wie bei Etappe 4 |
| **S2** | **Kopfbereich „So meldet sich Ihr Assistent"**: Begrüssung in Serife, Meta-Zeile, Anhören, eine Statuszeile. Behebt F1 + F8. | ja | Sonnet 5, Medium |
| **S3** | **Ton & Anrede wieder editierbar** im Kopfbereich, mit Rückspiegelung der neuen Begrüssung. Behebt F2. Setzt Entscheidung zu F6 voraus. | ja | Sonnet 5, Medium |
| **S4** | **„Wenn es dringend wird"** — Weiterleitungen und Notfallnummer read-only, Änderungspfad über Admin-Anfrage. Behebt F3. | ja | Sonnet 5, Medium |
| **S5** | **Layer-Sichtbarkeit** — „Immer gültig / Ihre Branche / Von Ihnen gesetzt". | nein, stark empfohlen | Opus 5, Medium (Textarbeit) |
| **S6** | **Aktuelle Infos als Band**, Umschalter 3 → 2. | nein | Sonnet 5, Medium |
| **S7** | **Doppelte Karten-Logik entwirren** (F5) — eine Stelle rendert Fähigkeiten und Betriebsstatus, nicht zwei. | nein, aber Bug-Vorbeugung | Sonnet 5, Medium |

Aufwandsschätzung insgesamt: **2–3 Arbeitstage** — deckt sich mit dem für Etappe 6 im Tab
„Zeitschätzung" bereits eingestellten Korridor. Kein Nachtrag nötig.

---

# 3. Was das für die Kommandozentrale bedeutet

Vorschläge für Nachträge, sobald das Konzept entschieden ist:

- **Tab „Masterassistent"** — Abschnitt „Der eigentliche Master-System-Prompt": Ist-Zustand
  ist geklärt (Abschnitt 1.5). Funktionsnamen korrigieren, Layer-Quellen eintragen,
  drei Präzisierungen ergänzen (Sprache bereits gelöst; `selected_languages` ungenutzt;
  Sicherheitsregeln fest im Kunden-Layer statt in Layer 1).
- **Tab „Fahrplan"/Etappe 6**: „Konzeptfrage offen" kann auf „Konzept vorgelegt" wechseln.
- **Tab „Offene Entscheidungen"**: die fünf Punkte aus Abschnitt 4.
- **Tab „Sicherheit"/P2-11**: Querverweis, dass die Leitplanken heute an zwei Orten stehen.
- **Tab „Seiten-Definitionen"/Assistent**: „Enthält 3 Unterbereiche" gilt nur, solange S6
  nicht umgesetzt ist.

---

# 4. Offene Entscheidungen — vor jeder Umsetzung

| # | Frage | Empfehlung |
|---|---|---|
| **E1** | **Blau `#1A6FE8`** — offiziell als fünfte Farbfamilie „interaktiv" aufnehmen, oder auf Night-Navy vereinheitlichen? | Aufnehmen und in der Vier-Familien-Regel nachtragen. Es ist bereits als `--vx-color-brand` tokenisiert und produktweit im Einsatz; Entfernen wäre ein Umbau, keine Etappe. |
| **E2** | **Alt-Block löschen oder verstecken?** | Löschen (S1). Er hat keinen erreichbaren Einstiegspunkt mehr; jedes weitere Verstecken erzeugt die nächste verwaiste Karte. |
| **E3** | **Umschalter 3 → 2 Bereiche** (Aktuelle Infos als Band)? | Ja, aber als S6 — nach den launch-kritischen Schritten. |
| **E4** | **Layer 1 im Kunden-UI zeigen?** | Ja, aber nur Kategorien in Klartext, nie Prompt-Wortlaut. |
| **E5** | **Ton/Anrede für alle Pläne oder ab Business?** | Für alle freigeben. Die heutige Sperre ist reine Frontend-Optik (F6) und die Function prüft sie nicht — Freigeben ist ehrlicher als eine Sperre serverseitig nachzubauen. Alternativ: bewusst als Business-Merkmal setzen und dann auch serverseitig durchsetzen. |

---

## Anhang — Dateiverweise

| Was | Wo |
|---|---|
| Alt-Screen Markup | `customer-dashboard/index.html:7978–8303` |
| Verwaiste Karte | `customer-dashboard/index.html:7981–7987` |
| Toter Name/Avatar-Updater | `customer-dashboard/index.html:14505–14516` |
| Alt-Screen CSS | `customer-dashboard/index.html:~5656–5901` |
| Alt-Screen Funktionen | `customer-dashboard/index.html:14884–16660` (verstreut) |
| Ausblend-Regel | `customer-dashboard/shared/customer-assistant-components.css:829` |
| Laufzeit-Shell + Umschalter | `customer-dashboard/shared/customer-runtime-unified-navigation.js:157–261` |
| Assistent-/Geschäftsprofil-Rendering | `customer-dashboard/shared/customer-runtime-assistant-profile.js:202–243` |
| Fähigkeiten + Betriebsstatus | `customer-dashboard/shared/customer-runtime-assistant-status.js:114–144` |
| Aktuelle Infos | `customer-dashboard/shared/customer-runtime-operational-updates.js` |
| Speichern + Sofort-Sync | `customer-dashboard/netlify/functions/customer-update-assistant.js:185–226` |
| Profil-/Rechte-Endpoint | `customer-dashboard/netlify/functions/customer-assistant-profile.js:207–330` |
| Prompt-Builder (3 Layer) | `admin-panel/netlify/functions/_lib/prompt-builder-v2.js` |
| Layer-Quellen laden | `admin-panel/netlify/functions/trigger-elevenlabs-sync.js:28–77` |
| Prompt-Vorschau (Admin) | `admin-panel/netlify/functions/prompt-preview.js` |
