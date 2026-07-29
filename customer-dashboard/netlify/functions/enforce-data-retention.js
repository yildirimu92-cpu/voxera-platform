// enforce-data-retention.js
// Daily retention enforcement for call data.
// Audio is retained by ElevenLabs for 90 days. Raw transcripts and the provider
// conversation reference are removed from Voxera after 90 days. Operational call
// records and summaries are removed after 180 days.
//
// Destructive enforcement is intentionally gated. Enable only after the documented
// production preflight and snapshot have passed.

const { createClient } = require('@supabase/supabase-js');

const TRANSCRIPT_RETENTION_DAYS = 90;
const CALL_RECORD_RETENTION_DAYS = 180;

function cutoffIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}

exports.handler = async () => {
  if (process.env.DATA_RETENTION_ENFORCEMENT_ENABLED !== 'true') {
    console.warn('[enforce-data-retention] disabled; set DATA_RETENTION_ENFORCEMENT_ENABLED=true only after preflight');
    return response(200, { ok: true, enabled: false });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[enforce-data-retention] Supabase env missing');
    return response(500, { ok: false, error: 'retention_configuration_missing' });
  }

  const sbAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const transcriptCutoff = cutoffIso(TRANSCRIPT_RETENTION_DAYS);
  const callRecordCutoff = cutoffIso(CALL_RECORD_RETENTION_DAYS);
  const now = new Date().toISOString();

  const { data: redactedRows, error: redactError } = await sbAdmin
    .from('calls')
    .update({
      transcript: null,
      transcript_json: null,
      elevenlabs_conversation_id: null,
      updated_at: now
    })
    .lt('created_at', transcriptCutoff)
    .or('transcript.not.is.null,transcript_json.not.is.null,elevenlabs_conversation_id.not.is.null')
    .select('id');

  if (redactError) {
    console.error('[enforce-data-retention] transcript redaction failed', { error: redactError.message });
    return response(500, { ok: false, error: 'transcript_retention_failed' });
  }

  const { data: deletedRows, error: deleteError } = await sbAdmin
    .from('calls')
    .delete()
    .lt('created_at', callRecordCutoff)
    .select('id');

  if (deleteError) {
    console.error('[enforce-data-retention] call record deletion failed', { error: deleteError.message });
    return response(500, {
      ok: false,
      error: 'call_record_retention_failed',
      transcripts_redacted: redactedRows?.length || 0
    });
  }

  const result = {
    ok: true,
    enabled: true,
    transcript_retention_days: TRANSCRIPT_RETENTION_DAYS,
    call_record_retention_days: CALL_RECORD_RETENTION_DAYS,
    transcripts_redacted: redactedRows?.length || 0,
    call_records_deleted: deletedRows?.length || 0
  };
  console.log('[enforce-data-retention] completed', result);
  return response(200, result);
};

exports._test = {
  cutoffIso,
  TRANSCRIPT_RETENTION_DAYS,
  CALL_RECORD_RETENTION_DAYS
};
