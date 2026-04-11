# VOXERA – Faktenbasierter Readiness Report (Stand: 2026-04-11)

## Methodik / Belegbasis
- **Arbeitsprinzip:** Nur aus im Repository sichtbaren Artefakten (Code, HTML, Netlify Functions, SQL-Migrationen, Konfig-Dateien).
- **Keine Annahmen:** Externe Systeme (Make.com-Inhalte, SMTP-Provider-Setups, Deploy-Status, echte Produktionsdaten) werden nur als **nicht verifiziert** markiert.
- **Verifizierungslabel:**
  - **codebasiert verifiziert**
  - **visuell verifiziert** (nur bei direkt sichtbaren UI-Artefakten im Repo)
  - **nicht vollständig verifiziert**
  - **offen / unklar**

---

## 1) EXECUTIVE SUMMARY

### Kurze Gesamteinschätzung
VOXERA hat eine **klar erkennbare technische V1-Basis** mit getrenntem Customer Dashboard und Admin Portal, rollenbasierten Netlify-API-Gates, Statusmodellen, Outbox/Retry-Mechanik für Webhook-getriebene Prozesse und einer ausgebauten AI-Setup-Struktur. Gleichzeitig bestehen **verifizierte Launch-Risiken** in den Bereichen Konsistenz (mehrere Statusmodelle/Übergangslogiken), Sprach-/Designkonsistenz zwischen Portalen sowie nicht versionierte externe Automationsinhalte (Make-Szenario-Interna).

### Readiness Score (0–100)
- **64/100** (faktenbasiert, rein repo-intern bewertet)

### Soft Go / No Go / Internal Only
- **Empfehlung:** **Internal Only**

Begründung in Kurzform:
- Für internen Betrieb ist technisch genug vorhanden (Auth-Gates, Kernflows, Outbox-Retry, SQL-Statusmodell).
- Für Pilot/Soft Launch fehlen belastbare repo-interne Belege für vollständige externe Automationssicherheit und konsistente End-to-End-UX ohne Brüche.

---

## 2) VERIFIZIERTE STÄRKEN

1. **Klar getrennte Produktflächen vorhanden (Customer + Admin).** *(codebasiert verifiziert)*
   - Customer Dashboard mit Tabs/Modulen für Dashboard, Anrufe, Rückrufe, Archiv, Einrichtung, Einstellungen, Hilfe.
   - Admin Portal mit Bereichen für Übersicht, Kunden, Onboarding, AI Setup, Cases, Activity/Insights, Billing & Finance, Einstellungen, Offerten, Verträge.

2. **Auth-/Access-Gates serverseitig implementiert.** *(codebasiert verifiziert)*
   - `require-admin` prüft Bearer Token + `admins`-Tabelle + erlaubte Rollen.
   - `require-customer` prüft Bearer Token + `users.customer_id` + Customer-Entitlement.

3. **Customer-Entitlement als zusätzlicher Zugriffsschutz vorhanden.** *(codebasiert verifiziert)*
   - Customer-Endpunkte sind nicht nur an Token, sondern auch an Entitlement gekoppelt.

4. **Statusmodell und Transition Guards vorhanden.** *(codebasiert verifiziert)*
   - Zentrale Statusdefinitionen und Transition-Prüfungen in `_lib/status-model.js` (Customer/Onboarding/Case/Call).
   - Mehrere Funktionen validieren Übergänge und liefern 409 bei illegalen Transitions.

5. **Webhook-Outbox mit Retry/Backoff/Dead-Letter-State ist implementiert.** *(codebasiert verifiziert)*
   - Tabelle `outbox_events` + Retry-Worker + Backoff + Terminal-Handling vorhanden.
   - Mehrere Flows schreiben Outbox-Events vor Webhook-Send.

6. **Call Intake besitzt Auth (Webhook-Secret), Phone-Normalisierung und Idempotenz via `call_id`.** *(codebasiert verifiziert)*
   - Intake lehnt unautorisierte Requests ab.
   - Nummern werden normalisiert; `upsert` via `onConflict: call_id`.

