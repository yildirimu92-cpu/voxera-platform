# Call Intake v4 contract

The active Make scenario must not resolve customers by an exact text comparison on `customers.voxera_number`.

## Backend responsibility

`elevenlabs-post-call` remains the system of record for:

- ElevenLabs signature validation;
- call persistence in `public.calls`;
- idempotent matching by `elevenlabs_conversation_id`, provider call id, or recent phone pair;
- duration persistence;
- Supabase dashboard notifications;
- delivery of the final call payload to Make.

## Secure resolver

Scenario `01. Call Intake – Audited v4 Secure Resolver` calls:

```text
POST https://dashboard.voxera.ch/.netlify/functions/call-intake-resolve-customer
X-Call-Intake-Secret: <CALL_INTAKE_RESOLVER_SECRET>
```

Request:

```json
{
  "called_number": "+41441234567"
}
```

Response:

```json
{
  "resolved": true,
  "strategy": "exact_normalized",
  "normalized_called_number": "+41441234567",
  "customer_id": "customer-id",
  "customer_name": "Example AG",
  "contact_name": "Max Muster",
  "customer_email": "max@example.ch",
  "notification_active": true,
  "notification_mode": "callback_only",
  "new_log_email_active": false,
  "missed_call_email_active": true
}
```

The resolver uses the service role only server-side and requires a timing-safe shared-secret comparison. It normalizes Swiss national, `0041...`, and E.164 phone formats before matching.

## Make notification rules

- callback route: `callback_requested = true`, `notification_active = true`, resolved customer and recipient exist;
- normal-call route: `callback_requested = false`, `new_log_email_active = true`, resolved customer and recipient exist;
- Make does not write call records or calculate billable minutes;
- Make is transport only for customer notification emails.

## Required environment

Customer Dashboard Netlify:

```text
CALL_INTAKE_RESOLVER_SECRET=<strong random secret>
```

The same value must be entered in HTTP module 2 of the Make scenario as the `X-Call-Intake-Secret` header.

## Idempotency

The database migration `2026-08-01_call_intake_idempotency.sql` creates a partial unique index on `elevenlabs_conversation_id`. Provider retries therefore cannot create multiple canonical records with the same ElevenLabs conversation id.
