const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { normalizePhoneE164 } = require('./_lib/phone-normalize'); // [PATCH 2a] Import hinzugefügt

const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET || '';
const MAKE_MAIL_WEBHOOK = process.env.MAKE_MAIL_WEBHOOK || '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

// Zeitfenster für den Stub-Match (caller_phone + called_number + recency).
const FALLBACK_MATCH_WINDOW_MINUTES = 120;

// Toleranz für die HMAC-Timestamp-Prüfung (Replay-Schutz).
const SIGNATURE_TOLERANCE_SECONDS = 30 * 60;

// Polling-Konfiguration für die Nach-Analyse.
// Aggressiver gewählt für niedrige Latenz im Dashboard.
// Total Worst-Case: 2s + 5*3s = 17s (sicher unter Pro-Plan-Timeout 26s).
const POLL_MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 3000;
const POLL_INITIAL_DELAY_MS = 2000;

// ─── Supabase Notification Insert ────────────────────────────────────────────
async function insertNotification(sbAdmin, { customerId, type, title, sub, callId }) {
  if (!customerId) return;
  try {
    const isHot = type === 'hot';
    const notifTitle = isHot
      ? 'Hot Lead — ' + (title || 'Neuer Anruf')
      : title || 'Neuer Anruf';
    await sbAdmin.from('notifications').insert({
      customer_id: customerId,
      type: type || 'call',
      title: notifTitle,
      sub: sub || null,
      call_id: callId || null,
      read_at: null,
      created_at: new Date().toISOString()
    });
    console.log('[elevenlabs-post-call] notification inserted', { customerId, type, callId });
  } catch (e) {
    console.warn('[elevenlabs-post-call] notification insert failed', e.message);
  }
}
// ─── End Notification Insert ──────────────────────────────────────────────────



const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, ElevenLabs-Signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function toStr(v) { return v == null ? '' : String(v).trim(); }

function toBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v == null ? '' : v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function toInt(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseMaybeJsonObject(v) {
  if (!v) return null;
  if (typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v !== 'string') return null;
  try {
    const parsed = JSON.parse(v);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch {
    return null;
  }
}

function buildShortSummary(text, maxLen = 140) {
  const clean = toStr(text).replace(/\s+/g, ' ');
  if (!clean) return '';
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1).trimEnd() + '…';
}

function pickFirstString(candidates) {
  for (const candidate of candidates) {
    const value = toStr(candidate?.value !== undefined ? candidate.value : candidate);
    if (value) return value;
  }
  return '';
}

function detectLang(text) {
  const sample = toStr(text).toLowerCase();
  if (!sample) return 'unknown';
  if (/[äöüß]/.test(sample) || /\b(der|die|das|und|mit|für|nicht|ein|eine|anrufer|rückruf|offerte|gespräch)\b/.test(sample)) return 'de';
  if (/\b(the|and|from|with|customer|caller|requested|summary|call)\b/.test(sample)) return 'en';
  return 'unknown';
}

// ─── HMAC Signature Verification (Stripe-Style) ─────────────────────────────
function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return { ok: false, reason: 'missing_input' };

  const parts = signatureHeader.split(',').reduce((acc, p) => {
    const idx = p.indexOf('=');
    if (idx > 0) {
      const k = p.slice(0, idx).trim();
      const v = p.slice(idx + 1).trim();
      acc[k] = v;
    }
    return acc;
  }, {});

  const ts = parseInt(parts.t, 10);
  const sig = parts.v0;
  if (!ts || !sig) return { ok: false, reason: 'malformed_header' };

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp_outside_tolerance', diff: nowSec - ts };
  }

  const signedPayload = `${ts}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  if (sig.length !== expected.length) return { ok: false, reason: 'signature_length_mismatch' };

  try {
    const ok = crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    return ok ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
  } catch (e) {
    return { ok: false, reason: 'comparison_error' };
  }
}

// Holt den Wert aus einem data_collection_results-Eintrag.
// Defensiv: matched auch bei Whitespace oder abweichender Schreibweise im Identifier.
function pickDC(dcResults, key) {
  if (!dcResults || typeof dcResults !== 'object') return null;

  let entry = dcResults[key];

  if (entry == null) {
    const target = key.toLowerCase().trim();
    for (const k of Object.keys(dcResults)) {
      if (k.toLowerCase().trim() === target) {
        entry = dcResults[k];
        break;
      }
    }
  }

  if (entry == null) return null;
  if (typeof entry === 'object' && 'value' in entry) return entry.value;
  return entry;
}

function extractPhoneInfo(data) {
  const meta = data.metadata || {};
  const phone = meta.phone_call || {};

  return {
    callerPhone:
      toStr(phone.external_number) ||
      toStr(phone.from_number) ||
      toStr(meta.external_number) ||
      '',
    calledNumber:
      toStr(phone.agent_number) ||
      toStr(phone.to_number) ||
      toStr(meta.called_number) ||
      '',
    twilioCallSid: toStr(phone.call_sid) || ''
  };
}

// Baut Update-Payload aus ElevenLabs `data` Objekt
// (gleiches Schema in Webhook-Payload und GET-Conversation API-Response).
function buildUpdatePayloadFromData(data, elevenLabsConvId, liveStatus) {
  const meta = data.metadata || {};
  const analysis = data.analysis || {};
  const dc = analysis.data_collection_results || {};
  const extractedData = analysis.extracted_data || data.extracted_data || {};
  const collectedData = analysis.collected_data || data.collected_data || {};
  const dynamicVariables = analysis.dynamic_variables || data.dynamic_variables || {};
  const variables = data.variables || {};
  const callObj = data.call || {};
  const resultObj = data.result || {};

  const updatePayload = {};

  const callerName = pickFirstString([
    pickDC(dc, 'caller_name'), pickDC(dc, 'name'), pickDC(dc, 'full_name'), pickDC(dc, 'customer_name'), pickDC(dc, 'contact_name'),
    extractedData.caller_name, extractedData.name, extractedData.full_name, extractedData.customer_name, extractedData.contact_name,
    collectedData.caller_name, collectedData.name, collectedData.full_name, collectedData.customer_name, collectedData.contact_name,
    dynamicVariables.caller_name, dynamicVariables.name, dynamicVariables.full_name,
    variables.caller_name, variables.name, variables.full_name,
    callObj.caller_name, callObj.name, callObj.full_name,
    resultObj.caller_name, resultObj.name, resultObj.full_name
  ]);
  if (callerName) updatePayload.caller_name = callerName;

  const callSummary = pickFirstString([
    pickDC(dc, 'call_summary'), pickDC(dc, 'summary'),
    extractedData.call_summary, extractedData.summary,
    collectedData.call_summary, collectedData.summary,
    dynamicVariables.call_summary, dynamicVariables.summary,
    variables.call_summary, variables.summary,
    callObj.call_summary, callObj.summary,
    resultObj.call_summary, resultObj.summary,
    analysis.call_summary, analysis.summary, analysis.transcript_summary, analysis.conversation_summary
  ]);
  if (callSummary) updatePayload.call_summary = callSummary;

  const callSummaryShort = pickFirstString([
    pickDC(dc, 'call_summary_short'), pickDC(dc, 'short_summary'), pickDC(dc, 'summary_short'),
    extractedData.call_summary_short, extractedData.short_summary,
    collectedData.call_summary_short, collectedData.short_summary,
    dynamicVariables.call_summary_short, dynamicVariables.short_summary,
    variables.call_summary_short, variables.short_summary,
    analysis.call_summary_short, analysis.short_summary,
    resultObj.call_summary_short
  ]);
  if (callSummaryShort) updatePayload.call_summary_short = callSummaryShort;
  if (!updatePayload.call_summary_short && updatePayload.call_summary) updatePayload.call_summary_short = buildShortSummary(updatePayload.call_summary, 140);

  const duration = toInt(meta.call_duration_secs);
  if (duration !== null) updatePayload.duration_seconds = duration;
  const callbackRequestedRaw = pickDC(dc, 'callback_requested');
  if (callbackRequestedRaw !== null && callbackRequestedRaw !== undefined && callbackRequestedRaw !== '') updatePayload.callback_requested = toBool(callbackRequestedRaw);
  const leadQuality = toStr(pickDC(dc, 'lead_quality'));
  if (leadQuality) updatePayload.lead_quality = leadQuality;
  const category = toStr(pickDC(dc, 'category'));
  if (category && category.toLowerCase() !== 'inbound') updatePayload.category = category;
  const nextAction = toStr(pickDC(dc, 'next_action'));
  if (nextAction) updatePayload.next_action = nextAction;
  const priority = toStr(pickDC(dc, 'priority'));
  if (priority) updatePayload.priority = priority;
  const intent = toStr(pickDC(dc, 'intent'));
  if (intent) updatePayload.intent = intent;
  const urgency = toStr(pickDC(dc, 'urgency'));
  if (urgency) updatePayload.urgency = urgency;
  const companyName = toStr(pickDC(dc, 'company_name'));
  if (companyName) updatePayload.company_name = companyName;

  if (Array.isArray(data.transcript) && data.transcript.length > 0) {
    updatePayload.transcript_json = data.transcript;
    updatePayload.transcript = data.transcript.map(t => `${toStr(t.role)}: ${toStr(t.message)}`).filter(line => line.trim() !== ':').join('\\n');
  }

  updatePayload.elevenlabs_conversation_id = elevenLabsConvId;
  updatePayload.dashboard_status = 'new';
  if (liveStatus) updatePayload.live_status = liveStatus;
  updatePayload.updated_at = new Date().toISOString();

  const summaryLang = detectLang(callSummary);
  console.log('[elevenlabs-post-call] mapped data payload', {
    payloadKeys: Object.keys(data || {}),
    hasCallerNameCandidate: Boolean(callerName),
    hasCallerPhoneCandidate: Boolean(meta?.phone_call?.external_number || meta?.external_number),
    hasSummaryCandidate: Boolean(callSummary),
    summarySource: callSummary ? 'dc/extracted/collected/dynamic/analysis' : null,
    callerNameSource: callerName ? 'dc/extracted/collected/dynamic/variables' : null,
    summaryLang,
    updatePayloadKeys: Object.keys(updatePayload)
  });

  return updatePayload;
}

async function fetchConversation(conversationId) {
  if (!ELEVENLABS_API_KEY) return { ok: false, reason: 'no_api_key' };

  const url = `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`;
  try {
    const resp = await fetch(url, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY }
    });
    if (!resp.ok) {
      return { ok: false, status: resp.status, reason: 'http_error' };
    }
    const json = await resp.json();
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, reason: 'fetch_error', error: e.message };
  }
}

// Heuristik: Sind die "späten" Analyse-Felder gefüllt?
function isAnalysisComplete(payload) {
  return (
    payload.lead_quality !== undefined &&
    payload.priority !== undefined &&
    payload.call_summary !== undefined
  );
}

// ─── Tool-Call Handler ───────────────────────────────────────────────────────
// Handles direct calls from Lara's send_to_voxera tool
async function handleToolCall(body, event) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return response(500, { error: 'Supabase env missing' });
  }
  const sbAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const callerPhone  = toStr(body.phone_number  || body.caller_phone || '');
  const calledNumber = toStr(body.called_number || '');
  const elevenLabsConvId = toStr(body.call_sid || body.elevenlabs_conversation_id || '');

  // Build update payload from tool body
  const updatePayload = {};
  const callerNameCandidate = pickFirstString([body.caller_name, body.name, body.full_name, body.customer_name, body.contact_name, body.callerName, body.caller?.name]);
  if (callerNameCandidate) updatePayload.caller_name = callerNameCandidate;
  if (body.company_name)       updatePayload.company_name       = toStr(body.company_name);
  const bodyCallSummary = toStr(
    body.call_summary ||
    body.summary ||
    body.callSummary ||
    body.conversation_summary ||
    body.transcript_summary
  );
  if (bodyCallSummary) updatePayload.call_summary = bodyCallSummary;

  const bodyCallSummaryShort = toStr(
    body.call_summary_short ||
    body.short_summary ||
    body.summary_short
  );
  if (bodyCallSummaryShort) updatePayload.call_summary_short = bodyCallSummaryShort;
  if (!updatePayload.call_summary_short && updatePayload.call_summary) updatePayload.call_summary_short = buildShortSummary(updatePayload.call_summary, 140);
  if (body.category)           updatePayload.category           = toStr(body.category);
  if (body.lead_quality)       updatePayload.lead_quality       = toStr(body.lead_quality);
  if (body.next_action)        updatePayload.next_action        = toStr(body.next_action);
  if (body.priority)           updatePayload.priority           = toStr(body.priority);
  if (body.intent)             updatePayload.intent             = toStr(body.intent);
  if (body.urgency)            updatePayload.urgency            = toStr(body.urgency);
  if (body.transcript)         updatePayload.transcript         = toStr(body.transcript);
  if (body.duration_seconds !== undefined) {
    updatePayload.duration_seconds = toInt(body.duration_seconds);
  }
  const callbackRaw = body.callback_requested;
  if (callbackRaw !== undefined && callbackRaw !== null && callbackRaw !== '') {
    updatePayload.callback_requested = toBool(callbackRaw);
  }
  if (elevenLabsConvId) updatePayload.elevenlabs_conversation_id = elevenLabsConvId;
  updatePayload.live_status   = 'completed';
  updatePayload.dashboard_status = 'new';
  updatePayload.updated_at    = new Date().toISOString();

  // Match existing call record
  let matchedId = null;
  let matchStrategy = null;

  // Strategy 1: by elevenlabs_conversation_id
  if (elevenLabsConvId) {
    const { data: ex } = await sbAdmin.from('calls').select('id')
      .eq('elevenlabs_conversation_id', elevenLabsConvId).maybeSingle();
    if (ex?.id) { matchedId = ex.id; matchStrategy = 'conv_id'; }
  }

  // Strategy 2: by caller_phone + called_number (recent)
  if (!matchedId && callerPhone && calledNumber) {
    const cutoff = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    const { data: candidates } = await sbAdmin.from('calls').select('id, created_at')
      .eq('caller_phone', callerPhone).eq('called_number', calledNumber)
      .gte('created_at', cutoff).order('created_at', { ascending: false }).limit(1);
    if (candidates?.[0]?.id) { matchedId = candidates[0].id; matchStrategy = 'phone_match'; }
  }

  if (matchedId) {
    const { error } = await sbAdmin.from('calls').update(updatePayload).eq('id', matchedId);
    if (error) {
      console.error('[elevenlabs-post-call] tool-call update failed', { matchedId, error: error.message });
      return response(500, { error: 'Update failed' });
    }
    console.log('[elevenlabs-post-call] tool-call update ok', { matchedId, matchStrategy });
  } else {
    // Insert new record
    let customerId = null;
    if (calledNumber) {
      const { data: c } = await sbAdmin.from('customers').select('id')
        .eq('voxera_number', calledNumber).maybeSingle();
      customerId = c?.id || null;
    }
    const { error: insertError } = await sbAdmin.from('calls').insert({
      caller_phone: callerPhone || null,
      called_number: calledNumber || null,
      voxera_number: calledNumber || null,
      customer_id: customerId,
      direction: 'inbound',
      created_at: new Date().toISOString(),
      ...updatePayload
    });
    if (insertError) {
      console.error('[elevenlabs-post-call] tool-call insert failed', { error: insertError.message });
      return response(500, { error: 'Insert failed' });
    }
    console.log('[elevenlabs-post-call] tool-call insert ok');
    matchStrategy = 'insert';
  }

  // Trigger Make mail webhook
  if (MAKE_MAIL_WEBHOOK) {
    try {
      await fetch(MAKE_MAIL_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elevenlabs_conversation_id: elevenLabsConvId,
          called_number: calledNumber,
          caller_name: updatePayload.caller_name || '',
          caller_phone: callerPhone,
          call_summary: updatePayload.call_summary || '',
          call_summary_short: updatePayload.call_summary_short || '',
          callback_requested: updatePayload.callback_requested === true,
          category: updatePayload.category || '',
          lead_quality: updatePayload.lead_quality || '',
          next_action: updatePayload.next_action || '',
          priority: updatePayload.priority || '',
          duration_seconds: updatePayload.duration_seconds || null
        })
      });
    } catch (e) {
      console.warn('[elevenlabs-post-call] tool-call mail webhook failed', { error: e.message });
    }
  }

  // ── Notification in Supabase anlegen ──────────────────────────────────────
  try {
    // customer_id aus gematchtem Record oder via calledNumber
    let notifCustomerId = null;
    if (matchedId) {
      const { data: matchedRec } = await sbAdmin.from('calls').select('customer_id').eq('id', matchedId).maybeSingle();
      notifCustomerId = matchedRec?.customer_id || null;
    }
    if (!notifCustomerId && calledNumber) {
      const { data: c } = await sbAdmin.from('customers').select('id').eq('voxera_number', calledNumber).maybeSingle();
      notifCustomerId = c?.id || null;
    }
    const isHot = String(updatePayload.lead_quality || '').toLowerCase() === 'hot';
    const callerDisplay = toStr(updatePayload.caller_name) || callerPhone || 'Unbekannte Nummer';
    const companyDisplay = toStr(updatePayload.company_name || '');
    await insertNotification(sbAdmin, {
      customerId: notifCustomerId,
      type: isHot ? 'hot' : 'call',
      title: callerDisplay,
      sub: companyDisplay
        ? companyDisplay + (updatePayload.category ? ' · ' + updatePayload.category : '')
        : (updatePayload.category || ''),
      callId: matchedId || null
    });
  } catch (e) {
    console.warn('[elevenlabs-post-call] tool-call notification error', e.message);
  }

  return response(200, { success: true, message: 'Das Anliegen wurde erfolgreich aufgenommen.' });
}
// ─── End Tool-Call Handler ───────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method not allowed' });
  }

  let rawBody = event.body || '';
  if (event.isBase64Encoded) {
    rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
  }

  if (!WEBHOOK_SECRET) {
    console.error('[elevenlabs-post-call] ELEVENLABS_WEBHOOK_SECRET env not set');
    return response(500, { error: 'Server config error' });
  }

  let body = {};
  try {
    body = JSON.parse(rawBody || '{}');
  } catch (e) {
    return response(400, { error: 'Invalid JSON' });
  }

  const sigHeader =
    (event.headers &&
      (event.headers['elevenlabs-signature'] ||
        event.headers['ElevenLabs-Signature'])) ||
    '';

  // ─── Dual-Path Authentication ────────────────────────────────────────────
  // Path A: Post-Call Webhook (ElevenLabs automatic) → HMAC Signature
  // Path B: Tool-Call (Lara calls send_to_voxera) → webhook_secret in body
  const isToolCall = !sigHeader && (
    body.webhook_secret ||
    body.call_summary !== undefined ||
    body.summary !== undefined ||
    body.callSummary !== undefined
  );

  if (isToolCall) {
    // Path B: Tool-Call — validate via webhook_secret in body
    const bodySecret = toStr(body.webhook_secret);
    if (!bodySecret || bodySecret !== WEBHOOK_SECRET) {
      console.warn('[elevenlabs-post-call] tool-call secret mismatch');
      return response(401, { error: 'Invalid webhook_secret' });
    }
    console.log('[elevenlabs-post-call] tool-call path accepted', {
      toolCallReceived: true,
      payloadKeys: Object.keys(body || {}),
      hasCallerNameCandidate: Boolean(body.caller_name || body.name || body.full_name || body.customer_name || body.contact_name || body.callerName || body.caller?.name),
      hasCallerPhoneCandidate: Boolean(body.phone_number || body.caller_phone),
      hasSummaryCandidate: Boolean(body.call_summary || body.summary || body.callSummary),
      responseStatus: 200
    });
    // Handle tool-call directly — build call record from tool parameters
    return await handleToolCall(body, event);
  }

  // Path A: Post-Call Webhook — validate via HMAC signature
  const sigCheck = verifySignature(rawBody, sigHeader, WEBHOOK_SECRET);
  if (!sigCheck.ok) {
    console.warn('[elevenlabs-post-call] signature verification failed', {
      reason: sigCheck.reason
    });
    return response(401, { error: 'Invalid signature' });
  }

  if (body.type !== 'post_call_transcription') {
    console.log('[elevenlabs-post-call] ignored event type', { type: body.type });
    return response(200, { success: true, ignored: true, type: body.type });
  }

  const data = body.data || {};
  const rawToolCalls = data.tool_calls || data.toolCalls || body.tool_calls || body.toolCalls || [];
  const sendToVoxeraCall = Array.isArray(rawToolCalls)
    ? rawToolCalls.find(tc => toStr(tc?.name || tc?.tool_name || tc?.function?.name) === 'send_to_voxera')
    : null;
  const parsedToolArgs = parseMaybeJsonObject(
    sendToVoxeraCall?.arguments ||
    sendToVoxeraCall?.args ||
    sendToVoxeraCall?.function?.arguments ||
    sendToVoxeraCall?.tool_call?.arguments
  ) || {};

  const elevenLabsConvId = toStr(data.conversation_id);
  const { callerPhone, calledNumber, twilioCallSid } = extractPhoneInfo(data);

  if (!elevenLabsConvId) {
    console.warn('[elevenlabs-post-call] no conversation_id in payload');
    return response(400, { error: 'conversation_id required' });
  }

  console.log('[elevenlabs-post-call] received', {
    elevenLabsConvId,
    payloadKeys: Object.keys(body || {}),
    dataKeys: Object.keys(data || {}),
    analysisKeys: Object.keys((data.analysis || {})),
    metadataKeys: Object.keys((data.metadata || {})),
    toolCallKeys: Array.isArray(rawToolCalls) ? rawToolCalls.map(tc => Object.keys(tc || {})) : [],
    hasToolCall: Boolean(sendToVoxeraCall),
    hasToolArgs: Object.keys(parsedToolArgs).length > 0,
    hasCallerNameCandidate: Boolean(
      parsedToolArgs.caller_name || parsedToolArgs.name || parsedToolArgs.full_name || parsedToolArgs.customer_name
    ),
    hasSummaryCandidate: Boolean(
      parsedToolArgs.call_summary || parsedToolArgs.summary || parsedToolArgs.transcript_summary
    ),
    hasShortSummaryCandidate: Boolean(
      parsedToolArgs.call_summary_short || parsedToolArgs.short_summary || parsedToolArgs.summary_short
    ),
    hasTranscript: Array.isArray(data.transcript) && data.transcript.length > 0,
    hasTranscriptJson: Array.isArray(data.transcript) && data.transcript.length > 0,
    callerPhonePresent: Boolean(callerPhone),
    calledNumberPresent: Boolean(calledNumber),
    twilioCallSidPresent: Boolean(twilioCallSid),
    durationPresent: Boolean((data.metadata || {}).call_duration_secs)
  });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return response(500, { error: 'Supabase env missing' });
  }
  const sbAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // ─── Initial-Payload aus Webhook-Daten ──────────────────────────────────
  // Status 'analyzing': der Anruf ist beendet, Daten werden gerade vervollständigt.
  let updatePayload = buildUpdatePayloadFromData(data, elevenLabsConvId, 'analyzing');
  if (!updatePayload.caller_name) {
    const toolCallerName = toStr(
      parsedToolArgs.caller_name ||
      parsedToolArgs.name ||
      parsedToolArgs.full_name ||
      parsedToolArgs.customer_name
    );
    if (toolCallerName) updatePayload.caller_name = toolCallerName;
  }
  if (!updatePayload.call_summary) {
    const toolSummary = toStr(
      parsedToolArgs.call_summary ||
      parsedToolArgs.summary ||
      parsedToolArgs.transcript_summary ||
      parsedToolArgs.conversation_summary
    );
    if (toolSummary) updatePayload.call_summary = toolSummary;
  }
  if (!updatePayload.call_summary_short) {
    const toolSummaryShort = toStr(
      parsedToolArgs.call_summary_short ||
      parsedToolArgs.short_summary ||
      parsedToolArgs.summary_short
    );
    if (toolSummaryShort) {
      updatePayload.call_summary_short = toolSummaryShort;
    } else if (updatePayload.call_summary) {
      updatePayload.call_summary_short = buildShortSummary(updatePayload.call_summary, 140);
    }
  }

  // ─── Match-Strategie (4-stufig) ─────────────────────────────────────────
  let matchedRecordId = null;
  let matchStrategy = null;

  // Strategy 1: existing elevenlabs_conversation_id (idempotent retry)
  {
    const { data: existing, error } = await sbAdmin
      .from('calls')
      .select('id')
      .eq('elevenlabs_conversation_id', elevenLabsConvId)
      .maybeSingle();
    if (error) {
      console.error('[elevenlabs-post-call] match by conv_id failed', {
        elevenLabsConvId, error: error.message
      });
    }
    if (existing?.id) {
      matchedRecordId = existing.id;
      matchStrategy = 'elevenlabs_conversation_id';
    }
  }

  // Strategy 2: Twilio CallSid direkt
  if (!matchedRecordId && twilioCallSid) {
    const { data: existing, error } = await sbAdmin
      .from('calls')
      .select('id')
      .eq('call_id', twilioCallSid)
      .is('elevenlabs_conversation_id', null)
      .maybeSingle();
    if (error) {
      console.error('[elevenlabs-post-call] match by twilio call_sid failed', {
        twilioCallSid, error: error.message
      });
    }
    if (existing?.id) {
      matchedRecordId = existing.id;
      matchStrategy = 'twilio_call_sid';
    }
  }

  // Strategy 3: Stub-Match via caller_phone + called_number + Recency
  if (!matchedRecordId && callerPhone && calledNumber) {
    const cutoffIso = new Date(
      Date.now() - FALLBACK_MATCH_WINDOW_MINUTES * 60 * 1000
    ).toISOString();
    const { data: candidates, error } = await sbAdmin
      .from('calls')
      .select('id, created_at')
      .eq('caller_phone', callerPhone)
      .eq('called_number', calledNumber)
      .is('elevenlabs_conversation_id', null)
      .gte('created_at', cutoffIso)
      .order('created_at', { ascending: false })
      .limit(2);

    if (error) {
      console.error('[elevenlabs-post-call] stub-match query failed', { error: error.message });
    } else if (candidates && candidates.length === 1) {
      matchedRecordId = candidates[0].id;
      matchStrategy = 'twilio_stub';
    } else if (candidates && candidates.length > 1) {
      matchedRecordId = candidates[0].id;
      matchStrategy = 'twilio_stub_ambiguous_picked_latest';
      console.warn('[elevenlabs-post-call] multiple stub candidates, picked latest', {
        elevenLabsConvId, callerPhone, calledNumber, candidateCount: candidates.length
      });
    }
  }

  let recordId = matchedRecordId;
  let initialUpdateOk = false;

  if (matchedRecordId) {
    const { error: updateError } = await sbAdmin
      .from('calls')
      .update(updatePayload)
      .eq('id', matchedRecordId);
    if (updateError) {
      console.error('[elevenlabs-post-call] initial update failed', {
        elevenLabsConvId, matchedRecordId, strategy: matchStrategy, error: updateError.message
      });
    } else {
      console.log('[elevenlabs-post-call] initial update done', {
        elevenLabsConvId, id: matchedRecordId, strategy: matchStrategy
      });
      initialUpdateOk = true;
    }
  }

  // Strategy 4: Fallback INSERT
  if (!initialUpdateOk && !matchedRecordId) {
    console.warn('[elevenlabs-post-call] no record matched, inserting fresh', {
      elevenLabsConvId, callerPhone, calledNumber
    });

    // ─── [PATCH 2b] Customer-Lookup mit Normalisierungs-Fallback ────────────
    // Vorher: nur exact match → customer_id = null bei Formatabweichungen.
    // Jetzt: erst exact match, dann Kandidaten-Loop mit normalizePhoneE164
    // (identische Logik wie in twilio-inbound-router).
    let customerId = null;
    if (calledNumber) {
      // Versuch 1: Exact match
      const { data: exactCustomer } = await sbAdmin
        .from('customers')
        .select('id, voxera_number')
        .eq('voxera_number', calledNumber)
        .maybeSingle();
      customerId = exactCustomer?.id || null;

      // Versuch 2: Normalisierungs-Fallback
      if (!customerId) {
        const { data: candidates } = await sbAdmin
          .from('customers')
          .select('id, voxera_number')
          .not('voxera_number', 'is', null)
          .limit(5000);
        const matched = (candidates || []).find(
          row => normalizePhoneE164(row.voxera_number).normalized === calledNumber
        );
        customerId = matched?.id || null;
        if (customerId) {
          console.log('[elevenlabs-post-call] strategy4 customer found via normalization fallback', {
            calledNumber, customerId
          });
        } else {
          console.warn('[elevenlabs-post-call] strategy4 customer NOT found', { calledNumber });
        }
      }
    }
    // ─── [END PATCH 2b] ──────────────────────────────────────────────────────

    const insertPayload = {
      call_id: twilioCallSid || null,
      elevenlabs_conversation_id: elevenLabsConvId,
      customer_id: customerId,
      caller_phone: callerPhone || null,
      called_number: calledNumber || null,
      voxera_number: calledNumber || null,
      direction: 'inbound',
      created_at: new Date().toISOString(),
      ...updatePayload
    };

    const { data: inserted, error: insertError } = await sbAdmin
      .from('calls')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertError) {
      console.error('[elevenlabs-post-call] fallback insert failed', {
        elevenLabsConvId, error: insertError.message
      });
      return response(500, { error: 'Call konnte nicht gespeichert werden' });
    }
    console.log('[elevenlabs-post-call] fallback insert success', { elevenLabsConvId });
    matchStrategy = 'fallback_insert';
    recordId = inserted?.id;
    initialUpdateOk = true;
  }

  // ─── Polling: API abfragen bis Analyse vollständig ─────────────────────
  // Nach jedem erfolgreichen API-Call wird sofort ein UPDATE geschrieben,
  // damit das Dashboard den Anruf "wachsen" sieht via Realtime.
  let finalPayload = updatePayload;
  let pollStatus = 'not_attempted';

  if (initialUpdateOk && recordId && ELEVENLABS_API_KEY) {
    if (isAnalysisComplete(updatePayload)) {
      pollStatus = 'webhook_already_complete';
      // Direkt auf 'completed' setzen
      await sbAdmin
        .from('calls')
        .update({ live_status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', recordId);
      console.log('[elevenlabs-post-call] webhook payload already complete, set live_status=completed');
    } else {
      console.log('[elevenlabs-post-call] starting polling', {
        elevenLabsConvId, missingFields: {
          lead_quality: updatePayload.lead_quality === undefined,
          priority: updatePayload.priority === undefined,
          call_summary: updatePayload.call_summary === undefined
        }
      });

      await sleep(POLL_INITIAL_DELAY_MS);

      let analysisCompleteSeen = false;

      for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
        const apiResult = await fetchConversation(elevenLabsConvId);
        if (!apiResult.ok) {
          console.warn('[elevenlabs-post-call] api fetch failed', {
            attempt, reason: apiResult.reason, status: apiResult.status
          });
        } else {
          const complete = (() => {
            const tmp = buildUpdatePayloadFromData(apiResult.data, elevenLabsConvId, 'analyzing');
            return isAnalysisComplete(tmp);
          })();

          // Bei letztem erfolgreichem Versuch oder wenn complete: setze live_status='completed'
          const liveStatus = complete ? 'completed' : 'analyzing';
          const polledPayload = buildUpdatePayloadFromData(apiResult.data, elevenLabsConvId, liveStatus);

          // Sofortiges UPDATE — Dashboard sieht den Fortschritt live
          const { error: progressUpdateError } = await sbAdmin
            .from('calls')
            .update(polledPayload)
            .eq('id', recordId);
          if (progressUpdateError) {
            console.error('[elevenlabs-post-call] progress update failed', {
              attempt, error: progressUpdateError.message
            });
          } else {
            console.log('[elevenlabs-post-call] progress update', {
              attempt, complete, fieldCount: Object.keys(polledPayload).length
            });
          }

          finalPayload = polledPayload;

          if (complete) {
            analysisCompleteSeen = true;
            pollStatus = `complete_after_${attempt}_attempts`;
            break;
          }
        }

        if (attempt < POLL_MAX_ATTEMPTS) {
          await sleep(POLL_INTERVAL_MS);
        } else if (!analysisCompleteSeen) {
          pollStatus = 'max_attempts_reached_incomplete';
          console.warn('[elevenlabs-post-call] polling exhausted', { elevenLabsConvId });
          // Auch wenn nicht complete: live_status auf 'completed' setzen,
          // sonst bleibt der Anruf im Dashboard ewig auf "analyzing"
          await sbAdmin
            .from('calls')
            .update({ live_status: 'completed', updated_at: new Date().toISOString() })
            .eq('id', recordId);
        }
      }
    }
  } else if (!ELEVENLABS_API_KEY) {
    console.warn('[elevenlabs-post-call] ELEVENLABS_API_KEY not set, skipping polling');
    pollStatus = 'no_api_key';
    // Ohne API-Key: gleich auf 'completed' setzen, Webhook-Daten sind alles was wir haben
    if (recordId) {
      await sbAdmin
        .from('calls')
        .update({ live_status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', recordId);
    }
  }

  // ─── Trigger Mail via Make.com (mit den finalen Daten) ─────────────────
  if (initialUpdateOk && MAKE_MAIL_WEBHOOK) {
    try {
      await fetch(MAKE_MAIL_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elevenlabs_conversation_id: elevenLabsConvId,
          called_number: calledNumber,
          caller_name: finalPayload.caller_name || '',
          caller_phone: callerPhone,
          call_summary: finalPayload.call_summary || '',
          call_summary_short: finalPayload.call_summary_short || '',
          callback_requested: finalPayload.callback_requested === true,
          category: finalPayload.category || '',
          lead_quality: finalPayload.lead_quality || '',
          next_action: finalPayload.next_action || '',
          priority: finalPayload.priority || '',
          duration_seconds: finalPayload.duration_seconds || null
        })
      });
      console.log('[elevenlabs-post-call] mail webhook triggered', { elevenLabsConvId });
    } catch (e) {
      console.warn('[elevenlabs-post-call] mail webhook failed', { error: e.message });
    }
  }

  // ── Notification in Supabase anlegen (Post-Call Webhook) ──────────────────
  if (initialUpdateOk && recordId) {
    try {
      // customer_id aus gematchtem Record laden
      const { data: callRec } = await sbAdmin.from('calls').select('customer_id, caller_name, caller_phone, company_name, category, lead_quality').eq('id', recordId).maybeSingle();
      if (callRec && callRec.customer_id) {
        const isHot = String(callRec.lead_quality || '').toLowerCase() === 'hot';
        const callerDisplay = callRec.caller_name || callRec.caller_phone || 'Unbekannte Nummer';
        const companyDisplay = callRec.company_name || '';
        await insertNotification(sbAdmin, {
          customerId: callRec.customer_id,
          type: isHot ? 'hot' : 'call',
          title: callerDisplay,
          sub: companyDisplay
            ? companyDisplay + (callRec.category ? ' · ' + callRec.category : '')
            : (callRec.category || ''),
          callId: recordId
        });
      }
    } catch (e) {
      console.warn('[elevenlabs-post-call] post-call notification error', e.message);
    }
  }

  return response(200, {
    success: true,
    updated: initialUpdateOk,
    matchStrategy: matchStrategy || 'none',
    pollStatus
  });
};