7. **Passwort-Flows im Customer Dashboard sind implementiert (Ändern, Forgot Password, Reset-Form).** *(codebasiert verifiziert)*
   - Änderung im eingeloggten Zustand.
   - Forgot-Password via Supabase-Reset.
   - Reset-Form inkl. Token-/Session-Handling.

8. **AI-Setup ist als strukturierter Arbeitsbereich mit Pflichtfeldern und Readiness-Logik umgesetzt.** *(codebasiert verifiziert)*
   - Trennung zwischen globalem Prompt-Teil und kundenspezifischen Feldern.
   - Pflichtfelder erzeugen Status `AI Ready` / `Needs Review` / `Blocked`.
   - Persistenz in `customers`-AI-Felder + `ai_summary`.

---

## 3) VERIFIZIERTE SCHWÄCHEN

1. **Inkonsistente Statuslogik zwischen Komponenten möglich.** *(codebasiert verifiziert)*
   - Es gibt zentrale Statusmodelle, aber auch Inline-/Sonderlogiken (z. B. in `call-save-followup.js`), die von zentralen Regeln abweichen können.

2. **Teilweise nicht-atomare End-to-End-Flows.** *(codebasiert verifiziert)*
   - Beispiel: Aktivierung kann erfolgreich sein, während Access-Mail-Dispatch separat fehlschlägt; Fehler wird zurückgegeben, aber Kernzustand kann bereits geändert sein.

3. **Admin-Portal enthält signifikant gemischte Sprache (DE/EN) in Navigation, Labels und Domänenbegriffen.** *(visuell/codebasiert verifiziert)*
   - Beispiele: „Configure“, „Insights“, „Billing & Finance“, „Cases“, „Internal Ops“, „AI Ready“, „Needs Review“, „Blocked“ neben deutschsprachigen Texten.

4. **Customer Dashboard blendet 0-Badges aus statt explizit 0 anzuzeigen.** *(codebasiert verifiziert)*
   - Badges werden bei Count=0 auf `display:none` gesetzt.

5. **Sichtbare Legacy-/Fallback-Komplexität erhöht operative Komplexität.** *(codebasiert verifiziert)*
   - Outbox-Lib enthält Modern-/Legacy-Column-Fallbacks.
   - Mehrere alias-/fallback-basierte Feldauflösungen und Kompatibilitätspfade.

6. **Sicherheitsrelevante Konfigurationen sind env-abhängig und im Repo nicht belegbar gesetzt.** *(offen/unklar, aber codebasiert als Abhängigkeit verifiziert)*
   - Beispiel: `MAKE_*_WEBHOOK`, `CALL_INTAKE_WEBHOOK_SECRET`, Supabase Keys.

---

## 4) OFFENE / NICHT VERIFIZIERTE PUNKTE

1. **Make-Szenario-Inhalte selbst (01–07) sind nicht im Repo versioniert.** *(nicht vollständig verifiziert)*
   - Im Code sind Webhook-Ziele und Eventtypen sichtbar, aber keine Make-Szenario-Definitionen/Blueprints.

2. **E-Mail-Template-Inhalte außerhalb des Payload-Contracts sind nicht im Repo verifiziert.** *(nicht vollständig verifiziert)*
   - Repo zeigt Trigger/Payloads/Typen, nicht den tatsächlichen finalen HTML/Text pro Template in Make.

3. **Produktionskonfiguration (Secrets, Redirect-Whitelist, Deploy-Variablen, Cron/Worker-Scheduling) ist nicht verifiziert.** *(offen/unklar)*

4. **Reale UI-Screenshots aus laufender Umgebung sind nicht enthalten.** *(offen/unklar)*
   - Es liegen HTML-Artefakte vor, aber keine runtime-validierten Screenshots aus dieser Prüfung.

---

