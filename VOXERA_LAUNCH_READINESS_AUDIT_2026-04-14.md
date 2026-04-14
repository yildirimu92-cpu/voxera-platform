# VOXERA – Launch Readiness Audit (Customer Dashboard)

Datum: 2026-04-14  
Scope: Code- und Flow-Audit auf Basis des Repos (kein Live-Systemtest, keine Produktionsdaten-Validierung)

---

## A. Executive Summary

### Aktueller Reifegrad
Das Customer Dashboard ist **deutlich reifer** als frühe Stände (Navigationsmodell, Activation-V2-Struktur, defensive Guards gegen Doppeltrigger, klare Kernbereiche). Trotzdem ist der Stand aus Launch-Sicht **nicht breit ausrollbar**.

### Wichtigste Stärken
- Navigation/URL-State ist strukturiert und Browser-Back-fähig für Main-Tabs umgesetzt.
- Aktivierungs-Testanruf besitzt serverseitige Guard-/Idempotenz-Mechaniken inkl. Pending-Session-Handling.
- KPI-Interaktion ist teilweise bereinigt (nur relevante Karten interaktiv, statische KPIs deaktiviert).
- Modal-/Mobile-Layout enthält dedizierte Sheet/Height-Regeln und Safe-Area-Handling.

### Wichtigste Risiken
- Aktivierung enthält weiterhin mehrere konkurrierende Render-/State-Pfade (Doppel-Render in `loadData`), was fragile Effekte begünstigt.
- Deaktivierungs-Primary-CTA ist semantisch irreführend: „Weiterleitung deaktivieren“ öffnet einen Guided-Flow statt unmittelbarer Deaktivierung.
- Follow-up/Notiz-Persistenz läuft weiterhin über Frontend-Patch + separaten Status-Transition-Call statt atomarem Backend-Command (Race-/Partial-Save-Risiko).
- QR-/Desktop→Smartphone-Handover hängt an externem QR-Service; ohne Fallback/Delivery-Garantie.

### Launch-Einschätzung
**Pilot only**

**Begründung:** Kerndomäne funktioniert grundsätzlich, aber Aktivierungs-/Deaktivierungs-Flow und Persistenzpfade sind noch nicht robust genug für breiten Rollout mit niedriger Support-Last.

---

## B. Was bereits stark verbessert wurde (belegbar)

1. **Navigation + Browser-Verhalten**
   - Main-Tabs werden auf URL (`?tab=`) und `history.state` gemappt; `popstate` wird aktiv behandelt.
   - Das ist produktiv relevant und reduziert Navigationsfriktion/State-Verlust.

2. **Aktivierungs-Idempotenz (Testanruf)**
   - Frontend besitzt In-Flight-Guards (`activationStartTriggerInFlight`, `activationSystemCallPending`).
   - Backend erzwingt Session-Guard (`pending:<hash>`), Pending-Status-Reuse, Existing-Outbound-Reuse und Rate-Limit.

3. **KPI-Entschlackung**
   - Nur „Neue Anfragen“/„Offene Aufgaben“ sind klickbar; „Erledigt heute“/„Aktivität“ sind statisch markiert.

4. **Responsive/Modal-Basis**
   - Mobile Modal-Sheets mit `100dvh`-basierten Grenzen, Action-Wrapping, Safe-Area-Footer.

5. **Settings/Activation-Backend-Contract**
   - `customer-update-settings` validiert Whitelist-Felder, Status-Enums und liefert explizite Schema-Fehlercodes.

---

## C. Launch-Blocker (vor breitem Launch zwingend schließen)

### 1) Aktivierung: nicht deterministische Render-/State-Kette
- **Bereich/Flow:** Aktivierung (Start, Pending-Test, Confirm)
- **Auswirkung:** inkonsistente UI-Stände, potenziell doppelte Zustandswechsel, schwer reproduzierbare Supportfälle
- **Ursache:** `loadData()` ruft `renderActivationV2()` **und** `safeMountActivationV2()` (das intern wieder rendert) im selben Zyklus.
- **Schweregrad:** Hoch
- **Nächste Maßnahme:** einen einzigen Render-Entrypoint definieren; `safeMountActivationV2` oder Direkt-Render entfernen, Side-Effects zentralisieren.

### 2) Deaktivierungs-CTA widerspricht Nutzererwartung
- **Bereich/Flow:** Aktiv-Status „Weiterleitung deaktivieren“
- **Auswirkung:** Vertrauensverlust; Nutzer erwartet direkte Wirkung, bekommt aber einen mehrstufigen Reset-/Guided-Flow
- **Ursache:** Button-Action `open-guided-reset` statt unmittelbarer Deaktivierungsoperation
- **Schweregrad:** Hoch (Produkt-/Trust-Risiko)
- **Nächste Maßnahme:** CTA umbenennen („Deaktivierungsassistent öffnen“) oder direkte Deaktivierung + sekundärer Assistenzpfad.

### 3) Aufgaben/Notizen: nicht atomare Persistenz
- **Bereich/Flow:** Follow-up/Notiz speichern
- **Auswirkung:** Teilweise gespeicherte Daten (Notiz ja, Status nein / umgekehrt), Supportaufwand und „Save fühlt unzuverlässig“
- **Ursache:** Frontend-sequenzielle Writes (`apiPatchOptional` + danach `applyStatusTransition`) statt serverseitig atomarem Command
- **Schweregrad:** Hoch
- **Nächste Maßnahme:** ein Backend-Endpunkt „save-followup-and-transition“ mit transaktionaler Semantik und eindeutiger Response.

