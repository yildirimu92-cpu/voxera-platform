'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { acceptOfferAndEnsureContract, OfferAcceptanceError } = require('./_lib/offer-acceptance');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

const ALLOWED = new Set(['draft', 'sent', 'in_review', 'revision_requested', 'accepted', 'rejected', 'expired']);
const FINAL = new Set(['accepted', 'rejected']);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { error: 'Ungültiger Request Body' }); }

  const offerId = String(body.offer_id || '').trim();
  const targetStatus = String(body.status || '').trim().toLowerCase();
  if (!offerId) return response(400, { error: 'offer_id fehlt' });
  if (!ALLOWED.has(targetStatus)) return response(400, { error: 'Ungültiger Offer-Status.' });

  const { data: offer, error: offerErr } = await sbAdmin
    .from('offers')
    .select('*')
    .eq('id', offerId)
    .maybeSingle();
  if (offerErr) return response(500, { error: 'Offer lookup failed', details: offerErr.message });
  if (!offer) return response(404, { error: 'Offerte nicht gefunden' });

  const currentStatus = String(offer.status || '').toLowerCase() || 'draft';
  const nowIso = new Date().toISOString();

  if (FINAL.has(currentStatus) && targetStatus !== currentStatus) {
    return response(409, { error: 'Finaler Offer-Status ist gesperrt und kann nicht geändert werden.', from_status: currentStatus, to_status: targetStatus });
  }

  if (targetStatus === 'accepted') {
    try {
      const accepted = await acceptOfferAndEnsureContract({
        sbAdmin,
        offer,
        nowIso,
        acceptanceMeta: {
          accepted_by_name: offer.accepted_by_name || 'Admin',
          accepted_by_email: offer.accepted_by_email || null,
          accepted_ip: offer.accepted_ip || null
        }
      });

      const { data: refreshedOffer } = await sbAdmin
        .from('offers')
        .select('*')
        .eq('id', offerId)
        .maybeSingle();

      return response(200, {
        success: true,
        duplicate: Boolean(accepted.duplicate),
        offer: refreshedOffer,
        contract_id: accepted.contractId,
        diagnostics: {
          contract_error: accepted.contractError || null,
          invoice_error: accepted.invoiceError || null,
          lifecycle_error: accepted.lifecycleError || null,
          customer_id: refreshedOffer?.customer_id || offer?.customer_id || null,
          subscription_id: accepted.billingDiagnostics?.subscription_id || null,
          setup_fee_invoice_id: accepted.invoiceId || null,
          month_1_invoice_id: accepted.recurringInvoiceId || null
        }
      });
    } catch (err) {
      if (err instanceof OfferAcceptanceError) {
        return response(err.statusCode, { error: err.message, details: err.details || undefined });
      }
      return response(500, {
        error: 'Offerte konnte nicht akzeptiert werden.',
        ...errorDiagnostic('offer_admin_accept', err, {
          contract_id: offer?.contract_id || null,
          customer_id: offer?.customer_id || null,
          subscription_id: null
        })
      });
    }
  }

  if (targetStatus === 'rejected') {
    if (currentStatus === 'accepted') {
      return response(409, { error: 'Akzeptierte Offerte ist final und kann nicht abgelehnt werden.' });
    }
    const { data, error } = await sbAdmin
      .from('offers')
      .update({ status: 'rejected', rejected_at: offer.rejected_at || nowIso, updated_at: nowIso })
      .eq('id', offer.id)
      .select('*')
      .single();
    if (error) return response(500, { error: 'Offer-Status konnte nicht gespeichert werden.', details: error.message });
    return response(200, { success: true, offer: data });
  }

  if (FINAL.has(currentStatus)) {
    return response(409, { error: 'Finaler Offer-Status ist gesperrt und kann nicht geändert werden.', from_status: currentStatus, to_status: targetStatus });
  }

  const patch = { status: targetStatus, updated_at: nowIso };
  if (targetStatus !== 'rejected') patch.rejected_at = null;
  const { data, error } = await sbAdmin.from('offers').update(patch).eq('id', offer.id).select('*').single();
  if (error) return response(500, { error: 'Offer-Status konnte nicht gespeichert werden.', details: error.message });

  return response(200, { success: true, offer: data });
};
