const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const { requireAdminCaller } = require('./_lib/require-admin');
const { createOutboxEvent, markOutboxFailed, markOutboxSent } = require('./_lib/webhook-outbox');
const { ensureOfferPublicToken, derivePublicOfferAcceptanceUrl, derivePublicOfferPdfUrl, resolvePublicExpiryFromOffer } = require('./_lib/offer-public');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const response = (statusCode, payload) => ({ statusCode, headers: corsHeaders, body: JSON.stringify(payload) });

const moneyChf = (value) => `CHF ${Number(value || 0).toFixed(2)}`;
const formatDate = (value) => {
  if (!value) return '—';
  try { return new Date(value).toLocaleDateString('de-CH'); } catch (_) { return String(value); }
};

function buildOfferEmail({ offer, subject, acceptanceUrl, pdfUrl }) {
  const recurring = String(offer.billing_cycle || 'monthly') === 'yearly' ? Number(offer.yearly_price || 0) : Number(offer.monthly_price || 0);
  const addOns = offer.add_ons || {};
  const addOnsTotal = Number(addOns.additional_numbers || 0) + Number(addOns.sms_alerts || 0) + Number(addOns.custom_ai_setup || 0);
  const discount = Number(offer.discount_amount || 0) + (recurring * (Number(offer.discount_percent || 0) / 100));
  const hasDiscount = discount > 0.000001;
  const total = Math.max(0, Number(offer.total || 0));
  const intro = String(offer?.offer_text?.introduction || 'Vielen Dank für Ihr Interesse an Voxera. Nachfolgend erhalten Sie Ihre Offerte.').trim();
  const html = `
  <div style="background:#f3f6fb;padding:24px 12px;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #dde5f1;border-radius:16px;overflow:hidden;">
      <div style="padding:20px 24px;background:linear-gradient(120deg,#eff6ff,#ffffff);border-bottom:1px solid #e5edf8;">
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;font-weight:700;">Voxera Offerte</div>
        <h1 style="margin:8px 0 4px;font-size:24px;line-height:1.2;">${offer.offer_number || 'Offerte'}</h1>
        <div style="font-size:13px;color:#334155;">Gültig bis: ${formatDate(offer.valid_until)}</div>
      </div>
      <div style="padding:24px;display:grid;gap:16px;">
        <p style="margin:0;font-size:14px;line-height:1.6;">${intro}</p>
        <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;">
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:8px;">Preisübersicht</div>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:6px 0;color:#475569;">Einmalige Einrichtung</td><td style="padding:6px 0;text-align:right;font-weight:700;">${moneyChf(offer.setup_fee)}</td></tr>
            <tr><td style="padding:6px 0;color:#475569;">Laufende Kosten</td><td style="padding:6px 0;text-align:right;font-weight:700;">${moneyChf(recurring)}</td></tr>
            <tr><td style="padding:6px 0;color:#475569;">Zusatzoptionen</td><td style="padding:6px 0;text-align:right;font-weight:700;">${moneyChf(addOnsTotal)}</td></tr>
            ${hasDiscount ? `<tr><td style="padding:6px 0;color:#475569;">Rabatt</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#166534;">− ${moneyChf(discount)}</td></tr>` : ''}
            <tr><td style="padding:8px 0;border-top:1px solid #e2e8f0;font-weight:700;">Gesamt</td><td style="padding:8px 0;border-top:1px solid #e2e8f0;text-align:right;font-size:16px;font-weight:800;">${moneyChf(total)}</td></tr>
          </table>
        </div>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#334155;">Für Rückfragen oder gewünschte Anpassungen antworten Sie bitte direkt auf diese E-Mail.</p>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
          ${acceptanceUrl ? `<a href="${acceptanceUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;">Offerte bestätigen</a>` : ''}
          ${pdfUrl ? `<a href="${pdfUrl}" style="display:inline-block;background:#e2e8f0;color:#0f172a;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;">PDF ansehen</a>` : ''}
        </div>
      </div>
    </div>
  </div>`;

  return { subject: subject || `Ihre Voxera Offerte ${offer.offer_number || ''}`.trim(), html };
}

async function sendOfferEmail({ to, offer, subject, acceptanceUrl, pdfUrl }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || 'Voxera <offerten@voxera.ai>';
  if (!host || !user || !pass) throw new Error('SMTP Konfiguration fehlt (SMTP_HOST/SMTP_USER/SMTP_PASS).');

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  const built = buildOfferEmail({ offer, subject, acceptanceUrl, pdfUrl });
  await transporter.sendMail({ from, to, subject: built.subject, html: built.html });
  return built.subject;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbServiceKey || !sbAnonKey) return response(500, { error: 'Supabase-Konfiguration fehlt.' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return response(400, { error: 'Ungültiger Request Body.' }); }
  const offerId = String(body.offer_id || '').trim();
  if (!offerId) return response(400, { error: 'offer_id fehlt.' });

  const { data: loadedOffer, error: loadErr } = await sbAdmin.from('offers').select('*').eq('id', offerId).single();
  if (loadErr || !loadedOffer) return response(404, { error: 'Offerte nicht gefunden.' });

  let offer = loadedOffer;
  const token = ensureOfferPublicToken(offer);
  const publicExpiresAt = resolvePublicExpiryFromOffer(offer);
  const tokenPatch = {};
  if (!offer.public_token || offer.public_token !== token) tokenPatch.public_token = token;
  if (publicExpiresAt && offer.public_expires_at !== publicExpiresAt) tokenPatch.public_expires_at = publicExpiresAt;
  if (Object.keys(tokenPatch).length) {
    tokenPatch.updated_at = new Date().toISOString();
    const { data: patched, error: patchErr } = await sbAdmin.from('offers').update(tokenPatch).eq('id', offer.id).select('*').single();
    if (patchErr) return response(500, { error: 'Offer token update failed.', details: patchErr.message });
    if (patched) offer = patched;
  }
  const acceptanceUrl = derivePublicOfferAcceptanceUrl(offer.public_token);
  const pdfUrl = derivePublicOfferPdfUrl(offer.public_token);

  const sentToEmail = String(body.sent_to_email || offer.sent_to_email || offer.email || '').trim();
  if (!sentToEmail) return response(400, { error: 'Offerte hat keine Empfänger-E-Mail.' });
  const subject = String(body.subject || offer.email_subject || '').trim();

  const outbox = await createOutboxEvent(sbAdmin, {
    eventType: 'offer_sent_email',
    payload: {
      offer_id: offer.id,
      offer_number: offer.offer_number,
      company_name: offer.company_name,
      contact_name: offer.contact_name,
      sent_to_email: sentToEmail,
      valid_until: offer.valid_until,
      total: offer.total,
      plan: offer.plan,
      email_subject: subject || null
    },
    payloadSummary: `offer_sent_email -> ${sentToEmail}`,
    dedupeKey: `offer:${offer.id}:send:${Date.now()}`
  }).catch((err) => {
    throw new Error(`Outbox insert failed: ${err.message}`);
  });

  try {
    const deliveredSubject = await sendOfferEmail({ to: sentToEmail, offer, subject, acceptanceUrl, pdfUrl });
    const nowIso = new Date().toISOString();
    await markOutboxSent(sbAdmin, outbox.id);
    const { error: updErr } = await sbAdmin
      .from('offers')
      .update({ status: 'sent', sent_to_email: sentToEmail, sent_at: nowIso, sent_by: caller.userId || null, delivery_status: 'sent', email_subject: deliveredSubject, updated_at: nowIso })
      .eq('id', offer.id);
    if (updErr) return response(500, { error: 'Offerte konnte nicht aktualisiert werden.', details: updErr.message });

    return response(200, { success: true, offer_id: offer.id, sent_to_email: sentToEmail, sent_at: nowIso, delivery_status: 'sent', email_subject: deliveredSubject });
  } catch (err) {
    const nowIso = new Date().toISOString();
    await markOutboxFailed(sbAdmin, outbox.id, err.message || 'Mailversand fehlgeschlagen');
    await sbAdmin.from('offers').update({ sent_to_email: sentToEmail, sent_by: caller.userId || null, delivery_status: 'failed', email_subject: subject || null, updated_at: nowIso }).eq('id', offer.id);
    return response(500, { error: 'Offer E-Mail konnte nicht gesendet werden.', details: err.message || err });
  }
};
