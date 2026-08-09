# Admin-Portal vereinfachen — Diagnose über drei Dimensionen

**Stand:** 10.08.2026 · **Auftrag:** breite Bestandsaufnahme, keine Umsetzung
**Gegenstand:** `admin-panel/` (admin.voxera.ch) — bewusst getrennt vom Customer Dashboard

---

## 0. Befund in drei Sätzen

Das Admin-Portal hat **nicht drei gleich grosse Probleme, sondern ein Problem mit drei
Symptomen**: Fast der gesamte Umbau der letzten Wochen wurde als *Laufzeit-Patch über*
den bestehenden Code gelegt, statt im Code selbst. 29 Skripte schreiben nach dem Laden
Markup, Beschriftungen, Handler und CSS des 17'109-Zeilen-Monolithen `index.html` um —
mit 12 MutationObservern, 8 Dauer-Timern und 683 `!important`.

Das ist keine theoretische Schuld: **30 von 33 Kartenüberschriften im laufenden Portal
sind weisse Schrift auf weissem Grund**, weil zwei dieser Patches dieselbe Kopfzeile
besitzen und voneinander nichts wissen. Der Befund ist im Browser reproduziert, nicht
aus dem Code geschlossen.

Empfehlung: **Dimension 2 (Code-Struktur) zuerst**, aber nicht als Selbstzweck — die
Bedienungsprobleme aus Dimension 1 sind grösstenteils *Folgen* der Patch-Architektur und
verschwinden mit ihr. Dimension 3 (Funktionsumfang) liefert dabei die Abkürzung: was
gelöscht wird, muss nicht migriert werden.

---

## 1. Wie geprüft wurde

**Statisch:** vollständige Lektüre von `admin-panel/index.html`, allen 30
`shared/admin-runtime-*.js`, `shared/offer-brand.js`, den 54 Netlify-Functions und
33 `_lib`-Modulen; Schema der 16 vom Portal gelesenen Tabellen aus Supabase (nur
Spaltennamen, keine Zeilen).

**Im Browser (Klick-Test):** Das Portal wurde lokal mit Chromium gestartet — **unveränderter
Produktionscode**, nur die Supabase-Verbindung durch einen Stub mit Testdatensätzen ersetzt
(5 Kunden, 8 Rechnungen, 5 Offerten, 5 Verträge, 12 Anrufe, 6 Cases). Alle 8 Navigationsziele
plus Kunden-Workspace wurden aufgerufen, jeder sichtbare Knopf im Workspace einmal gedrückt,
Desktop (1440×900) und Mobile (390×844) getrennt.

**Grenzen — bitte mitlesen:**

- **Fakt** heisst hier: im Browser beobachtet oder im Code direkt belegt.
- **Wahrscheinlich** heisst: durch Code belegt, aber nicht an der Produktion gemessen.
- Ich hatte **keinen Login auf admin.voxera.ch**. Alles Beobachtete stammt aus dem lokal
  gestarteten Produktionscode. Zwei Dinge könnten dort abweichen: die Reihenfolge, in der
  die 29 Patch-Skripte über das Netz eintreffen, und die echten Datenmengen.
- **Nutzungsdaten fehlen vollständig.** Es gibt keine Telemetrie im Portal. Alle Aussagen zu
  „wird kaum genutzt" in Dimension 3 sind **Kandidaten zur Diskussion**, keine Einstufungen.
- Nicht angefasst: Make, E-Mail-Vorlagen, Szenario 09, Customer Dashboard.

---

## 2. Grössenordnung

| | Admin-Portal | Customer Dashboard (zum Vergleich) |
|---|---|---|
| `index.html` | 17'109 Zeilen / 891 KB | 41'129 Zeilen |
| davon CSS in `<style>` | 2'175 Zeilen | in **9 CSS-Dateien** ausgelagert |
| davon JS inline | 12'782 Zeilen, **492 Funktionen** | teilweise ausgelagert |
| Design-Token-Datei | **keine** | `customer-design-tokens.css` |
| Laufzeit-Skripte | **30 Dateien / 5'989 Zeilen** (29 geladen) | 20 Dateien |
| Modals in einer Datei | 24 | (eigenes Inventar existiert) |
| Netlify-Functions | 54 + 33 `_lib` = 19'858 Zeilen | — |

Weitere Kennzahlen (Admin, Fakt):

- **20 Stylesheets** im laufenden Dokument, davon **16 zur Laufzeit per JavaScript eingefügt**
- **868 `!important`** (185 in `index.html`, 683 in den Patches)
- **156 verschiedene Hex-Farben**, daneben 47 CSS-Variablen in `index.html` und 30 weitere,
  konkurrierende in den Patches
