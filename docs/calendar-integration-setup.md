# Voxera Calendar Integration (Google-first, Microsoft-ready)

This integration is disabled by default. Google can be rolled out first; Microsoft remains technically prepared and hidden until its OAuth credentials are configured. Merge and deploy the foundation without enabling assistant booking until a permanent test customer exists.

## Architecture

- Customer-authenticated settings API: `calendar-connections`
- OAuth callback: `calendar-oauth-callback`
- Authenticated ElevenLabs tool endpoint: `calendar-tool`
- Provider adapters: Google Calendar API and Microsoft Graph
- Tenant isolation: provider connections are resolved from the authenticated customer or mapped ElevenLabs agent
- Token storage: AES-256-GCM encrypted before Supabase persistence
- OAuth CSRF protection: random, one-time, ten-minute states stored only as SHA-256 hashes
- Booking audit and idempotency: `calendar_booking_audit`
- Global kill switch: `CALENDAR_INTEGRATION_ENABLED`

## Required environment variables

Set these in the **voxera-dashboard** Netlify site for Functions and all required deploy contexts:

```
CALENDAR_INTEGRATION_ENABLED=false
CALENDAR_ROLLOUT_CUSTOMER_IDS=
CALENDAR_DASHBOARD_ORIGIN=https://dashboard.voxera.ch
CALENDAR_OAUTH_REDIRECT_URI=https://dashboard.voxera.ch/.netlify/functions/calendar-oauth-callback
CALENDAR_TOKEN_ENCRYPTION_KEY=<32 random bytes, base64 encoded>
CALENDAR_TOOL_WEBHOOK_SECRET=<at least 32 random bytes>

GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=

# Optional: leave both unset to keep Microsoft hidden
MICROSOFT_CALENDAR_CLIENT_ID=
MICROSOFT_CALENDAR_CLIENT_SECRET=
```

Keep `CALENDAR_INTEGRATION_ENABLED=false` until database migration, Google OAuth setup, preview tests, a permanent test customer, and ElevenLabs tool tests are complete.

Microsoft OAuth variables are optional. A provider is offered only when both its client ID and client secret are configured. An existing connection remains visible if credentials are later removed so that the customer can still disconnect it safely.

For controlled testing, set `CALENDAR_ROLLOUT_CUSTOMER_IDS` to the exact test customer ID before enabling the global flag. Multiple IDs are comma-separated. An empty value denies every customer; use `*` only for an intentional broad rollout.

Generate independent secrets. Do not reuse Supabase, Twilio, or OAuth client secrets.

## Google Cloud setup

1. Create or select the Voxera Google Cloud project.
2. Enable Google Calendar API.
3. Configure an external OAuth consent screen.
4. Create a Web application OAuth client.
5. Add the exact redirect URI from `CALENDAR_OAUTH_REDIRECT_URI`.
6. Configure the scopes:
   - `openid`
   - `email`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
7. Keep the app in testing until the permanent test customer succeeds.
8. Plan Google OAuth verification before a broad customer rollout.

Official references:

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2/scopes
- https://developers.google.com/calendar/api/v3/reference/calendarList/list
- https://developers.google.com/calendar/api/v3/reference/events/insert
- https://developers.google.com/calendar/api/v3/reference/freebusy/query

## Optional Microsoft Entra setup

1. Register a Voxera application in Microsoft Entra.
2. Configure it as a confidential Web application.
3. Add the exact redirect URI from `CALENDAR_OAUTH_REDIRECT_URI`.
4. Add delegated Microsoft Graph permissions:
   - `User.Read`
   - `Calendars.ReadWrite`
   - `offline_access`
   - `openid`, `profile`, `email`
5. Create a client secret and store it only in Netlify.
6. Use a multi-tenant registration if external Microsoft 365 organizations should connect.

Official references:

- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- https://learn.microsoft.com/en-us/graph/auth-v2-user
- https://learn.microsoft.com/en-us/graph/api/user-list-calendars
- https://learn.microsoft.com/en-us/graph/api/calendar-post-events
- https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview

## ElevenLabs tool security

Configure the ElevenLabs webhook tool with Bearer authentication:

1. Add an `Authorization` header to the tool.
2. Select `Secret` as the header value type.
3. With the built-in Bearer-token connection, store the raw `CALENDAR_TOOL_WEBHOOK_SECRET`. If a custom header is used instead, store the complete value `Bearer <CALENDAR_TOOL_WEBHOOK_SECRET>`.
4. Send the request as a JSON POST body.

The endpoint performs a timing-safe comparison of the bearer token. Trusted internal callers may alternatively send `X-Voxera-Timestamp` and `X-Voxera-Signature`, where the signature is the hex HMAC-SHA256 of `<timestamp>.<raw request body>`; those requests expire after five minutes.

The default contract requires `agent_id`; Voxera resolves the customer from `customers.elevenlabs_agent_id`. In ElevenLabs, bind this field to the protected dynamic value `system__agent_id` rather than an LLM-generated value. Direct `customer_id` use remains disabled unless `CALENDAR_TOOL_ALLOW_CUSTOMER_ID=true`, which must not be enabled in production.

Official reference:

- https://elevenlabs.io/docs/eleven-agents/customization/tools/webhook-tools#supported-authentication-methods

Supported actions:

- `availability`
- `book`
- `reschedule`
- `cancel`

`book`, `reschedule`, and `cancel` require a unique `request_id`. Idempotency is scoped to the resolved customer, so retries cannot collide across tenants.

## Activation gate

Before changing the feature flag to `true`:

1. Apply `2026-08-01_calendar_integrations_foundation.sql`.
2. Configure the Google OAuth application and secrets. Microsoft may remain unconfigured.
3. Connect one Google test calendar and every additional provider that is configured.
4. Verify calendar selection and token refresh for each configured provider.
5. Configure a permanent test customer and ElevenLabs agent, then add only that customer to `CALENDAR_ROLLOUT_CUSTOMER_IDS`.
6. Test availability, book, reschedule, and cancel.
7. Verify audit rows and cross-customer isolation.
8. Test disconnect and expired-consent recovery.
9. Only then enable customer booking.
