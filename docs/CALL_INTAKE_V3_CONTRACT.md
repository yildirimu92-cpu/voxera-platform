# Call Intake v3 contract

The active Make scenario must not resolve customers by an exact text comparison on `customers.voxera_number`.

## Backend responsibility

`elevenlabs-post-call` is the system of record for:

- ElevenLabs signature validation;
- call persistence in `public.calls`;
- idempotent matching by `elevenlabs_conversation_id`, provider call id, or recent phone pair;
- phone-number normalization;
- customer resolution;
- duration persistence;
- Supabase dashboard notifications;
- delivery of the final notification payload to Make.

## Make payload

Scenario `01. Call Intake – Audited v3 Backend-Resolved` expects:

```json
{
  "event_type": "call_intake",
  "call_id": "calls-row-id",
  "customer_id": "customer-id",
  "customer_name": "Example AG",
  "contact_name": "Max Muster",
  "customer_email": "max@example.ch",
  "notification_active": true,
  "notification_mode": "callback_only",
  "new_log_email_active": false,
  "missed_call_email_active": true,
  "elevenlabs_conversation_id": "conversation-id",
  "called_number": "+41441234567",
  "caller_phone": "+41791234567",
  "caller_name": "Anna Beispiel",
  "call_summary": "...",
  "call_summary_short": "...",
  "callback_requested": true,
  "category": "Termin",
  "lead_quality": "hot",
  "next_action": "Rückruf",
  "priority": "high",
  "duration_seconds": 87
}
```

## Notification rules

- callback route: `callback_requested = true`, `notification_active = true`, resolved customer and recipient exist;
- normal-call route: `callback_requested = false`, `new_log_email_active = true`, resolved customer and recipient exist;
- Make does not write call records or calculate billable minutes;
- Make is transport only for customer notification emails.

## Idempotency

The database migration `2026-08-01_call_intake_idempotency.sql` creates a partial unique index on `elevenlabs_conversation_id`. Provider retries therefore cannot create multiple canonical records with the same ElevenLabs conversation id.