- **12 MutationObserver** und **8 Dauer-Timer** (500 / 700 / 700 / 800 / 900 / 900 / 1200 /
  1200 ms), die dauerhaft das DOM abscannen
- **254 Inline-`onclick`**, **892 Inline-`style`**-Attribute
- Drei Feedback-Generationen nebeneinander: **44 native `alert()`/`confirm()`**,
  **27 `voxAlert`/`voxConfirm`**, **111 `showToast()`**

---

## 3. Dimension 2 zuerst — Code-Struktur

*(Diese Dimension steht bewusst vorn, weil sie die anderen beiden erklärt.)*

### 3.1 Die Patch-Architektur ist der Kern

`shared/offer-brand.js` lädt am Ende eine **fest verdrahtete Liste von 29 Skripten** in
fester Reihenfolge nach. Jedes hängt sich an den bereits geladenen Monolithen:

```
admin-runtime-ui.js?v=20260801-1
admin-runtime-navigation.js?v=20260731-3
… 27 weitere …
admin-runtime-twilio-number-assignment.js?v=20260801-4
```

Die Versionsstempel sind die einzige verbliebene Chronologie (die Git-Historie ist an dieser
Stelle zusammengefasst) und zeigen **drei Wellen**: `20260731` (10 Skripte), `20260801`
(15 Skripte), `20260802` (2 Skripte). Das entspricht der Feststellung „drei Markup-Generationen"
beim Customer Dashboard — hier sind es drei *Patch-Wellen*.

**Was diese Skripte tun (Fakt, aus dem Code):**

- **51 Zuweisungen an rund 48 globale Funktionen** — die Patches ersetzen Funktionen, die
  `index.html` definiert hat.
- `callAdminFunction` — der zentrale Aufruf an alle Server-Endpunkte — wird **sechsmal**
  neu zugewiesen (`billing-inline-qr`, `contract-termination`, `data-integrity`,
  `invoice-adjustments`, `launch-p0`, `voice-errors`). Jeder Wrapper behält den vorigen und
  ruft ihn auf: ein Aufruf durchläuft sechs fremde Schichten, bevor er den `fetch` erreicht.
- Mehrfach zugewiesen sind ausserdem `openAiWizard` (2×), `renderAll` (2×), `aiShowTab` (2×).
  Je einmal überschrieben werden unter anderem `setRoute`, `loadDataFromSupabase`,
  `getWizardSteps`, `renderCustomerWorkspace`, `renderCustomers`, `renderContracts`,
  `renderBillingFinance`, `getCustomerLifecycleStatus`, `deriveOnboardingSnapshot`,
  `submitCustomerGoLive`.
- **17 Skripte injizieren eigene `<style>`-Blöcke**, praktisch alle mit `!important`.

### 3.2 Was das praktisch bedeutet — der AI-Wizard als Beispiel

`index.html` definiert in `getWizardSteps()` acht Schritte (`website`, `branche`,
`identitaet`, `profil`, `persoenlichkeit`, `regeln`, `weiterleitungen`, `zusammenfassung`)
plus dynamische Branchen- und Kernfeld-Schritte.

`admin-runtime-prompt-builder-v2.js` umwickelt diese Funktion und baut das Ergebnis um:

1. faltet alle Branchen-Schritte in `profil` hinein,
2. **entfernt `weiterleitungen` ersatzlos**,
3. benennt sechs Schritte um („Profil & Leistungen" → „Profil & Angebot" usw.),
4. schiebt einen komplett neuen Schritt `agent_auftrag` ein,
5. ersetzt `render` und `collect` des Abschluss-Schritts.

Zusätzlich umwickelt `admin-runtime-launch-p0.js` `openAiWizard`, `wizardNext` und
`wizardFinish`.

> **Konsequenz:** Wer wissen will, was der Wizard tut, muss drei Dateien lesen *und die
> Transformation im Kopf simulieren*. Der Quelltext in `index.html` beschreibt einen
> Wizard, den es im Produkt nicht gibt.

### 3.3 Der teuerste Einzelmechanismus: Text-Ersetzung über das ganze Dokument

`admin-runtime-invoice-only-ch.js` läuft **alle 1'200 ms** über *jeden Textknoten des
Dokuments* und schreibt alles um, was nach Datum oder CHF-Betrag aussieht.

Das erzeugt einen belegbaren Inhaltsfehler. Im Insights-Screen steht im Quelltext
(`index.html:6105`):

```
V1-Schätzung: Basis 5 CHF + 0.018 CHF/Minute + ggf. Extra-Minutenkosten.
```

Im Browser steht dort tatsächlich:

