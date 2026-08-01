'use strict';

const crypto = require('crypto');
const coreCalendarTool = require('./calendar-tool');

function stableRequestId(body) {
  const explicit = String(body.request_id || '').trim().slice(0, 200);
  if (explicit) return explicit;

  const conversationId = String(body.conversation_id || '').trim().slice(0, 200);
  if (!conversationId) return '';
  const agentTurns = String(body.agent_turns ?? '').trim().slice(0, 40);
  const fingerprint = JSON.stringify({
    conversation_id: conversationId,
    agent_turns: agentTurns,
    action: String(body.action || '').trim().toLowerCase(),
    start: String(body.start || '').trim(),
    end: String(body.end || '').trim(),
    external_event_id: String(body.external_event_id || '').trim()
  });
  return 'elcal_' + crypto.createHash('sha256').update(fingerprint, 'utf8').digest('hex').slice(0, 40);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return coreCalendarTool.handler(event);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_error) { return coreCalendarTool.handler(event); }

  const action = String(body.action || '').trim().toLowerCase();
  if (['book', 'reschedule', 'cancel'].includes(action) && !String(body.request_id || '').trim()) {
    body.request_id = stableRequestId(body);
  }

  return coreCalendarTool.handler({
    ...event,
    body: JSON.stringify(body)
  });
};

exports._test = { stableRequestId };
