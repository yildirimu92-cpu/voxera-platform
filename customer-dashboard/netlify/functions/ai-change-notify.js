// ai-change-notify.js
// Netlify Function — sendet Admin-Benachrichtigung wenn Kunde eine AI-Änderungsanfrage stellt
// Verwendet MAKE_MAIL_WEBHOOK (bereits vorhanden)

const MAKE_WEBHOOK = process.env.MAKE_MAIL_WEBHOOK || '';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { customer_id, customer_name, message } = body;
  if (!customer_id || !message) {
    return { statusCode: 400, body: 'Missing required fields' };
  }

  console.log('[ai-change-notify] new request', { customer_id, customer_name });

  if (MAKE_WEBHOOK) {
    try {
      await fetch(MAKE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mail_type: 'ai_change_request',
          customer_id,
          customer_name: customer_name || 'Unbekannt',
          message,
          timestamp: new Date().toISOString(),
          admin_url: 'https://admin.voxera.ch/#ai-setup'
        })
      });
      console.log('[ai-change-notify] Make webhook triggered');
    } catch(e) {
      console.warn('[ai-change-notify] Make webhook failed', { error: e.message });
    }
  } else {
    console.warn('[ai-change-notify] MAKE_MAIL_WEBHOOK not set');
  }

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