```
V1-Schätzung: Basis CHF 5.00 + 0.CHF 18.00/Minute + ggf. Extra-Minutenkosten.
```

**Ursache (bewiesen):** Der zweite Regex `\b([+-]?\d[\d\s'’]*(?:[.,]\d{1,2})?)\s*CHF\b`
findet nach dem Punkt in `0.018` eine Wortgrenze, greift `018 CHF` heraus und formatiert es
zu `CHF 18.00`. Jede Zahl mit drei Nachkommastellen vor „CHF" wird so zerlegt — auch echte
Minutenpreise.

### 3.4 Zwei Patches besitzen dieselbe Kopfzeile — der Weiss-auf-Weiss-Fehler

**Fakt, im Browser gemessen: 30 von 33 `.card-head`/`.section-head` im Portal haben weissen
Text auf weissem Grund.**

Betroffen: Cockpit (3), Onboarding (1), Assistenten (6), Aktivität (5), Insights (5),
Einstellungen (5), Sales (5). Unsichtbar sind unter anderem „Heute handeln",
„Wartet auf dich", „Betrieb im Blick", „Änderungsanfragen", „ElevenLabs Sync-Historie".

**Ursachenkette (bewiesen):**

1. `index.html` (Generation A): `.card-head{background:#0D1F3C}` + `.card-head h3{color:#fff}`
   — dunkler Kopfbalken, weisse Schrift.
2. `admin-runtime-ui.js` misst beim Start die Hintergrund-**farbe** jeder Kopfzeile, rechnet
   die Helligkeit aus und stempelt bei `luminance < 0.46` die Klasse `vox-dark-head` — die
   `color:#fff!important` erzwingt. Zu diesem Zeitpunkt ist der Hintergrund noch navy.
3. `admin-runtime-design-system-v2.js` (14 Skripte später) fügt derselben Kopfzeile
   `vx-unified-head` hinzu und übermalt sie mit
   `background:linear-gradient(#FFFFFF,#FBFCFE)!important` — hell.
4. Niemand entfernt `vox-dark-head` wieder. Und selbst wenn die Messung erneut liefe, könnte
   sie nicht korrigieren: der neue Hintergrund ist ein **Verlauf**, `backgroundColor` ist
   damit `rgba(0,0,0,0)`, die Funktion bricht vorher ab.

**Das Aufschlussreichste daran:** Es gibt bereits einen Patch dagegen —
`admin-runtime-v3-regression-fix.js` repariert genau diese Farbkombination, aber **nur für
`#section-customers`**. Der Fehler wurde also einmal gesehen und an genau einer Stelle
zugeklebt, statt an der Wurzel. Deshalb ist die Kundenliste lesbar und alles andere nicht.

Ein direkter Verstoss gegen die Hausregeln in `AGENTS.md`: *„add-only patches that do not
remove or neutralize old logic"*, *„multiple handlers for the same action"*.

### 3.5 Drei Bau-Sprachen für dieselbe Karte

Im laufenden Portal existieren gleichzeitig:

| Sprache | Aussehen | wo |
|---|---|---|
| `.card-head` (Generation A) | navy, weisse Schrift | Quelltext-Vorgabe — **heute überall kaputt** |
| `.card-head` + `vx-unified-head` | weiss, dunkle Schrift | Ziel von design-system-v2 |
| eigenes Markup im Patch | navy, weisse Schrift, funktioniert | Kunden-Workspace, Zahlungskonto-Karte |

