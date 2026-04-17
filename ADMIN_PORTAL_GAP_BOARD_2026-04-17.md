# VOXERA – Admin Portal Gap Board

## 1. Zielzustand
Vor Pilotbetrieb muss das Admin Portal als **operatives Steuerzentrum** zuverlässig funktionieren: Admin-Zugänge sicher verwalten, Kunden-/Case-Bearbeitung stabil ausführen, und alle kommerziellen Zustände (Contract/Billing/Subscription/Onboarding) aus einer serverseitig durchgesetzten Source of Truth mutieren.

Operativer Mindeststandard für Pilot:
- **Keine privilegierte Logik im Client** (keine Service-Keys, keine kritischen Mutationen nur im Frontend).
- **Einheitliche Datenrealität** zwischen Admin Portal und Customer Dashboard (kein Split-Brain Airtable vs. Supabase).
- **Serverseitig erzwungene Rollen- und Lifecycle-Logik** für Admins, Kundenstatus, Verträge und Billing.
- **Revisionsfähige Persistenz** für operative Kernobjekte (insbesondere Contracts/Commercial State, Cases, Statuswechsel).
- **Nachvollziehbare E2E-Call-Persistenz** inkl. Idempotenz/Retry-Verhalten.

## 2. P1 – vor Pilot zwingend

### P1.1 Privilegierte Admin-Mutationen vollständig serverseitig kapseln (Service-Key Exposure entfernen)
**Warum kritisch**
- Aktuell ist der Supabase Service-Role-Key clientseitig exponiert; damit ist ein RLS-Bypass praktisch möglich und das Portal nicht pilotfähig.

**Betroffene Bereiche**
- `admin-panel/index.html` (Supabase-Initialisierung/privilegierte Mutationspfade)
- `admin-panel/netlify/functions/*` (bestehende Server-Funktionen als Zielkanal)
- Auth-/RBAC-Flow `admins`-Tabelle

**Konkreter Soll-Zustand**
- Alle privilegierten Admin-Aktionen (User/Role/Contract/Billing-relevante Mutationen) laufen ausschließlich über serverseitige Endpunkte mit Service-Role-Key im Backend.
- Frontend nutzt nur anon-key + signierte Session; keine direkterhöhten Rechte im Browser.

**Empfohlene Umsetzung**
- Service-Key-Verwendung aus `index.html` entfernen.
- Bestehende Netlify Functions (`create-customer.js`, `delete-customer.js`) als Muster erweitern für weitere kritische Mutationen.
- Secrets rotieren und Deployment-Umgebung verifizieren.
- Serverseitige Capability-Prüfung pro Endpoint (nicht nur UI-Tab-Sperren).

**Akzeptanzkriterien**
- Kein Service-Role-Key mehr im ausgelieferten Frontend-Bundle.
- Alle privilegierten Schreibaktionen schlagen ohne gültige Admin-Capability serverseitig fehl.
- Key-Rotation durchgeführt und dokumentiert.

**Risiko bei Nicht-Umsetzung**
- Kompromittierung des gesamten Datenbestands, manipulierbare Rollen/Verträge/Kundendaten, Pilotbetrieb nicht verantwortbar.

### P1.2 Source of Truth vereinheitlichen: Admin-Lese-/Schreibpfade von Airtable auf primäre DB konsolidieren
**Warum kritisch**
- Dashboard arbeitet auf Supabase, Admin teils auf Airtable; dadurch entstehen operative Inkonsistenzen und nicht verlässliche Kennzahlen.

**Betroffene Bereiche**
- Admin-Datenzugriffe in `admin-panel/index.html` (Kunden/Calls/Stats)
- Supabase-Tabellen `customers`, `calls`, `users`, `admins`
- E2E-Flow zwischen Admin-Ansicht und Dashboard-Ansicht

**Konkreter Soll-Zustand**
- Kunden-, Case-/Call- und Statistikdaten werden in beiden Oberflächen aus derselben primären Quelle gelesen und geschrieben.
- Airtable ist entweder vollständig abgelöst oder nur als expliziter, dokumentierter Downstream-Sync ohne operative Führungsrolle.

**Empfohlene Umsetzung**
- Read-Path zuerst migrieren (Admin-Listen/Details auf Supabase).
- Danach Write-Path migrieren (Mutationen nur gegen primäre Tabellen/API).
- Cross-surface Konsistenz-Checks als Pflicht-Regression (Admin vs Dashboard gleiche Stichprobe).

