# Voxera Software-Audit — Executive Summary (2026-05-04)

## TOP 10 Findings (severity-sorted)
1. **Kritisch** — Mehrere Netlify Functions nutzen `SUPABASE_SERVICE_ROLE_KEY`; bei fehlender strikter Tenant-Prüfung besteht Risiko auf Cross-Tenant-Schreibzugriffe. (z. B. `customer-update-settings`, `call-update-status`, `cases-update`).
2. **Kritisch** — Webhook-Endpoints (`call-intake-webhook`, `elevenlabs-post-call`) sind public erreichbar; Security hängt vollständig an Secret-Validierung und robuster Replay/Idempotenz.
3. **Hoch** — DB-SoT enthält viele als „inferred“ markierte Felder; Schema-Drift-Risiko zwischen Runtime und DDL hoch.
4. **Hoch** — Field-Namensmix (`customer_tasks` in Functions vs. `cases` in Core-SoT) deutet auf laufende Migration/Kompatibilitätsschicht mit erhöhtem Broken-Reference-Risiko.
5. **Hoch** — Frontend speichert UX-/Notification-Zustände im Local/SessionStorage ohne zentrale Versionierung; Risiko von inkonsistentem Verhalten nach Deploys.
6. **Hoch** — Externe API-Aufrufe (Twilio/ElevenLabs/Make) mit begrenzter zentraler Retry-/Timeout-Strategie; erhöhte Fehleranfälligkeit bei Netzstörungen.
7. **Mittel** — CORS/Method-Gating ist function-lokal und nicht zentralisiert; uneinheitliche Hardening-Qualität möglich.
8. **Mittel** — Potenzielle Duplicate Logic zwischen Frontend-State-Maschinen und Backend-Statusmodell (`status-model`, `contract-state`, UI-Statusableitungen).
9. **Mittel** — `customer_name` ist noch breit im Datenmodell verankert; Migration zu `customer_display_name`/`customer_legal_name` benötigt klaren Read/Write-Cutover-Plan.
10. **Niedrig** — Technische Schulden durch verteilte Audit-/Migrationsartefakte und steigende Komplexität in `index.html` (monolithischer Vanilla-JS-Client).
