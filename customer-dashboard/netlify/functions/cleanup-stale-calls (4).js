// cleanup-stale-calls.js
// Netlify Scheduled Function — Schedule wird in netlify.toml konfiguriert:
//   [functions."cleanup-stale-calls"]
//     schedule = "*/5 * * * *"
//
// Zweck:
//   Anrufe die in live_status='incoming'/'active'/'analyzing' stecken geblieben
//   sind werden nach STALE_THRESHOLD_MINUTES auf live_status='failed' gesetzt.
//   ElevenLabs hat 5 Min max Anrufdauer → 6 Min Threshold ist sicher.
//
// Scope (strikt):
//   NUR Zeilen mit live_status IN ('incoming','active','analyzing')
//   AND created_at < NOW()-6min.
//   Kein anderes Feld, kein anderer Status wird angefasst.

const { createClient } = require('@supabase/supabase-js');

const STALE_THRESHOLD_MINUTES = 6; // ElevenLabs max 5 Min + 1 Min Puffer

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[cleanup-stale-calls] Supabase env missing');
    return { statusCode: 500 };
  }

  const sbAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const cutoffIso = new Date(
    Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000
  ).toISOString();

  // Erst selektieren — Logging der betroffenen IDs vor dem Update.
  const { data: stale, error: selectError } = await sbAdmin
    .from('calls')
    .select('id, call_id, created_at, live_status')
    .in('live_status', ['incoming', 'active', 'analyzing'])
    .lt('created_at', cutoffIso);

  if (selectError) {
    console.error('[cleanup-stale-calls] select failed', { error: selectError.message });
    return { statusCode: 500 };
  }

  if (!stale || stale.length === 0) {
    console.log('[cleanup-stale-calls] no stale records found');
    return { statusCode: 200 };
  }

  console.warn('[cleanup-stale-calls] found stale records', {
    count: stale.length,
    ids: stale.map(r => r.id),
    statuses: stale.map(r => r.live_status),
    cutoff: cutoffIso
  });

  const staleIds = stale.map(r => r.id);

  const { error: updateError } = await sbAdmin
    .from('calls')
    .update({
      live_status: 'failed',
      updated_at: new Date().toISOString()
    })
    .in('id', staleIds);

  if (updateError) {
    console.error('[cleanup-stale-calls] update failed', { error: updateError.message });
    return { statusCode: 500 };
  }

  console.log('[cleanup-stale-calls] marked as failed', {
    count: staleIds.length,
    ids: staleIds
  });

  return { statusCode: 200 };
};