Auf **einem** Screen (Einstellungen) sind beide sichtbaren Varianten nebeneinander: fünf
unsichtbare Überschriften und eine lesbare („Zahlungskonto & QR-Rechnung"), weil letztere
von einem Patch mit eigenem Markup gebaut wird.

### 3.6 Doppelte Screens, per `innerHTML` synchron gehalten

Die Vertragstabelle existiert **zweimal im DOM**: als eigene Route `#section-contracts` und
als Reiter in Sales (`#sales-panel-contracts`). Der Abgleich (`index.html:9170`):

```js
if (origBody && inlineBody) inlineBody.innerHTML = origBody.innerHTML;
if (origCards && inlineCards) inlineCards.innerHTML = origCards.innerHTML;
```

Die versteckte Tabelle wird gerendert, dann wird ihr HTML in die sichtbare kopiert. Ereignis-
Handler gehen dabei verloren und müssen über Inline-`onclick` wieder eingesammelt werden.

### 3.7 Fünf „Hidden stubs"-Blöcke

An fünf Stellen stehen unsichtbare DOM-Elemente, **nur damit alte Render-Funktionen nicht
abstürzen**:

| Zeile | Kommentar im Code | Inhalt |
|---|---|---|
| 2409 | „Hidden stubs so existing JS doesn't crash" | 9 Onboarding-Elemente |
| 2638 | „Hidden stubs" | 2 Insights-Elemente |
| 2730 | „Hidden stubs for legacy compatibility" | 5 Finance-Elemente |
| 2805 | „Hidden stubs" | `settings-admin-list`, `settings-feature-list`, `settings-add-admin` |
| 3483 | „nicht mehr sichtbar, aber JS liest sie" | 2 Felder im Kunde-anlegen-Formular |

Dazu passend in `index.html:5798-5809`: eine Funktion, die zur Laufzeit prüft, ob sie in die
Insights-Ansicht oder in den „legacy"-Stub schreiben soll — beide Zielsätze werden gepflegt.

### 3.8 Ladereihenfolge hängt an einem Zufall

`init()` steht am Ende des Skriptblocks bei Zeile 15653, ruft aber `closeMobileMenu()`
(Zeile 15945) und `_planConfigData` (späterer Block) auf. Das funktioniert nur, weil
`authClient.auth.getSession()` am Anfang von `init()` lange genug braucht, dass der Parser
inzwischen die späteren Blöcke gelesen hat.

**Im Test belegt:** Mit einer sofort auflösenden Session bricht der Start reproduzierbar mit
`ReferenceError: closeMobileMenu is not defined` ab, und `renderCustomers`, `renderAiSetup`,
`renderInsights`, `renderBillingFinance` scheitern. Mit 40 ms Verzögerung läuft alles durch.
**Wahrscheinlich**, nicht bewiesen, dass das in Produktion je auftritt — Supabase' Session-Lock
erzeugt die nötige Pause meist. Es ist aber eine Zeitbombe ohne Netz.

### 3.9 Backend: hier ist es gut — und das ist die Vorlage

Das Gegenstück ist erfreulich. **39 von 54 Functions** nutzen `_lib/require-admin.js` mit
Rollen-Normalisierung und **Capability pro Aktion** (`customer:write`, `billing:write`,
`lifecycle:approve` …). `admin-mutate.js` bündelt 13 Aktionen hinter einem Endpunkt mit je
eigener Capability-Prüfung.

Die 15 Functions ohne `require-admin` habe ich einzeln geprüft — die meisten sind zu Recht
ohne: geplante Läufe (5), öffentliche Endpunkte für Kunden (3), ein `_lib`-Modul am falschen
Ort (`status-model.js`), Delegationen an geschützte Functions (`scrape-website-v2`) und ein
Endpunkt mit eigenem Guard (`trigger-elevenlabs-sync` → `requirePromptSyncCaller`).

Zwei Altlasten bleiben: `ai-generate.js` baut die Admin-Prüfung **von Hand nach**, statt
`require-admin` zu nutzen (zweite Auth-Generation), und `admin-invoice-qr-pdf-preview.js`
ist ungeschützt — aber toter Code (siehe 5.3).

**Das ist das Zielbild.** Die Frage für das Frontend lautet: *Wie kommt die Klarheit von
`require-admin.js` in die Oberfläche?*

---

## 4. Dimension 1 — Bedienung

### 4.1 Screen-Inventar (im Browser gemessen)

| Screen | Route | sichtbare Bedienelemente | Reiter | Höhe |
|---|---|---|---|---|
| Cockpit | `overview` | 6 | – | 475 px |
| Sales | `offers` | 47 (12 Knöpfe, 27 Felder) | 2 | 2'999 px |
| Kunden | `customers` | 28 | – | 1'279 px |
| Onboarding | `onboarding` | 13 | – | 1'134 px |
| Billing | `billing-finance` | 4 + 33 im Reiter „Alle Rechnungen" | 4 | 374–1'050 px |
| Assistenten | `ai-setup` | 4 | 4 | 322 px |
| Insights | `insights` | **0** | – | 1'264 px |
| Einstellungen | `settings` | 56 (9 Knöpfe, **47 Felder**) | – | **3'054 px** |

Nicht in der Navigation, aber als Route vorhanden: `cases`, `activity`, `contracts`,
`customer-workspace`.

### 4.2 Der schärfste Bedienbefund: der Kunden-Workspace verdoppelt sich

Ich habe jeden sichtbaren Knopf im Kunden-Workspace gedrückt und protokolliert, wo er landet.
**9 Knöpfe, 5 Ziele — vier exakte Doppelungen:**

| Knopf oben (Kopfzeile) | Knopf unten (in der Karte) | landet bei |
|---|---|---|
| **Kundendaten** | **Bearbeiten** | `edit-customer-modal` |
| **AI Wizard** | **AI bearbeiten** | derselbe Dialog |
| **Rechnungen** | **Rechnungsübersicht** | Route `billing-finance` |
| **Verträge** | **Vertragsübersicht** | Route `offers` |

Zwei Beobachtungen dazu:

- **Der Knopf „Verträge" landet auf einem Screen mit dem Titel „Sales".** Der Kontextwechsel
  ist nicht nur ein Sprung, er ist auch unbeschriftet.
- Alles, was mit Geld zu tun hat, **verlässt den Kundenkontext**. Rechnung ansehen heisst:
  Workspace verlassen → Billing → Filter setzen lassen → zurücknavigieren.

**Ursache (Fakt, `admin-runtime-navigation.js:224-241`):** `renderCustomerWorkspace()` in
`index.html` baut die Karten. Danach greift `patchWorkspace()` ein und

- sucht den Knopf, dessen **Text exakt „Details" ist**, benennt ihn in „Kundendaten" um und
  hängt einen neuen Handler dran,
- ergänzt zwei neue Knöpfe „Rechnungen"/„Verträge",
- greift die Knöpfe der Billing-Karte **über ihren Index** (`btns[0]`, `btns[1]`) und benennt
  sie in „Rechnungsübersicht"/„Vertragsübersicht" um — mit **denselben** Zielfunktionen
  `invoices(id)` / `customerContracts(id)`.

Beschriftungssuche per Textvergleich und Handler-Zuweisung per Positionsindex: Wer in
`index.html` die Reihenfolge zweier Knöpfe tauscht, vertauscht stillschweigend zwei Handler.

### 4.3 Drei Navigationen, drei Landkarten

| Navigation | Einträge | sichtbar |
|---|---|---|
| Seitenleiste Desktop | 9 (8 im HTML + „Cases & Support" per Patch ergänzt) | ab 769 px |
| Untere Leiste Mobile | 5 (Cockpit, Sales, Kunden, Onboarding, Mehr) | bis 768 px |
| „Mehr"-Schublade Mobile | 7 (Billing, Assistenten, Cases, **Verträge**, Insights, **Aktivität**, Einstellungen) | bis 768 px |

**Ergebnis (Fakt):** „Verträge" und „Aktivität" sind **auf dem Handy erreichbar, auf dem
Desktop nicht**. Wer am Schreibtisch sitzt, kommt an die Aktivitäts-Übersicht nur über die
URL. Das ist kein Mobile-Detail — es ist eine unterschiedliche Produktdefinition je
Bildschirmbreite.

### 4.4 Einstellungen: 3'054 px, 47 Felder, ein Speichern-Knopf pro Block

Die Plan-Konfiguration zeigt **vier Pakete nebeneinander mit je ~12 Feldern** — Name,
Sortierung, Monats-/Jahrespreis, Setup Fee, Inklusivminuten, Zusatz pro Minute,
Kurzbeschreibung, Headline, Features-Textfeld. Alles gleichzeitig editierbar, ein
gemeinsamer „Speichern"-Knopf. Ein Tippfehler in Paket 3 ist beim Speichern von Paket 1
nicht zu erkennen.

Direkt darüber: die Admin-Verwaltung mit drei Zeilen, wobei die Spalte „Erstellt" ein
Status-Chip enthält und die Spalte „Rolle" ein Auswahlfeld — Anzeige und Bearbeitung im
selben Raster ohne Speichern-Kennzeichnung.

### 4.5 Kunde anlegen

**2 Klicks, 12 Felder, davon 9 Pflicht:** Firma, E-Mail, Vorname, Nachname, Telefon, Plan,
Abrechnungszyklus, Strasse, PLZ, Ort, Land, Voxera-Nummer. Zwei weitere Felder
(`create-customer-start-date`, `create-customer-notes`) sind unsichtbar, werden aber von
JavaScript ausgelesen (Zeile 3483).

Das ist für sich in Ordnung. Es fällt nur im Kontrast auf: das Formular ist der schlankste
Teil des Portals, während der *Weg danach* — Assistent konfigurieren, Nummer zuweisen,
Freigabe, Zugang senden, aktivieren, live schalten — über fünf Screens und mindestens vier
Modals verteilt ist.

### 4.6 Feedback: drei Systeme parallel

| System | Vorkommen | Ton |
|---|---|---|
| `showToast()` | **111** | dunkle Pille, **ohne Tonalität** — Erfolg und Fehler sehen identisch aus |
| `voxAlert()` / `voxConfirm()` | 27 | gestalteter Dialog |
| natives `alert()` / `confirm()` | **44** | Browser-Kasten, kein Voxera-Design |

Der Toast ist bereits als eigener Punkt vermerkt (im Auftrag genannt). Neu ist hier: er ist
**nicht das einzige** offene Feedback-Thema. 44 native Browser-Dialoge sind der grössere
Bruch — sie erscheinen unter anderem beim Deaktivieren eines Admins, beim Offerten-Status
und beim Speichern.

---

## 5. Dimension 3 — Funktionsumfang

**Vorbemerkung:** Es gibt keine Nutzungsmessung. Nichts hier ist eine Einstufung, alles sind
**Kandidaten zur Diskussion**. Die Reihenfolge ist nach Belegstärke sortiert.

### 5.1 Belegt tot — läuft, ohne dass es je etwas tut

**Feature-Flags in den Einstellungen.** `state.featureFlags` enthält drei fest verdrahtete
Demo-Einträge („AI Escalation v2 — Pilot bei 3 Kunden", „Automatisierte Billing Mails —
Geplant für Q2", „Live Call Quality Scoring — Interner Canary"). Die Funktion `toggleFlag()`
(Zeile 14915) schaltet sie ON → OFF → PARTIAL. Gerendert wird in `#settings-feature-list` —
**einen versteckten Stub**. In Supabase existiert eine echte Tabelle `feature_flags` mit
15 Zeilen, die das Portal nie liest.

**Demo-Admins.** `state.admins` enthält „Lea Baumann", „Noah Keller", „Mia Vogel" mit
E-Mail-Adressen und Status. `toggleAdminStatus()` und der Handler an `#settings-add-admin`
(fügt „Neuer Admin 4" hinzu) arbeiten auf diesen Fantasiedaten. Die sichtbare Admin-Tabelle
liest daneben korrekt aus `admins`.

**Demo-AI-Konfigurationen.** `state.aiConfigs` ist mit fünf ausformulierten Beispielkunden
vorbelegt (Sanitär Zürich, Zahnarztpraxis Bern, Hotel Luzern, Apotheke Winterthur …),
inklusive Sätzen wie *„Sortimentswechsel noch nicht eingepflegt"*. Beim Datenladen wird das
Objekt überschrieben — bis dahin ist es aber der Fallback.

### 5.2 Screens, die zur Diskussion gehören

**`activity` — „Aktivität".** Fünf Karten („Letzte Anrufe", **„Recent Onboarding Actions"** —
unübersetzt, „Kundenänderungen", „Support-Aktivität", „System-Ereignisse"), **null
Bedienelemente**, kein Eintrag in der Desktop-Navigation. Ein reines Protokoll ohne Filter,
ohne Zeitraum, ohne Sprung ins Objekt.

**`insights` — „Insights".** 1'264 px, **null Bedienelemente**, fünf Tabellen. Enthält einen
Margen-Rechner mit fest verdrahteten Kostenannahmen (siehe 3.3, wo genau dieser Text auch
noch zerstört wird). Kein Zeitraumfilter, kein Export.

**`contracts` — eigene Route.** Vollständig dupliziert zum Sales-Reiter „Verträge" (3.6). Die
Route ist in keiner Desktop-Navigation, aber in der Mobile-„Mehr"-Schublade.

**Cockpit vs. Insights vs. Aktivität.** Drei Screens beantworten „wie steht es gerade?".
Cockpit hat 6 Knöpfe und ist der einzige, der zum Handeln führt.

### 5.3 Toter Code im Auslieferungsstand

| Datei | Grösse | Beleg |
|---|---|---|
| `shared/admin-runtime-qr-invoice-controls.js` | 8.7 KB | liegt im Verzeichnis, steht **nicht** in der Ladeliste von `offer-brand.js` |
| `netlify/functions/send-offer.js` | — | **null** Referenzen im gesamten Repo; ersetzt durch `mail-dispatch` mit `mail_type:'offer_email'` |
| `netlify/functions/offer-link-customer.js` | 372 Zeilen | nur in einem SQL-Kommentar erwähnt |
| `netlify/functions/admin-invoice-qr-pdf-preview.js` | — | null Referenzen, zusätzlich ohne Admin-Guard |
| `netlify/functions/activate-subscription.js` | — | nur von einem Prüfskript referenziert, nicht vom Produkt |
| `netlify/functions/_lib/swiss-qr-version.js` | — | null Referenzen |
| `netlify/functions/delete-customer.js` | — | absichtlicher Grabstein, antwortet immer HTTP 410 |

Dazu drei Generationen QR-Rechnung nebeneinander: `swiss-qr-bill.js` (327 Z.),
`swiss-qr-bill-complete.js` (114 Z.), `swiss-qr-bill-branded.js` (91 Z.) — alle drei geladen,
mit Aufrufketten kreuz und quer.

Und im `docs/`-Verzeichnis liegen `swiss-qr-done.txt`, `swiss-qr-final.txt`,
`swiss-qr-last.txt`, `swiss-qr-stop.txt` — offenbar versehentlich eingecheckte Artefakte.

*(Hinweis: Es läuft parallel ein Aufräum-Auftrag zu totem Code. Diese Liste ist bewusst nur
der Admin-Anteil — bitte vor dem Löschen abgleichen, damit nicht doppelt gearbeitet wird.)*

### 5.4 Datenmodell als Symptom

Die Tabellen, aus denen das Portal liest, sind sehr breit: **`customers` hat 123 Spalten**,
`invoices` 75, `offers` 57, `calls` 51, `contracts` 37, `plan_config` 27. Bei `customers`
liegen unter anderem `praxis_typ`, `spezialgebiet`, `sprechstunden_modus`,
`notfallnummer_lebensgefahr`, `notfall_service_name`, `kanton` — Spalten aus einer
Arztpraxis-Phase, die heute für jeden Kunden mitgeführt werden.

Das ist **kein Auftrag für diese Runde**, sondern ein Hinweis: Ein Teil der Formularlänge im
Portal ist eine direkte Abbildung dieser Schemabreite. Wer die Oberfläche kürzen will, wird
irgendwann hier landen.

---

## 6. Gewichtung — welche Dimension zuerst?

| Dimension | Gewicht | Begründung |
|---|---|---|
| **2 — Code-Struktur** | **hoch** | Ist Ursache, nicht Symptom. Die Patch-Architektur produziert die Bedienungsfehler laufend nach: der Weiss-auf-Weiss-Fehler, die doppelten Workspace-Knöpfe, der zerstörte Preistext, die doppelte Vertragstabelle sind **alle vier** Kollisionen zwischen Patches. Solange sie bleibt, kostet jede UX-Verbesserung doppelt: einmal bauen, einmal gegen die Patches verteidigen. |
| **3 — Funktionsumfang** | **mittel, aber zuerst nützlich** | Alleine wenig Wirkung — aber jede gestrichene Fläche muss nicht migriert werden. Deshalb *vor* Dimension 2 als Schnitt, nicht danach. |
| **1 — Bedienung** | **hoch im Ergebnis, niedrig als Startpunkt** | Die Befunde sind real und ärgerlich. Aber die meisten sind Folgeschäden. Wer sie zuerst angeht, patcht Patches. |

**Eine wichtige Einschränkung zur Ehrlichkeit:** Nicht alles in Dimension 1 ist Folge von
Dimension 2. Die 3'054-px-Einstellungsseite, die drei „wie steht es gerade"-Screens und der
Kontextwechsel aus dem Workspace in die Billing-Route sind **echte Entwurfsfragen**. Die löst
kein Refactoring. Sie brauchen eine Entscheidung darüber, was das Portal sein soll.

---

## 7. Vorschlag: Zielbild und erste Welle

### 7.1 Zielbild in einem Satz

**Ein Admin-Portal, das aus lesbaren Quellen besteht statt aus einer Quelle plus 29
Korrekturen** — mit einer Kartenkopfzeile, einem Feedback-System, einer Navigation, und mit
derselben Klarheit in der Oberfläche, die `_lib/require-admin.js` im Backend schon hat.

### 7.2 Erste Welle — priorisiert

**W0 — Sofort, unabhängig von allem (Stunden, kein Umbau)**

| # | Was | Warum jetzt |
|---|---|---|
| W0.1 | Weiss-auf-Weiss an der Wurzel beheben: `applyDarkHeaderContrast` entfernen, `.card-head` **eine** Farbrolle geben, `admin-runtime-v3-regression-fix.js` als dann überflüssig prüfen | 30 unsichtbare Überschriften. Kein Zielbild nötig, um zu wissen, dass Text lesbar sein muss. |
| W0.2 | Preistext-Zerstörung stoppen: die globale Textersetzung in `invoice-only-ch.js` auf gezielte Elemente eingrenzen statt auf alle Textknoten | Zeigt Kunden gegenüber falsche Zahlen an. |
| W0.3 | Toten Code entfernen (Liste 5.3), nach Abgleich mit dem Aufräum-Auftrag | Verkleinert alles Folgende. |
| W0.4 | Demo-Daten löschen: `state.featureFlags`, `state.admins`, `state.aiConfigs`-Vorbelegung samt der drei toten Handler | Fantasiedaten in einem Betriebswerkzeug. |

**W1 — Funktionsumfang klären (braucht deine Entscheidung, kein Code)**

| # | Frage |
|---|---|
| W1.1 | `activity`, `insights`, `contracts` als eigene Screens — behalten, in Cockpit/Sales aufgehen lassen, oder streichen? |
| W1.2 | Feature-Flags — echte Tabelle anbinden oder Fläche ersatzlos streichen? |
| W1.3 | Plan-Konfiguration mit 47 Feldern — gehört sie ins Portal oder ist sie ein seltener Eingriff, der ein eigenes, geführtes Formular verdient? |

**W2 — Strukturschnitt (der eigentliche Umbau, erst nach W1)**

| # | Was |
|---|---|
| W2.1 | Design-Token-Datei für Admin, analog `customer-design-tokens.css`. **Ein** `.card-head`, danach 16 injizierte Stylesheets nacheinander auflösen. Der Pass, den das Customer Dashboard schon hatte. |
| W2.2 | Patches nach Thema in `index.html` zurückführen und die Datei löschen — **nicht** alle 29 auf einmal. Reihenfolge nach Kollisionsdichte: `ui` + `design-system-v2` + `design-system-v3` + `v3-regression-fix` (die vier, die sich um die Kopfzeile streiten), dann die vier Cases-Skripte, dann die drei Plan-Input-Skripte. |
| W2.3 | Die sechsfache `callAdminFunction`-Kette in **einen** Aufrufpfad mit einer Fehlerbehandlung zusammenführen. |
| W2.4 | Doppelte Vertragstabelle auflösen — eine Tabelle, kein `innerHTML`-Abgleich. |
| W2.5 | Kunden-Workspace: 9 Knöpfe → 5. Und die Frage beantworten, ob Rechnungen/Verträge im Workspace bleiben können, statt wegzuspringen. |
| W2.6 | Navigation vereinheitlichen: eine Routenliste, aus der beide Navigationen erzeugt werden. |

**Bewusst nicht in dieser Welle:** die 123 Spalten in `customers`, die Toast-Tonalität
(eigener Punkt), alles im Customer Dashboard, Make/Vorlagen/Szenario 09.

### 7.3 Eine Warnung vorweg

Beim Customer Dashboard hat sich zweimal gezeigt, was reine Quelltext-Prüfung kostet
(J5-Wochenraster, Onboarding-Karte). Der Weiss-auf-Weiss-Fehler hier ist derselbe Typ: **im
Code ist er unsichtbar**, beide beteiligten Regeln sehen für sich korrekt aus. Er wurde erst
sichtbar, als die Seite tatsächlich gerendert wurde.

Empfehlung: Der Klick-Aufbau aus dieser Diagnose (Chromium + Supabase-Stub, siehe Abschnitt 1)
sollte für die Umbauwelle erhalten bleiben — als Abnahme nach jedem Schritt, nicht als
einmalige Übung.

---

## 8. Offene Fragen an dich

1. **Reihenfolge:** Ist W0 (die vier Sofortpunkte) als eigener, kleiner PR in Ordnung — noch
   bevor wir das Zielbild ausdiskutieren? Ich würde das empfehlen; die vier Punkte sind
   unabhängig von jeder Zielbild-Entscheidung.
2. **W1.1** — welche der drei Screens (`activity`, `insights`, `contracts`) benutzt du
   tatsächlich? Das ist die einzige Frage, die ich nicht selbst beantworten kann und die den
   Zuschnitt am stärksten verändert.
3. **Umbautiefe:** Soll Ziel „alle 29 Patches auflösen" sein, oder „die kollidierenden
   auflösen und den Rest stehen lassen"? Ersteres ist sauberer, deutlich grösser und braucht
   mehrere Wochen in kleinen Schritten.
4. **Abgrenzung Aufräum-Auftrag:** Die Liste in 5.3 überschneidet sich mit dem laufenden
   Aufräum-Auftrag. Soll ich sie dort einspeisen oder als Admin-Teil separat halten?

---

## 9. Was in dieser Runde bewusst nicht getan wurde

Kein Code geändert, nichts gelöscht, kein Patch angefasst. Diese Datei ist das einzige
Ergebnis. Der Klick-Aufbau lief lokal gegen einen Stub — die Produktionsdatenbank wurde nur
für Spaltennamen gelesen, keine Kundendaten.

**Nebenbefund ausserhalb des Auftrags, zur Kenntnis:** Auf dem Staging-Projekt
(`voxera-staging`, angelegt 08.08.) hat die Tabelle `customers_notification_backup_20260809`
RLS deaktiviert — dieselbe Konstruktion, die auf Produktion als P0 geschlossen wurde. Sie ist
dort leer (0 Zeilen). Gehört in den Sicherheits-Strang, nicht hierher, soll aber nicht
untergehen.
