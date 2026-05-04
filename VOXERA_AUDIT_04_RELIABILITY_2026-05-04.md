# 4) RELIABILITY

- **Severity:** hoch  
  **Location:** `activation-start-system-test-call.js`, `elevenlabs-post-call.js`, `twilio-inbound-router.js`  
  **Beschreibung:** Externe API-Abhängigkeiten (Twilio/ElevenLabs/Make) erhöhen Ausfallrisiko; nicht überall sind Retry/Backoff/Circuit-Breaking zentral erkennbar.  
  **Empfehlung:** Einheitliche Outbound-HTTP-Policy (timeout, retries, jitter, error taxonomy) extrahieren.

- **Severity:** hoch  
  **Location:** webhook-/statusupdate-lastige Functions (`call-intake-webhook.js`, `call-update-status.js`)  
  **Beschreibung:** Potenzielle Race Conditions bei parallelen Statusupdates desselben Calls.  
  **Empfehlung:** Optimistic concurrency (updated_at/version check) oder dedizierte transition-guards.

- **Severity:** mittel  
  **Location:** `cleanup-stale-calls.js`  
  **Beschreibung:** Batch-Cleanup kann bei großen Datenmengen Timeouts/Partial Updates erzeugen.  
  **Empfehlung:** Chunking + resumable cursor + observability (processed/failed counters).

- **Severity:** mittel  
  **Location:** Eingangsvalidierung über Functions  
  **Beschreibung:** Ohne strikt einheitliches Schema-Validation-Layer drohen Edge-Case-Fehler bei unerwarteten Payloads.  
  **Empfehlung:** Gemeinsame JSON-schema/zod-Validierung pro Endpoint mit konsistenten 4xx-Fehlern.

- **Severity:** mittel  
  **Location:** Webhook-Idempotenz  
  **Beschreibung:** Retries von Providern können doppelte Writes/Events verursachen, falls Idempotenzschlüssel nicht durchgehend erzwungen sind.  
  **Empfehlung:** Provider-event-id als unique key persistieren und duplicate events short-circuiten.
