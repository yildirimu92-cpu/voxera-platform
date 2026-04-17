# VOXERA – Customer Dashboard Readiness Report

## 1. Scope
Bewerteter Stand: aktueller Repository-Stand im Customer-Dashboard inkl. Frontend-Flow und zugehöriger Netlify Functions.

**In Scope (geprüft):**
- `customer-dashboard/index.html` (Dashboard-UI, KPI/Overview, Tasks, Reachability-/Activation-/Recovery-Flow, Contract-Gating, Reload/Realtime-Mechanik).
- Netlify Functions für Dashboard-Operationen:
  - `cases-create.js`, `cases-update.js`
  - `call-update-status.js`, `call-save-followup.js`
  - `customer-update-settings.js`, `customer-contract-state.js`
  - `activation-start-system-test-call.js`, `call-intake-webhook.js`
  - `_lib/require-customer.js`, `_lib/contract-state.js`, `_lib/manual-task-model.js`, `_lib/status-model.js`, `_lib/customer-entitlement.js`
- Zuletzt bearbeitete Bereiche laut Git-Historie (u. a. Activation Sync/Recovery, Realtime-Updates, Reachability Test-Reset, Contract Gate, Plan/Contract-Fallbacks).

## 2. Executive Summary
**Reifegrad:** **Soft-launch / Pilot-launch ready**.

**Warum nicht „voll launch-ready“:**
- Kernelemente (Contract-Gate, Task-Flows, Activation inkl. Reset/Recovery, KPI/Overview, Realtime+Polling-Fallback) sind im Code konsistent umgesetzt.
- Es bestehen jedoch noch klar erkennbare Rest-Risiken für breiten Rollout (v. a. E2E-Realtime-/Telephony-Verifikation, externe CDN-Abhängigkeiten, technische Inkonsistenzen in Statusmodell-Implementierung).

**Stärken (aktuell belastbar):**
- Entitlement-/Contract-Guard ist durchgängig verankert (Frontend-Gating + serverseitiger Guard).
- Manual-Task-Create/Edit/Status-Update ist validiert und mit klaren Fehlermeldungen abgesichert.
- Activation/Reachability enthält explizite Pending-Test-, Deactivation- und Recovery-Mechaniken inkl. Polling-Resumption nach Reload.
- Dashboard bietet klare KPI- und Priorisierungsdarstellung („Priorität jetzt“, Aufgaben/KPI-Verlinkung, Mobile/Desktop-Navigation konsistent).

**Restrisiken:**
- Kritische Realtime-/Telephony-Kette ist robust vorbereitet, aber weiterhin separat end-to-end zu verifizieren.
- Externe Script-CDNs bleiben ein Verfügbarkeits-/Supply-Risk.
- Einzelne Architektur-Drifts (dupliziertes/abweichendes Statusmodell in `call-save-followup`) erhöhen Regressionsrisiko.

## 3. Was als verifiziert / stabil gilt
Nur Punkte, die vom aktuellen Code/Fixstand getragen werden:

1. **Contract-/Entitlement-Logik ist aktiv und mehrstufig abgesichert**
   - Serverseitig: `requireCustomerCaller` prüft Token, Customer-Kontext und aktive Vertragslage (je Function konfigurierbar).
   - Frontend-seitig: inaktiv bekannter Vertrag blockiert Reachability-/Settings-/Task-Aktionen inkl. sichtbarer Banner-/Disable-States.
   - Separater Contract-State-Resolver liefert angereicherte kommerzielle Vertragswerte (Preis/Minuten/Overage) als Source für Plan-/Usage-Anzeige.

2. **Manual Task / Cases Flows (Create/Edit/Status) sind funktional ausgebaut**
   - Create/Update laufen über `cases-create`/`cases-update` mit Feld-Validierung (Titel/Due Date/Due Time/Status/Priority/Type), Schema-/Constraint-Fehlerbehandlung und verständlichen Benutzerfehlern.
   - Status-Transitions bei Cases sind explizit erlaubt/verboten modelliert (Transition-Guard vorhanden).
   - UI-Flow für „Neue Aufgabe“/Edit-Modal inkl. Contract-Gate, Input-Validierung und Re-Render ist konsistent.