**Akzeptanzkriterien**
- Für Kunden und Calls existiert ein definierter Primärspeicher; Admin und Dashboard zeigen identische Datensätze.
- Kein operativ genutzter Airtable-Direktpfad mehr im Admin-Frontend.
- Abweichungsquote bei Stichprobenvergleich = 0 für definierte Testmenge.

**Risiko bei Nicht-Umsetzung**
- Falsche operative Entscheidungen, Support-Fehlzuordnungen, nicht belastbarer Pilotbetrieb.

### P1.3 Canonical Identity & Lifecycle: Invite/Contract/Subscription/Onboarding/Billing auf einen Schlüsselraum bringen
**Warum kritisch**
- Audit zeigt driftende Identitäten (`id`, `customer_id`, `dashboard_id`, Telefonnummer) und verteilte Lifecycle-Zustände; das bricht Zuordnung und Statuslogik.

**Betroffene Bereiche**
- Neukundenanlage (`create-customer`-Flow)
- `users.customer_id`, `customers.id`/`dashboard_id`
- Statuspfade in Admin-Portal (Invite, Vertrag, Aktivierung, Billing)

**Konkreter Soll-Zustand**
- Ein kanonischer Customer-Key (UUID) steuert alle Lifecycle-Phasen und Beziehungen.
- Statusmodell ist eindeutig: Invite → Contracted → Provisioned → Active → Suspended/Churned (Beispiel, final im Repo festlegen).
- Jeder Übergang ist serverseitig validiert und auditierbar.

**Empfohlene Umsetzung**
- FK-Regeln und Migrationsskript für `users.customer_id` auf canonical `customers.id`.
- Zentralen Lifecycle-Orchestrator als serverseitige Mutationsschicht (Function/API) einführen.
- Bestehende Fallback-Logik (z. B. dashboard_id/Telefon) auf kontrollierte Migration begrenzen.

**Akzeptanzkriterien**
- Alle neuen Kunden werden mit canonical ID angelegt; keine telefonnummernbasierten Primär-IDs.
- Statuswechsel sind nur über orchestrierte Server-Endpoints möglich.
- Für jeden Kunden ist Lifecycle-Zustand eindeutig und zwischen Admin/Dashboard konsistent.

**Risiko bei Nicht-Umsetzung**
- Fehlprovisionierung, falsche Kundenzuordnung, inkonsistente Vertrags-/Billing-Lage.

### P1.4 Admin User / Rollen / Provisioning serverseitig stabilisieren
**Warum kritisch**
- Admin-Rollenkontrolle ist laut Audit primär UI-basiert; zusätzlich ist `createAdminAccount()` blockiert. Damit fehlen belastbares Provisioning und harte Berechtigungsgrenzen.

**Betroffene Bereiche**
- Admin-Verwaltung in `admin-panel/index.html`
- Admin-Provisioning (`createAdminAccount()`-Pfad)
- Tabelle `admins` + serverseitige RBAC-Prüfungen

**Konkreter Soll-Zustand**
- Admin-Accounts werden über serverseitigen Provisioning-Flow erstellt/aktualisiert/deaktiviert.
- Rollenwechsel wirkt sofort auf API-Ebene (nicht nur visuell in Tabs/Buttons).
- Lifecycle für Admin-User (pending/active/disabled) ist dokumentiert und durchgesetzt.

**Empfohlene Umsetzung**
- `createAdminAccount()` durch Function-basierten Provisioning-Endpoint ersetzen/fixen.
- Jede Admin-Aktion erhält serverseitige Rollenprüfung (z. B. owner/admin/support capabilities).
- Deaktivierung/Reaktivierung mit Audit-Log (Actor, Zeit, vorher/nachher Rolle).

**Akzeptanzkriterien**
- Neuer Admin kann end-to-end serverseitig angelegt werden.
- Support-Rolle kann keine verbotenen Mutationen durchführen (API gibt 403).
- Rollenänderung greift ohne Neudeploy unmittelbar.

**Risiko bei Nicht-Umsetzung**
- Unklare Verantwortlichkeiten, missbrauchbare Admin-Aktionen, operative Blocker bei Team-Skalierung.

### P1.5 Contract / Billing / Commercial State zentral orchestrieren (kein localStorage, kein verteilter Frontend-Write)
**Warum kritisch**
- Verträge liegen aktuell lokal im Browser; kommerzielle Zustände sind damit nicht teamfähig, nicht revisionssicher und driftgefährdet.

**Betroffene Bereiche**
- Contract-Logik in `admin-panel/index.html` (inkl. Contract-Modal)
- Persistenzmodell für Plan/Vertrag/Billing-Status
- Übergaben an Dashboard/Abrechnung/Provisioning

