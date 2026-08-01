# Voxera Calendar Integration (Google + Microsoft)

This integration is disabled by default. Merge and deploy the foundation without enabling OAuth or assistant booking until a permanent test customer exists.

## Architecture

- Customer-authenticated settings API: `calendar-connections`
- OAuth callback: `calendar-oauth-callback`
- Signed ElevenLabs tool endpoint: `calendar-tool`
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
CALENDAR_DASHBOARD_ORIGIN=https://dashboard.voxera.ch
CALENDAR_OAUTH_REDIRECT_URI=https://dashboard.voxera.ch/.netlify/functions/calendar-oauth-callback
CALENDAR_TOKEN_ENCRYPTION_KEY=<32 random bytes, base64 encoded>
CALENDAR_TOOL_WEBHOOK_SECRET=<at least 32 random bytes>

GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=

MICROSOFT_CALENDAR_CLIENT_ID=
MICROSOFT_CALENDAR_CLIENT_SECRET=
```

Keep `CALENDAR_INTEGRATION_ENABLED=false` until database migration, OAuth app setup, preview tests, a permanent test customer, and ElevenLabs tool tests are complete.

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

## Microsoft Entra setup

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

The tool request must be an exact JSON POST body. Send:

- `X-Voxera-Timestamp`: current Unix timestamp in seconds
- `X-Voxera-Signature`: hex HMAC-SHA256 of `<timestamp>.<raw request body>` using `CALENDAR_TOOL_WEBHOOK_SECRET`

Requests older than five minutes or with an invalid signature are rejected.

The default contract requires `agent_id`; Voxera resolves the customer from `customers.elevenlabs_agent_id`. Direct `customer_id` use remains disabled unless `CALENDAR_TOOL_ALLOW_CUSTOMER_ID=true`, which must not be enabled in production.

Supported actions:

- `availability`
- `book`
- `reschedule`
- `cancel`

Every write should include a unique `request_id` for idempotency.

## Activation gate

Before changing the feature flag to `true`:

1. Apply `2026-08-01_calendar_integrations_foundation.sql`.
2. Configure both OAuth applications and secrets.
3. Connect one Google and one Microsoft test calendar.
4. Verify calendar selection and token refresh.
5. Configure a permanent test customer and ElevenLabs agent.
6. Test availability, book, reschedule, and cancel.
7. Verify audit rows and cross-customer isolation.
8. Test disconnect and expired-consent recovery.
9. Only then enable customer booking.