3. **Tasks Done-/Complete-Flow ist implementiert und auf Backend-Funktionen umgestellt**
   - Call-Änderungen laufen über Function-Calls (`call-save-followup`, `call-update-status`) statt direkter Frontend-Mutation.
   - Status-Übergänge sind in beiden Flows abgesichert; Sequenz-Handling für mehrstufige Übergänge ist vorhanden.

4. **Reachability / Aktivierung / Deaktivierung ist operativ abgebildet**
   - `pending_test`-Lifecycle wird persistiert, UI-seitig gerendert und per Polling/Detection begleitet.
   - Änderungen an Device/Mode während `pending_test` triggern gezielten Reset des Testkontexts.
   - Deaktivierungsflow setzt Forwarding- und Activation-Felder kontrolliert zurück.

5. **Recovery / Reload / Resume-Logik ist vorhanden**
   - Realtime Channel auf `calls`/`cases`/`customers` + Debounced Reload.
   - Polling-Fallback bleibt aktiv bei Channel-Degradation.
   - Nach Reload wird `pending_test`-Detection fortgesetzt bzw. Polling reaktiviert.

6. **Dashboard KPI / Overview / Priorisierung ist stabil integriert**
   - KPI-Kacheln sind interaktiv mit klarer Navigation in die jeweiligen Arbeitsbereiche.
   - „Priorität jetzt“ und Aufgaben-/Überfälligkeitskontext sind im Overview verankert.

7. **UI-/Brand-Konsistenz ist auf gutem Niveau**
   - Brand Tokens, einheitliche Button-Hierarchie, Mobile- und Desktop-Navigation sind konsistent umgesetzt.
   - Activation-V2-Flows sind visuell integriert statt separater Stilinsel.

8. **Zuletzt bearbeitete Bereiche (Git-Historie, aktuelle Relevanz)**
   - Activation state sync, direct-dial CTA styling.
   - Dashboard live updates + activation recovery.
   - Reachability test-call reset/recovery.
   - Contract gate flicker / contract-SOT fallback / plan_config Upgrade-Bindung.

## 4. Was noch offen / minor / zu beobachten ist

### A) Echte Launch-Blocker
- **Aktuell kein harter Code-Blocker** für Pilotbetrieb erkennbar.

### B) High Priority (nicht Blocker)
1. **Realtime-/Telephony-E2E final verifizieren**
   - Technische Bausteine vorhanden (Webhook-Ingest, Activation-System-Call, Pending-Session-Guard, Polling/Detection), aber produktionsnahe End-to-End-Verifikation (Twilio + Webhook + Dashboard-UI + Statuspersistenz) muss als Abschlusscheck gefahren werden.

2. **Statusmodell-Konsolidierung bei Call-Updates**
   - `call-update-status` nutzt `_lib/status-model`, `call-save-followup` enthält eigenes inline Statusmodell inkl. zusätzlichem `archived`-Pfad.
   - Funktional aktuell nutzbar, aber erhöhte Drift-/Regressionswahrscheinlichkeit.

### C) Minor Issues / Beobachtung
1. **Externe CDN-Abhängigkeiten im kritischen UI-Load-Pfad**
   - Supabase SDK, Lucide und QRCode werden extern via CDN geladen.
   - Risiko: Third-Party-Verfügbarkeit / Policy / CSP / Supply-Chain.

2. **Konfigurationssignal im Frontend**
   - Inline-Kommentar am Supabase-Key signalisiert offenen Austauschbedarf („TODO … Unregistered API key“).
   - Kein akuter Funktionsbruch im Code selbst, aber operationsseitig unsauber für Final Launch.

3. **Fallback-Pfade für ältere Umgebungen weiter aktiv**
   - Contract-Meta fällt bei Function-Fehler auf direkten Read zurück.
   - Gut für Robustheit, erhöht aber Komplexität und kann unterschiedliche Laufzeitpfade produzieren.