**Konkreter Soll-Zustand**
- Contract- und Billing-relevante Mutationen laufen über eine zentrale serverseitige Kommandoschicht.
- Commercial State liegt persistent, versioniert und teamweit konsistent vor.
- UI zeigt nur serverseitig bestätigte Zustände.

**Empfohlene Umsetzung**
- `localStorage`-Vertragsmodell durch Datenbanktabellen + serverseitige API ersetzen.
- Command-orientierte Mutationen (z. B. `activate_contract`, `change_plan`, `suspend_service`) mit Validierungsregeln.
- Read-Model für Admin-UI (aktiver Plan, Vertragsbeginn/ende, Billing-Status, letzter Mutationszeitpunkt).

**Akzeptanzkriterien**
- Browserwechsel/Teamwechsel zeigt identischen Contract/Billing-Stand.
- Keine Contract/Billing-Mutation erfolgt mehr direkt im Client-State.
- Jede Änderung ist mit Actor + Timestamp nachvollziehbar.

**Risiko bei Nicht-Umsetzung**
- Umsatz-/Leistungsdifferenzen, Support-Eskalationen, fehlende Abrechnungsnachvollziehbarkeit.

### P1.6 Cases/operative Kundenarbeit schema- und umgebungsstabil machen
**Warum kritisch**
- Operative Case-/Call-Bearbeitung hängt an uneinheitlichen Feldern und Quellen; dadurch ist verlässliche tägliche Kundenarbeit nicht sichergestellt.

**Betroffene Bereiche**
- Case/Call-Listen und Detailansichten im Admin-Portal
- Felder rund um `calls`, Kundenreferenzen und Status
- Pipeline Make/Webhook → Persistenz → Admin/Dashboard-Sichtbarkeit

**Konkreter Soll-Zustand**
- Cases sind über ein stabiles, versioniertes Schema verfügbar (Pflichtfelder, Status, Zeitstempel, Kundenbezug).
- Gleiche Case-Datensätze sind unabhängig von Umgebung konsistent interpretierbar.
- Operative Aktionen (z. B. Callback, Abschluss) greifen auf denselben Statusraum.

**Empfohlene Umsetzung**
- Minimales Case-Schema als Contract festlegen und im Repo versionieren.
- Mapping-Layer für Alt-/Fremdfelder (Airtable-Namen) als Übergang, nicht als Dauerzustand.
- Validierung bei Ingest und bei Admin-Mutationen.

**Akzeptanzkriterien**
- Case-Ansicht funktioniert ohne umgebungsspezifische Feldannahmen.
- Pflichtfelder werden bei fehlenden Daten klar behandelt (Fehler/Flag statt stiller Inkonsistenz).
- Operative Kernaktionen sind in Staging und Production gleich ausführbar.

**Risiko bei Nicht-Umsetzung**
- Instabile Bearbeitung im Support-Alltag, fehlerhafte Follow-ups, unzuverlässige Pilot-Experience.

### P1.7 E2E-Ingest-Vertrag inkl. Idempotenz/Retry nachweisbar im Repo verankern
**Warum kritisch**
- Für Call-Ingest fehlt laut Audit ein versionierter, verifizierbarer Vertrag mit Wiederhol-/Fehlerstrategie; Datenverlust ist nicht ausschließbar.

**Betroffene Bereiche**
- Make/Webhook-Integration
- Persistenzpfad für Calls
- Repo-Dokumentation + Testartefakte

**Konkreter Soll-Zustand**
- Ingest-Contract (Payloadschema, idempotency key, Retry-Policy, Failure-Pfad) ist versioniert und testbar.
- Duplicate Events erzeugen keine doppelten Calls.
- Fehlerfälle sind sichtbar und wiederaufsetzbar.

**Empfohlene Umsetzung**
- Schema-Definition + Beispielpayloads im Repo hinterlegen.
- Idempotenzprüfung im Write-Path implementieren.
- Minimale Failure-Runbook-Doku (Retry, Alert, manueller Replay).

**Akzeptanzkriterien**
- Doppeltes Event mit gleicher Event-ID resultiert in genau einem Persistenzdatensatz.
- Simulierter 500-Fehler hat definiertes Retry-Verhalten.
- Ingest-Pfad ist für Betrieb/Support dokumentiert.

**Risiko bei Nicht-Umsetzung**
- Verlorene oder doppelte Calls, keine forensische Nachvollziehbarkeit bei Incidents.

## 3. P2 – Stabilisierung nach P1

