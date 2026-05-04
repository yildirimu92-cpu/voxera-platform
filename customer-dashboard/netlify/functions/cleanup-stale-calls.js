// cleanup-stale-calls.js
// Netlify Scheduled Function — läuft alle 5 Minuten (cron: */5 * * * *).
//
// Zweck:
//   Anrufe die in live_status='incoming' stecken geblieben sind werden nach
//   30 Minuten auf live_status='failed' gesetzt. Das passiert wenn ElevenLabs
//   den Anruf nie übernommen hat und deshalb kein post_call_transcription-
//   Webhook gefeuert wurde.
//
// Scope (strikt):
//   NUR Zeilen mit live_status='incoming' AND created_at < NOW()-30min.
//   Kein anderes Feld, kein anderer Status wird angefasst.
//
// Deployment:
//   1. Diese Datei nach netlify/functions/cleanup-stale-calls.js kopieren.
//   2. In netlify.toml eintragen (falls noch nicht vorhanden):
//        [functions."cleanup-stale-calls"]
//          schedule = "*/5 * * * *"
//   3. @netlify/functions muss im package.json stehen:
//        npm install @netlify/functions
//      (prüfen: cat netlify/functions/package.json | grep @netlify/functions)

const { schedule } = require('@netlify/functions');
const { createClient } = require('@supabase/supabase-js');

const STALE_THRESHOLD_MINUTES = 30;

exports.handler = schedule('*/5 * * * *', async () => {
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
    .select('id, call_id, created_at')
    .eq('live_status', 'incoming')
    .lt('created_at', cutoffIso);

  if (selectError) {
    console.error('[cleanup-stale-calls] select failed', { error: selectError.message });
    return { statusCode: 500 };
  }

  if (!stale || stale.length === 0) {
    console.log('[cleanup-stale-calls] no stale records found');
    return { statusCode: 200 };
  }

  console.warn('[cleanup-stale-calls] found stale incoming records', {
    count: stale.length,
    ids: stale.map(r => r.id),
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
});
