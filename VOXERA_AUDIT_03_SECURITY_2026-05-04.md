# 3) SECURITY

- **Severity:** kritisch  
  **Location:** Mehrere Functions mit `SUPABASE_SERVICE_ROLE_KEY` (`customer-dashboard/netlify/functions/*.js`)  
  **Beschreibung:** Service-Role umgeht RLS; jede unvollständige Tenant-Validierung kann direkt Cross-Tenant-Reads/Writes ermöglichen.  
  **Empfehlung:** Pro Function expliziten Customer-Context-Guard + allowlist der mutierbaren Felder erzwingen; Security-Tests je Endpoint.

- **Severity:** kritisch  
  **Location:** `call-intake-webhook.js`, `elevenlabs-post-call.js`  
  **Beschreibung:** Public Webhook-Endpunkte mit sensitiven Seiteneffekten; Risiko bei fehlender starker Signature-Prüfung, Timestamp-Window und Replay-Block.  
  **Empfehlung:** HMAC-Signature + timestamp tolerance + nonce/idempotency store als Pflichtcheck.

- **Severity:** hoch  
  **Location:** `twilio-inbound-router.js`  
  **Beschreibung:** Routing auf externe URL; bei unzureichender Request-Authentizität könnten unautorisierte Eingaben verarbeitet werden.  
  **Empfehlung:** Twilio-Request-Validation + strikte Method/CORS-Regeln und Input-Schema.

- **Severity:** hoch  
  **Location:** Frontend (`customer-dashboard/index.html`)  
  **Beschreibung:** Keine offensichtlichen hardcoded Secrets gefunden, aber öffentliche Supabase Keys sind erwartbar sichtbar; Missbrauchsschutz hängt vollständig an RLS/Policies.  
  **Empfehlung:** Regelmäßige RLS-Pen-Tests (Customer-A versucht Customer-B Datenzugriff), besonders auf neue Tabellen.

- **Severity:** mittel  
  **Location:** SQL-Migrationsset (`supabase/sql/*rls*`, `*access_hardening*`)  
  **Beschreibung:** RLS/Policy-Definitionen über viele Files verteilt, was Review-Fehler begünstigt.  
  **Empfehlung:** Generiertes Policy-Inventar (table→policies→using/check) als automatisierten Report im CI.
