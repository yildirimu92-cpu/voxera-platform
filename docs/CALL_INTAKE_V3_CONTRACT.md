# Call Intake v4 contract

> **Der Secure Resolver ist am 09.08.2026 entfallen.** Die Abschnitte
> „Secure resolver", „Make notification rules" und „Required environment"
> beschreiben den Zustand bis dahin und sind unten entsprechend markiert. Die
> Kundenauflösung und das Gating laufen jetzt in-process in
> `customer-dashboard/netlify/functions/_lib/call-notification.js`; der Versand
> geht über `_lib/mail-delivery.js` und die zentrale Mail-Engine. Siehe
> `docs/make/README.md`.
>
> Unverändert gültig bleiben „Backend responsibility" und „Idempotency".

The active Make scenario must not resolve customers by an exact text comparison on `customers.voxera_number`.

## Backend responsibility

`elevenlabs-post-call` remains the system of record for:

- ElevenLabs signature validation;
- call persistence in `public.calls`;
- idempotent matching by `elevenlabs_conversation_id`, provider call id, or recent phone pair;
- duration persistence;
- Supabase dashboard notifications;
- delivery of the final call payload to Make.

## Secure resolver (ABGELÖST 09.08.2026 — nur noch historisch)

Der Endpunkt und sein Vertragstest sind gelöscht. Zwei Wächter halten das fest:
`.github/workflows/verify-call-intake.yml` und
`scripts/verify-mail-engine-contracts.mjs`.

Grund für die Löschung, über die Ablösung hinaus: der Endpunkt gab gegen ein
geteiltes Secret zu einer **beliebigen** Telefonnummer die E-Mail-Adresse des
Kunden samt Benachrichtigungseinstellungen heraus — und das Secret stand im
exportierten Make-Blueprint im Klartext, galt also als offengelegt. Ein
abgelöster Pfad, der weiterläuft, ist kein toter Code, sondern eine offene Tür.

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

The resolver uses the service role only server-side and requires a timing-safe shared-secret comparison. It normalizes Swiss national, `0041...`, and E.164 phone formats before matching. Ambiguous normalized assignments return HTTP 409 instead of routing a notification to an arbitrary customer. Resolved customers without an email address return HTTP 422.

## Make notification rules (ABGELÖST 09.08.2026 — nur noch historisch)

Das Gating sitzt jetzt in `decideMail()` in `_lib/call-notification.js`, nicht
mehr im Make-Router. Die Make-Routen filtern nur noch auf den `mail_type`.

- callback route: `callback_requested = true`, `notification_active = true`, resolved customer and recipient exist;
- normal-call route: `callback_requested = false`, `new_log_email_active = true`, resolved customer and recipient exist;
- Make does not write call records or calculate billable minutes;
- Make is transport only for customer notification emails.

## Required environment (ABGELÖST 09.08.2026)

`CALL_INTAKE_RESOLVER_SECRET` wird von keinem Code mehr gelesen und ist aus
Netlify zu entfernen. Der Wert gilt als offengelegt und darf nicht
wiederverwendet werden.

Nicht zu verwechseln mit `MAKE_CALL_INTAKE_WEBHOOK`: die Variable liest zwar
ebenfalls niemand mehr, sie soll aber **gesetzt bleiben**. `resolveMailWebhook()`
in `_lib/mail-delivery.js` vergleicht `MAKE_MAIL_WEBHOOK` dagegen und weist den
Versand ab, wenn beide auf denselben Hook zeigen — die Sperre gegen genau die
Verwechslung, die in PR #857 die Admin-Benachrichtigungen gekostet hat. Ohne
Vergleichswert ist sie wirkungslos.

## Idempotency

The database migration `2026-08-01_call_intake_idempotency.sql` creates a partial unique index on `elevenlabs_conversation_id`. Provider retries therefore cannot create multiple canonical records with the same ElevenLabs conversation id.