## 5) RISIKEN NACH PRIORITÄT

### Kritisch
1. **Externe Automationskette (Make) nicht repo-versioniert/verifizierbar.**
   - Risiko: Unklare tatsächliche Trigger-/Retry-/Fehlerpfade außerhalb des Codes.

### Hoch
2. **Status-/Flow-Inkonsistenzen durch parallele Logikpfade möglich.**
3. **Gemischte Sprache im Admin Portal kann operative Fehler/Verständnisbrüche erzeugen.**
4. **Env-abhängige Sicherheitspfade ohne Repo-Nachweis der Produktivbelegung.**

### Mittel
5. **Nicht-atomare Teilschritte (Statuswechsel vs. Mail/Webhook) können Zwischenzustände erzeugen.**
6. **Legacy-Fallbacks erhöhen Debugging- und Wartungsaufwand.**

### Niedrig
7. **0-Badge-Ausblendung statt expliziter Nullanzeige (UX-Klarheit).**
8. **Terminologie-Mix zwischen Portalbereichen (z. B. Cases/Anliegen).**

---

## 6) KONKRETE PRIORITÄTENLISTE (Top 10 nächste Schritte, nach Impact)

1. **Make-Szenarien 01–07 als versionierte Artefakte ins Repo aufnehmen** (Blueprint/Export + Trigger/Retry/Fehlerpfade dokumentieren).
2. **Eindeutige End-to-End Contract-Matrix pflegen** (Eventtyp → Webhook → Template → erwartetes Ergebnis).
3. **Statusmodell konsolidieren** (alle Call/Case/Customer-Übergänge ausschließlich über zentrale Transition-Guards führen).
4. **Konsistenzprüfung für nicht-atomare Flows ergänzen** (Outbox-/State-Sync-Mechanismen für „Status geändert, Mail fehlgeschlagen“).
5. **Admin-UI sprachlich vereinheitlichen (Deutsch)** inkl. Badges/Statuslabels.
6. **Designsystem-Regeln zwischen Customer/Admin fixieren** (Buttons, Badges, Empty States, Card-/Modal-Semantik).
7. **0-Badge-Policy definieren** (ausblenden vs. „0“ anzeigen) und konsistent umsetzen.
8. **Security-Konfig-Checklist versionieren** (required env vars, Secret Rotation, Redirect URL Policy).
9. **Passwort-/Reset-Flows als testbare E2E-Skripte dokumentieren** (inkl. Fehlerfälle).
10. **Operatives Monitoring für Outbox/Dead-Letter verpflichtend machen** (Dashboards + Alerting-Schwellen).

---

## 7) FAKTENBASIERTE GO / NO-GO EMPFEHLUNG

### a) Interner Testbetrieb
- **GO (mit Auflagen)**
- Begründung: Kernmodule, Auth-Gates, Statusmodelle und zentrale Automationspfade sind im Code vorhanden.

### b) Pilotkunden / Soft Launch
- **Eingeschränkt / aktuell eher NO-GO**
- Begründung: Externe Make-Details und vollständige E-Mail-/Automation-Transparenz sind repo-seitig nicht belastbar verifiziert; dazu kommen Konsistenz-/UX-Brüche.

### c) Breiter Rollout
- **NO-GO**
- Begründung: Für breiten Rollout fehlen im aktuellen, rein faktenbasiert verifizierbaren Stand robuste Nachweise zu vollständig kontrollierten, versionierten und konsistenten End-to-End-Prozessen.

---

## 8) DETAILANALYSE NACH ANGEFORDERTEN BEREICHEN

### 8.1 Produktstatus
- **Verifiziert vorhanden:** Customer Dashboard + Admin Portal + Netlify-Functions + Supabase SQL-Migrationsbasis.
- **Wahrscheinlich, aber nicht vollständig verifiziert:** produktive Nutzung externer Make-Automationen.
- **Offen/unklar:** tatsächlicher Produktionsbetriebsstatus der Deployments.