### 4) Smartphone-Handover/QR ist extern abhängig
- **Bereich/Flow:** Desktop→Smartphone Aktivierung
- **Auswirkung:** Flow-Abbruch bei externem QR-Provider-Ausfall; nicht kontrollierbarer kritischer Pfad
- **Ursache:** QR-Bild wird über `api.qrserver.com` gerendert, kein lokaler Fallback
- **Schweregrad:** Mittel-Hoch
- **Nächste Maßnahme:** internen QR-Generator/Fallback einbauen; bei Fehler klarer alternativer Hand-off (Copy + short link).

### 5) Activation/Help-Flows weiterhin überlappend
- **Bereich/Flow:** Deaktivierung/Forwarding-Hilfe
- **Auswirkung:** Nutzer springt zwischen Guidance und Execution, Kontextverlust
- **Ursache:** Activation-Actions öffnen Hilfe/Inline-Hilfe, Help enthält gleichzeitig ausführende Controls
- **Schweregrad:** Mittel-Hoch
- **Nächste Maßnahme:** Execution strikt im Activation-Flow bündeln; Help read-only oder explizit als „externer Pfad“ kennzeichnen.

---

## D. High Priority vor Launch (nicht absolut blocker, aber sehr empfohlen)

1. **Copy/Toast-Konsistenz**
   - `copyForwardingCode` setzt primär Button-Text auf „Kopiert“, aber kein konsistentes globales Toast-Erfolgssignal.
   - Empfehlung: einheitliches Feedbackmuster (Toast + Screenreader-Region), damit „Code kopieren“ immer eindeutig bestätigt.

2. **Modal-Qualität auf kleinen Geräten verifizieren**
   - CSS ist verbessert; dennoch bleiben historische Risikoindikatoren („Anruf nachbearbeiten“/„Follow-up geplant“ Overflow) bis zu einem echten Device-Regressionstest offen.

3. **Aktivierungs-Statusinvarianten serverseitig härten**
   - `active` sollte konsistent bestätigte Device/Mode-Snapshots verlangen (falls fachlich verpflichtend).

4. **Back-Navigation E2E testen**
   - Codepfad ist vorhanden; dennoch sollten echte Szenarien (deep link, login redirect, setup-finished) scripted getestet werden.

---

## E. Kann nach Launch folgen

1. KPI-Feinschliff (Visualisierung „Aktivität“, zusätzliche Kontextinfos).  
2. Micro-UX (Tap-Feedback, Animation-Polish, kleine Typografie-/Spacing-Kanten).  
3. Erweiterte Hilfeseiten/Guided Content für Sonderfälle je Anbieter/Telefonanlage.

---

## F. Regression Risks

1. **Activation-Render-Regressionen**
   - Doppeltes Rendering/Mounting im Datenladezyklus bleibt ein Hotspot für „früher gefixt, jetzt wieder da“.

2. **Frontend-only Flow-Fixes**
   - Viele kritische Pfade werden clientseitig orchestriert; ohne atomare Backend-Kommandos entstehen fragile Zwischenzustände.

3. **Deaktivierungslogik ist besonders sensibel**
   - Mehrere Pfade: `activationDeactivateFast`, Guided Deactivation, Internal Reset.
   - Hohe Gefahr widersprüchlicher User-Mental-Models.

4. **Responsive/Mobile-Risiko bleibt hoch ohne Geräte-Matrix-Tests**
   - CSS wirkt strukturell besser, aber visuelle Bugs (Modal-Overflow, Keyboard/viewport Interaktionen) lassen sich aus Code allein nicht final freigeben.

---

## G. Empfohlener nächster Sprint (Launch-Fokus, Reihenfolge)

1. **Activation Render Unification**: ein einziger Render-Entry, klare Lifecycle-Reihenfolge.  
2. **Deactivation CTA Reframe**: Label + Action-Semantik korrigieren, direkte Erwartung erfüllen.  
3. **Atomic Follow-up API**: Notiz/Next Action/Follow-up/Status in einem serverseitigen Command.  
4. **Execution vs Help trennen**: Help read-only default, Execution nur in Activation.  
5. **QR Fallback implementieren**: interner Generator oder robuste Alternative ohne externen SPOF.  
6. **Activation state invariants** serverseitig erzwingen (mind. `pending_test`/`active` Konsistenzregeln).  
7. **E2E Regression Suite (kritische Flows)**: Aktivieren, Deaktivieren, Notiz speichern, Follow-up speichern, Back/Forward Navigation.  
8. **Mobile QA Sprint** auf realen Geräten (iOS Safari, Android Chrome; Small/Medium screens).  
9. **Telemetry/Support hooks**: Fehlercodes + UX-Events für Save fail, activation retry, deactivation abort.  
10. **Launch-Go/No-Go Recheck** mit Pilotdaten nach Sprint-Abschluss.

---

## Bewertungsmatrix (kurz)

- **Vertrauen:** Mittel (stark verbessert, aber Deaktivierungs-Semantik problematisch)
- **Klarheit:** Mittel (Activation/Help-Überlappung reduziert Klarheit)
- **Bedienbarkeit:** Mittel bis gut (Core-Navigation gut, einzelne kritische Flows uneindeutig)
- **Mobile-Tauglichkeit:** Mittel (CSS-Basis gut, Runtime-Validierung fehlt)
- **Reifegrad:** Mittel
- **Konsistenz:** Mittel
- **Support-Risiko:** Mittel-Hoch
- **Launch-Risiko (breit):** Hoch

## Finales Urteil

**Pilot only** – mit klarer Exit-Liste (oben C + priorisierte Teile aus D/G). Für **breiten Launch** fehlen derzeit belastbare Garantien bei Aktivierungs-/Deaktivierungs-Determinismus und atomarer Aufgabenpersistenz.
