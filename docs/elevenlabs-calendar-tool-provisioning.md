# ElevenLabs calendar tool provisioning

## Purpose

Voxera uses one workspace-level ElevenLabs webhook tool for all customer agents. The tool identifies the customer from ElevenLabs' `system__agent_id` and routes the request to that customer's active Google or Microsoft calendar connection.

No customer-specific webhook tool or hard-coded agent ID is required.

## Runtime flow

1. `trigger-elevenlabs-sync` compiles the customer prompt.
2. Voxera creates or updates the ElevenLabs workspace secret `voxera_calendar_authorization`.
3. Voxera creates or updates the workspace tool `manage_voxera_calendar`.
4. The existing agent configuration is loaded and the shared tool ID is appended without removing other tools.
5. If `calendar_settings.feature_enabled` and `active_provider` are set, the calendar booking instructions are appended to the customer prompt.
6. ElevenLabs calls `calendar-agent-tool`, which derives an idempotency key and delegates to the existing tenant-safe `calendar-tool` function.

## Required environment variables

### Admin Netlify site

```text
ELEVENLABS_API_KEY=<existing ElevenLabs API key>
CALENDAR_TOOL_WEBHOOK_SECRET=<same secret as the customer dashboard site>
```

Optional override:

```text
CALENDAR_AGENT_TOOL_URL=https://dashboard.voxera.ch/.netlify/functions/calendar-agent-tool
```

### Customer dashboard Netlify site

```text
CALENDAR_INTEGRATION_ENABLED=true
CALENDAR_ROLLOUT_CUSTOMER_IDS=<customer IDs or * after controlled rollout>
CALENDAR_TOOL_WEBHOOK_SECRET=<strong random secret>
```

The value of `CALENDAR_TOOL_WEBHOOK_SECRET` must be identical on the admin and customer dashboard Netlify sites. Voxera writes it to ElevenLabs as a workspace secret with the `Bearer ` prefix; it is never stored in an agent prompt.

## Rollout procedure

1. Keep `CALENDAR_ROLLOUT_CUSTOMER_IDS` limited to the test customer until end-to-end tests pass.
2. Add the shared webhook secret to the admin Netlify site.
3. Deploy admin and customer dashboard.
4. Trigger an ElevenLabs prompt sync for the test customer.
5. Verify that the sync response contains `calendar_tool_status: configured`.
6. In ElevenLabs, verify that the agent references `manage_voxera_calendar` through `prompt.tool_ids`.
7. Test availability, booking, conflict handling, rescheduling and cancellation.
8. Expand the rollout list only after audit logs and failure handling have been reviewed.

## Safety properties

- The customer is resolved from `system__agent_id`; the LLM does not select a customer ID.
- Calendar writes require an idempotent request ID generated from the ElevenLabs conversation and turn.
- The core calendar function still enforces rollout, active provider, booking rules, buffers and tenant ownership.
- Existing ElevenLabs tool IDs are preserved.
- Legacy `prompt.tools` is not used.