### P2.1 Fehler- und Recovery-Standards für Admin-Write-Pfade vereinheitlichen
**Warum kritisch**
- Nach P1-Fixes bleiben sonst inkonsistente Fehlermeldungen/Retry-Muster, was operativ zu Fehlbedienung führt.

**Betroffene Bereiche**
- Server-Funktionen für Mutationen
- Frontend Error-Handling/Toasts/Blocking states

**Konkreter Soll-Zustand**
- Einheitliches Fehlermodell (User-hinweisbar, technisch tracebar) für alle kritischen Mutationen.

**Empfohlene Umsetzung**
- Standard-Response-Schema für Fehlercodes.
- UI-Komponenten für Retry/Backoff-Hinweise wiederverwenden.

**Akzeptanzkriterien**
- Alle P1-Mutationsendpunkte liefern konsistente Fehlerstrukturen.
- Bediener erhalten klare nächste Schritte bei Fehlern.

**Risiko bei Nicht-Umsetzung**
- Hohe Supportlast trotz technischer Kernfixes.

### P2.2 Realtime-/Near-Realtime-Sync für operative Ansichten nachziehen
**Warum kritisch**
- 120s Polling ist für operative Steuerung oft zu träge und kann zu Fehlentscheidungen führen.

**Betroffene Bereiche**
- Admin-Dashboard Refresh-Mechanik
- Calls/KPI-Ansichten

**Konkreter Soll-Zustand**
- Kritische Operativansichten aktualisieren zeitnah (Realtime oder kurzzyklisch eventbasiert).

**Empfohlene Umsetzung**
- Realtime-Subscriptions für Calls/Status oder adaptive Polling-Strategie mit Delta-Fetch.

**Akzeptanzkriterien**
- Neue/aktualisierte Calls erscheinen innerhalb definierter Zielzeit.
- Lastprofil bleibt im Zielkorridor.

**Risiko bei Nicht-Umsetzung**
- Veraltete Entscheidungsgrundlage im Pilotbetrieb.

### P2.3 Tabellen-/Feldnomenklatur bereinigen (`calls` vs `call_logs`, Legacy-Namen)
**Warum kritisch**
- Inkonsistente Bezeichnungen erhöhen Fehleranfälligkeit in Betrieb, Entwicklung und Analyse.

**Betroffene Bereiche**
- Repo-Dokumentation
- SQL/Queries/Frontend-Feldmapping

**Konkreter Soll-Zustand**
- Ein konsistentes Vokabular für Tabellen/Felder in Code, Doku und Monitoring.

**Empfohlene Umsetzung**
- Feld-Glossar im Repo definieren.
- Legacy-Namen per Mapping/Deprecation-Plan abbauen.

**Akzeptanzkriterien**
- Keine widersprüchlichen Primärbezeichnungen mehr in produktiven Pfaden.

**Risiko bei Nicht-Umsetzung**
- Dauerhafte Reibung, Onboarding-Kosten, fehlerhafte Auswertungen.

### P2.4 `admin_emails` / `feature_flags` in echte Produktlogik integrieren
**Warum kritisch**
- Bereits vorhandene Tabellen liefern derzeit kaum operativen Mehrwert.

**Betroffene Bereiche**
- Admin UI und serverseitige Feature-Gates

**Konkreter Soll-Zustand**
- Steuerbare Rollouts und administrative Kommunikationslogik werden produktiv genutzt.

**Empfohlene Umsetzung**
- Flags serverseitig auswerten; UI nur Anzeige.
- Admin-Notification-Pfade an `admin_emails` binden.

**Akzeptanzkriterien**
- Mindestens ein Pilot-relevanter Feature-Flag-Use-Case ist live nutzbar.

**Risiko bei Nicht-Umsetzung**
- Riskante Big-Bang-Änderungen ohne kontrollierte Aktivierung.

## 4. P3 – Cleanup / UX / Konsolidierung

### P3.1 Design- und Interaktionskonsistenz im Admin-Portal harmonisieren
**Warum kritisch**
- Kein Pilot-Blocker, aber wichtig für Effizienz und weniger Bedienfehler.

**Betroffene Bereiche**
- Tabellen/Karten/Modals/Statuslabels im Admin UI

**Konkreter Soll-Zustand**
- Einheitliche UI-Muster für Status, Aktionen, Feedback und Navigationslogik.

**Empfohlene Umsetzung**
- UI-Pattern-Katalog aus bestehenden Komponenten; inkonsistente Varianten reduzieren.

**Akzeptanzkriterien**
- Gleichartige Aktionen sehen/handeln sich gleich.