### 8.2 Customer Dashboard
- **Verifiziert vorhandene Module:** Dashboard, Anrufe, Rückrufe, Archiv, Einrichtung, Einstellungen, Hilfe.
- **Verifizierte UX-Punkte:**
  - Empty States vorhanden („Noch keine Anrufe“, „Keine offenen Rückrufe“, „Keine geplanten Follow-ups“, „Keine Einträge gefunden“).
  - 0-Badges werden ausgeblendet.
  - Passwort ändern + Forgot Password + Reset-Form implementiert.
- **Verifizierte Brüche/Risiken:** gemischte Fallback- und Kompatibilitätspfade in mehreren UI-/Datenstellen.

### 8.3 Admin Portal
- **Verifiziert vorhandene Bereiche:** Übersicht, Kunden, Onboarding, AI Setup, Cases, Aktivität/Insights, Billing & Finance, Einstellungen, Offerten, Verträge.
- **Verifiziert unvollständig/inkonsistent wirkend:** Sprachmix DE/EN in Kernnavigation und Statusbegriffen.
- **Verifizierte UX-/Operations-Schwäche:** Begriffsinkonsistenz erhöht Einarbeitungs- und Fehlbedienungsrisiko.

### 8.4 AI-Assistent / Agent-Setup
- **Verifiziert vorhandene Struktur:**
  - Globaler Prompt + globale Regeln.
  - Kundenspezifische Felder (Business, Services, Hours, FAQ, Instructions, Escalation, Constraints, Internal Notes).
  - Generierte `ai_summary`.
- **Verifiziertes Risiko:** Readiness-Status hängt von Teilmengen an Pflichtfeldern ab; Qualität der Inhalte bleibt operativ abhängig von Datenpflege.
- **Nicht vollständig verifiziert:** tatsächliche Laufzeit-Übernahme in externem AI-Agent-System außerhalb Repo.

### 8.5 E-Mail-System
- **Verifiziert vorhanden:** Eventtypen + Outbox + Webhook-Dispatch-Logik (`offer_email`, `subscription_payment_email`, `setup_fee_email`, `invoice_email`, welcome/reset etc.).
- **Nicht vollständig verifiziert:** endgültige Template-Bodies und Provider-seitige Zustellung.

### 8.6 Make / Automationen
- **Verifiziert im Code:** Webhook-Ziele und Eventtypen für Call Intake, Access/Welcome/Reset, Cases, Contract, Billing, Mail.
- **Nicht verifiziert:** Make-Szenarien 01–07 als echte Blueprint-Dateien/Flows fehlen im Repo.
- **Strukturfazit:** technische Entkopplung via Outbox sauber angelegt; externe Scenario-Komplexität ohne Versionierung potenziell chaotisch.

### 8.7 Auth / Access / Security
- **Verifiziert:**
  - Admin-Token + Rollenprüfung.
  - Customer-Token + Tenant-Zuordnung + Entitlement.
  - Webhook-Secret-Prüfung im Intake.
- **Offen/unklar:** produktive Secret-Setups und Rotationsprozesse.

### 8.8 State / Reliability / Operations
- **Verifiziert:** zentrale Statusmodelle, Transition Guards, Retry-Worker mit Backoff und Dead-Letter-Status.
- **Verifiziertes Risiko:** Parallel-/Fallback-Logiken können inkonsistente Zustände begünstigen.

### 8.9 Designkonsistenz (Customer vs Admin)
- **Verifiziert konsistent:** Grundstruktur (Sidebar/Topbar/Card-System, Brand-Farben, Badge-Styling-Basis).
- **Verifiziert inkonsistent:** Sprachsystem, Fachterminologie und teilweise unterschiedliche semantische UI-Labels.

### 8.10 Soft-Launch Readiness
- **Interner Testbetrieb:** GO mit Auflagen.
- **Pilotkunden:** derzeit eher NO-GO.
- **Breiter Rollout:** NO-GO.

