# UI-Feedback-Batch – 31.07.2026

## Umgesetzt im PR #688

- Cockpit-KPIs an das visuelle Pipeline-Design der Kundenseite angeglichen.
- Cockpit-Queues fachlich bereinigt: versendete Rechnungen und bereits in Verträge überführte Offerten werden nicht mehr als offene Aufgaben behandelt.
- Zusätzlicher Bereich «Betrieb im Blick» für Onboarding, Rechnungen, AI-Sync und offene Cases.
- Sales-Offerten standardmässig kompakter; Detailbereiche bleiben per Umschalter erreichbar.
- Verknüpfte Verträge öffnen innerhalb Sales > Verträge direkt den konkreten Datensatz.
- Altes Kundenprofil wird nicht mehr als paralleler Workspace geöffnet.
- Workspace um Rechnungs- und Vertrags-Shortcuts ergänzt; direkter Legacy-Cases-Link entfernt.
- KPI-Bereiche in Onboarding und Billing vereinheitlicht.
- Kontrast für dunkle Kartenköpfe portalweit abgesichert.
- Assistenten-Sync erhält Kundenauswahl, leeren Zustand, Fehlerzustand, Retry und 12-Sekunden-Timeout.
- Nach erfolgreicher Übergabe einer Rechnungs- oder Setup-Mail wird ein Draft serverseitig auf `open` gesetzt.

## Smoke-Test vor Merge

1. Cockpit-KPIs, Farben und dunkle Überschriften prüfen.
2. Versendete Rechnung darf nach Reload nicht als unversendeter Draft erscheinen.
3. Akzeptierte Offerte mit Vertrag darf nicht unter «Wartet auf dich» erscheinen.
4. Sales-Offerte kompakt öffnen und «Alle Details» testen.
5. Verknüpften Vertrag anklicken: Sales > Verträge und konkreter Vertrag müssen sichtbar sein.
6. Kunden-Workspace: kein alter Detail-Workspace; Rechnungs- und Vertrags-Shortcuts prüfen.
7. Onboarding- und Billing-KPI-Leisten prüfen.
8. Assistenten > Sync-Status: Ergebnis, leerer Zustand oder klare Fehlermeldung innerhalb 12 Sekunden.

## Automatische Checks

- Netlify Deploy Preview Admin: erfolgreich.
- Netlify Deploy Preview Customer Dashboard: erfolgreich.
- P0 Security Verification: erfolgreich.
- Phase-1-Launch-Gates: erfolgreich.
- Billing-Mail-Control-Checks: erfolgreich.