### D) Späterer Cleanup
- Redundante/legacy-nahe Pfade und Debug-Logs im Activation-/Contract-/Fallback-Bereich reduzieren.
- Optional: zentrale Statusmodell-Quelle für alle Call-bezogenen Functions durchziehen.

## 5. Technische Risiken / Architektur-Risiken
1. **State-Sync zwischen Frontend und serverseitigen Resolvern bleibt sensibel**
   - Besonders rund um Activation (`pending_test`, candidate call, session guards, poller state).

2. **Race-/Order-Risiko bei asynchronen Events**
   - Gleichzeitige Realtime-Events, Polling-Zyklen und manuelle User-Aktionen können in Randfällen konkurrieren (insb. Teststart/Reload/Statuswechsel).

3. **Eng gekoppelte Vertrags-/UI-Access-Pfade**
   - Contract-State steuert sowohl UI-Freischaltung als auch Function-Zugriff; fachlich korrekt, aber regressionsanfällig bei Teiländerungen.

4. **Implementierungs-Drift im Statusmodell**
   - Unterschiedliche Transition-Logik in Call-Functions erhöht Wartungs- und Regressionsrisiko.

5. **Abhängigkeit von externen Diensten**
   - CDN-Ressourcen + Telephony-Provider-Verfügbarkeit wirken direkt auf UX und Aktivierungsfluss.

## 6. Launch-Einschätzung
**Bewertung: _Soft-launch / Pilot-launch ready_.**

**Begründung (kurz):**
- Der produktive Kern des Customer Dashboards ist erkennbar stabilisiert und konsistent abgesichert (Contract, Tasks, Activation, Reload/Recovery, KPI).
- Für breiten/finalen Rollout sollten vorab noch die High-Priority-Restpunkte (E2E-Telephony/Realtime und Statusmodell-Konsolidierung) geschlossen bzw. formell verifiziert werden.

## 7. Empfohlene Restarbeiten vor finalem Launch

### P1
- **End-to-end Betriebsabnahme Activation/Realtime-Call-Flow**
  - Testmatrix: Start pending_test → system test call → webhook intake → candidate detection → UI success/activation persist → reload/reconnect recovery.

### P2
- **Statusmodell harmonisieren**
  - `call-save-followup` auf gemeinsame `_lib/status-model`-Quelle bringen (inkl. klarer Entscheidung zu `archived`).

### P3
- **Launch-Härtung der Runtime-Abhängigkeiten**
  - CDN-Strategie (Pinning/SRI/Self-hosting) und Konfigurationsbereinigung (Supabase key handling/TODO-Kommentar) finalisieren.

## 8. Übergabe an das Admin Portal
**Abschlussniveau Customer Dashboard:**
- **Pilotfähig und funktional weitgehend abgeschlossen**, mit klar benannten technischen Restpunkten statt fachlicher Kernlücken.

**Was bewusst NICHT ins Admin Portal hineingezogen werden sollte:**
- Customer-Dashboard-spezifische Flow-Polish-Themen (Activation-Randfälle, CDN-Härtung, Statusmodell-Konsolidierung) sollten als eigener Abschluss-Track behandelt werden.

**Warum jetzt separater Admin-Portal-Audit sinnvoll ist:**
- Der Customer-Bereich ist ausreichend stabil, um Scope-Creep zu vermeiden.
- Ein getrenntes Admin-Audit ermöglicht klare Verantwortlichkeiten, eigene Risikoanalyse und saubere Launch-Boards pro Produktfläche.

## Empfohlene nächste Aktion
**Direkt als Nächstes: _Admin Portal Audit + Readiness Gap List_ starten.**

**Begründung:**
- Der Customer-Dashboard-Stand ist für Pilotbetrieb tragfähig; offene Punkte sind bekannt und begrenzt.
- Ein strukturierter Admin-Portal-Audit verhindert Vermischung der Restarbeiten, schafft priorisierte Gap-Liste (P1/P2/P3) und ermöglicht ein belastbares, separates Launch Board für das nächste Modul.
