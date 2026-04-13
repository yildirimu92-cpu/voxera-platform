'use strict';

const { createClient } = require('@supabase/supabase-js');
const { acceptOfferAndEnsureContract, OfferAcceptanceError } = require('./_lib/offer-acceptance');
const { recordOfferEvent } = require('./_lib/offer-events');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function errorDiagnostic(step, error, context = {}) {
  return {
    step_failed: step,
    db_message: error?.message || null,
    db_code: error?.code || null,
    db_details: error?.details || null,
    db_hint: error?.hint || null,
    ...context
  };
}

function parseBody(event) {
  try { return JSON.parse(event.body || '{}'); } catch (_e) { return null; }
}

function isOfferExpired(offer) {
  const expiry = offer.public_expires_at || (offer.valid_until ? `${String(offer.valid_until).slice(0, 10)}T23:59:59.999Z` : null);
  if (!expiry) return false;
  return new Date(expiry).getTime() < Date.now();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbServiceKey) return response(500, { error: 'Supabase config missing.' });

  const body = parseBody(event);
  if (!body) return response(400, { error: 'Ungültiger Request Body.' });

  const token = String(body.token || '').trim();
  const signerName = String(body.signer_name || '').trim();
  const signerEmail = String(body.signer_email || '').trim();
  const confirmAccepted = body.confirm_accepted === true;
  const signatureData = String(body.signature_data || '').trim();

  if (!token) return response(400, { error: 'token fehlt.' });
  if (!signerName) return response(400, { error: 'signer_name fehlt.' });
  if (!confirmAccepted) return response(400, { error: 'Bestätigung ist erforderlich.' });
  if (!signatureData) return response(400, { error: 'signature_data fehlt.' });

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: offer, error: offerErr } = await sbAdmin
    .from('offers')
    .select('*')
    .eq('public_token', token)
    .maybeSingle();

  if (offerErr) return response(500, { error: 'Offer lookup failed.', details: offerErr.message });
  if (!offer) return response(404, { error: 'Offerte nicht gefunden.' });

  if (isOfferExpired(offer)) return response(409, { error: 'Offerte ist abgelaufen.' });
  const offerStatus = String(offer.status || '').toLowerCase();
  if (offerStatus === 'accepted' || offer.accepted_at) {
    const accepted = await acceptOfferAndEnsureContract({
      sbAdmin,
      offer,
      nowIso: new Date().toISOString(),
      allowContractFailure: true
    });
    const followUpIssues = [];
    if (accepted.contractError) followUpIssues.push('contract');
    if (accepted.invoiceError) followUpIssues.push('invoice');
    if (accepted.lifecycleError) followUpIssues.push('lifecycle');
    return response(200, {
      success: true,
      already_accepted: true,
      duplicate: true,
      offer_id: accepted.offerId,
      contract_id: accepted.contractId,
      contract_pending: !accepted.contractId,
      accepted_at: accepted.acceptedAt,
      follow_up_required: followUpIssues.length > 0,
      follow_up_issues: followUpIssues,
      diagnostics: {
        contract_error: accepted.contractError || null,
        invoice_error: accepted.invoiceError || null,
        lifecycle_error: accepted.lifecycleError || null,
        contract_id: accepted.contractId || null,
        customer_id: offer?.customer_id || null,
        subscription_id: accepted.billingDiagnostics?.subscription_id || null,
        setup_fee_invoice_id: accepted.invoiceId || null,
        month_1_invoice_id: accepted.recurringInvoiceId || null
      }
    });
  }
  if (!['sent', 'viewed'].includes(offerStatus)) {
    return response(409, { error: 'Offerte kann nur im Status sent/viewed akzeptiert werden.' });
  }

  const nowIso = new Date().toISOString();
  const idempotencyKey = String(event.headers['x-idempotency-key'] || '').trim() || `offer_accept:${offer.id}:${token}`;
  const ip = String(event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
  const userAgent = String(event.headers['user-agent'] || '').trim() || null;
  console.log('[offer_public_accept] start', JSON.stringify({
    idempotency_key: idempotencyKey,
    offer_id: offer.id,
    customer_id: offer.customer_id || null
  }));

  const acceptanceRow = {
    offer_id: offer.id,
    accepted_by_name: signerName,
    accepted_by_email: signerEmail || null,
    accepted_ip: ip,
    user_agent: userAgent,
    checkbox_confirmed: true,
    signature_data: signatureData,
    created_at: nowIso
  };

  let acceptanceId = null;
  try {
    const acceptanceInsert = await sbAdmin
      .from('offer_acceptances')
      .insert(acceptanceRow)
      .select('id')
      .single();
    if (acceptanceInsert.error) return response(500, { error: 'Annahme konnte nicht protokolliert werden.', details: acceptanceInsert.error.message });
    acceptanceId = acceptanceInsert.data?.id || null;

    const accepted = await acceptOfferAndEnsureContract({
      sbAdmin,
      offer,
      nowIso,
      allowContractFailure: true,
      acceptanceMeta: {
        accepted_by_name: signerName,
        accepted_by_email: signerEmail || null,
        accepted_ip: ip
      }
    });

    const followUpIssues = [];
    if (accepted.contractError) followUpIssues.push('contract');
    if (accepted.invoiceError) followUpIssues.push('invoice');
    if (accepted.lifecycleError) followUpIssues.push('lifecycle');

    await recordOfferEvent(sbAdmin,{ offer_id: accepted.offerId || offer.id, event_type: 'accepted', event_at: nowIso, actor_type: 'public', actor_id: null, recipient_email: signerEmail || null, meta: { signer_name: signerName } });
    return response(200, {
      success: true,
      duplicate: Boolean(accepted.duplicate),
      offer_id: accepted.offerId,
      contract_id: accepted.contractId,
      contract_pending: !accepted.contractId,
      accepted_at: accepted.acceptedAt,
      acceptance_id: acceptanceId,
      follow_up_required: followUpIssues.length > 0,
      follow_up_issues: followUpIssues,
      diagnostics: {
        contract_error: accepted.contractError || null,
        invoice_error: accepted.invoiceError || null,
        lifecycle_error: accepted.lifecycleError || null,
        contract_id: accepted.contractId || null,
        customer_id: accepted.offer?.customer_id || offer?.customer_id || null,
        subscription_id: accepted.billingDiagnostics?.subscription_id || null,
        setup_fee_invoice_id: accepted.invoiceId || null,
        month_1_invoice_id: accepted.recurringInvoiceId || null
      }
    });
  } catch (err) {
    if (acceptanceId) {
      const { data: latestOffer } = await sbAdmin
        .from('offers')
        .select('status, accepted_at')
        .eq('id', offer.id)
        .maybeSingle();
      const acceptanceCommitted = String(latestOffer?.status || '').toLowerCase() === 'accepted' || Boolean(latestOffer?.accepted_at);
      if (!acceptanceCommitted) {
        await sbAdmin.from('offer_acceptances').delete().eq('id', acceptanceId);
      }
    }
    if (err instanceof OfferAcceptanceError) {
      return response(err.statusCode, { error: err.message, details: err.details || undefined });
    }
    return response(500, {
      error: 'Offerte konnte nicht akzeptiert werden.',
      ...errorDiagnostic('offer_public_accept', err, {
        idempotency_key: idempotencyKey,
        contract_id: offer?.contract_id || null,
        customer_id: offer?.customer_id || null,
        subscription_id: null,
        setup_fee_invoice_id: null,
        month_1_invoice_id: null
      })
    });
  }
};
