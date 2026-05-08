const { createClient } = require('@supabase/supabase-js');

// Anrufe die älter als STALE_AFTER_MINUTES sind und noch auf
// incoming/active/analyzing stehen werden auf 'failed' gesetzt.
// ElevenLabs hat 5 Min max Anrufdauer → 6 Min ist sicher.
const STALE_AFTER_MINUTES = 6;

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[cleanup-stale-calls] Missing Supabase env vars');
    return { statusCode: 500, body: 'Config error' };
  }

  const sb = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from('calls')
    .update({ live_status: 'failed', updated_at: new Date().toISOString() })
    .in('live_status', ['incoming', 'active', 'analyzing'])
    .lt('created_at', cutoff)
    .select('id');

  if (error) {
    console.error('[cleanup-stale-calls] Update failed', { error: error.message });
    return { statusCode: 500, body: 'Update failed' };
  }

  const count = (data || []).length;
  console.log('[cleanup-stale-calls] Cleaned up stale calls', {
    count,
    cutoff,
    staleAfterMinutes: STALE_AFTER_MINUTES
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ cleaned: count, cutoff })
  };
};