**Risiko bei Nicht-Umsetzung**
- Höhere Einarbeitungszeit, mehr Fehlklicks.

### P3.2 Accessibility + Mobile Feinschliff
**Warum kritisch**
- Nicht hart blockierend, aber relevant für professionellen Betrieb.

**Betroffene Bereiche**
- Responsive Tabellen, Fokusführung, Kontraste, Keyboard-Navigation

**Konkreter Soll-Zustand**
- Kernflows sind auf Standard-Viewport und mit Tastatur bedienbar.

**Empfohlene Umsetzung**
- A11y-Smoke-Checks + gezielte CSS/ARIA-Korrekturen.

**Akzeptanzkriterien**
- Definierte A11y-Smoke-Checks bestehen.

**Risiko bei Nicht-Umsetzung**
- Einschränkte Nutzbarkeit für Teile des Teams.

### P3.3 Legacy-/Übergangslogik abbauen (Airtable-Fallbacks, provisorische Mappings)
**Warum kritisch**
- Nach P1/P2 sonst unnötige Komplexität und langfristige Fehlerquellen.

**Betroffene Bereiche**
- Fallback-Queries, Mapping-Hilfscode, alte Dokumentationsabschnitte

**Konkreter Soll-Zustand**
- Nur noch produktiv notwendige Pfade im Code.

**Empfohlene Umsetzung**
- Technische Schuldenliste schließen, tote Pfade entfernen, Doku synchronisieren.

**Akzeptanzkriterien**
- Keine aktiven Legacy-Fallbacks mehr in Kernpfaden.

**Risiko bei Nicht-Umsetzung**
- Wartungskosten steigen, Regression-Risiko bleibt hoch.

## 5. Empfohlene Reihenfolge der Umsetzung
1. **Sicherheits- und Kontrollbasis herstellen:** P1.1 (serverseitige Kapselung + Key-Rotation) und parallel P1.4 (Admin-Provisioning/RBAC), damit jede weitere Arbeit auf harten Berechtigungsgrenzen aufsetzt.
2. **Datenrealität und Identität stabilisieren:** P1.2 (SSOT-Konsolidierung) und P1.3 (canonical ID/Lifecycle), weil ohne diese Basis Contract/Billing und Cases nicht zuverlässig werden.
3. **Kommerzielle und operative Kernpfade härten:** P1.5 (Contract/Billing-Orchestrierung), P1.6 (Case-Schema-Stabilität), P1.7 (E2E-Ingest-Vertrag).
4. **Nachgelagerte Betriebsstabilisierung:** P2.1 bis P2.4.
5. **Bewusst warten bis Kern robust ist:** P3.1 bis P3.3.

## 6. Empfohlene GitHub-Issue-Struktur

### Epic
- **Epic: Admin Portal Pilot Readiness – Operational Backbone & Control Plane**

### P1-Issues (Milestone: `Admin Pilot Gate – P1`)
1. **[P1] Remove client-side service-role usage and enforce server-side privileged mutations**
2. **[P1] Consolidate Admin data paths to single source of truth (Supabase)**
3. **[P1] Introduce canonical customer identity and lifecycle state machine**
4. **[P1] Implement server-side admin provisioning + RBAC enforcement**
5. **[P1] Replace localStorage contracts with centralized contract/billing orchestration**
6. **[P1] Stabilize cases schema for environment-independent operational handling**
7. **[P1] Version and validate E2E call-ingest contract (idempotency + retry)**

### P2-Issues (Milestone: `Admin Pilot Stabilization – P2`)
1. **[P2] Standardize mutation error model and operator recovery UX**
2. **[P2] Implement realtime/near-realtime updates for operational views**
3. **[P2] Align naming conventions across tables, code, and documentation**
4. **[P2] Activate admin_emails and feature_flags in server-driven product logic**

### P3-Issues (Milestone: `Admin Consolidation – P3`)
1. **[P3] Harmonize Admin UI interaction patterns and status presentation**
2. **[P3] Accessibility and mobile usability polish for core workflows**
3. **[P3] Remove legacy fallback paths and transitional mappings**

## 7. Empfohlene nächste Aktion
**Sofort starten mit:**
- **Issue:** `[P1] Remove client-side service-role usage and enforce server-side privileged mutations`

**Warum zuerst**
- Dieser Punkt ist die Sicherheits- und Governance-Basis für alle folgenden Änderungen. Solange privilegierte Aktionen im Client möglich sind, bleiben RBAC, Contract/Billing-Orchestrierung und Lifecycle-Konsistenz strukturell angreifbar und nicht pilottauglich.
