'use strict';

// Vor-Ort One-Click-Abschluss: Admin sitzt mit Kunde vor Ort, erfasst
// Kundensignatur + Startdatum in einem Schritt. Dieser Handler verkettet
// serverseitig, was bisher drei getrennte manuelle Klicks waren:
//   1) Signatur speichern (status -> signed)
//   2) contract-countersign.js (countersigned_at setzen, contract_signed_email)
//   3) contract-start-confirm.js (Aktivierung: Status active, Rechnungsentwürfe)
// Die Kernlogik/Gates dieser drei Schritte bleiben unverändert (siehe
// _lib/contract-countersign-service.js und _lib/contract-activation-service.js)
// - hier ändert sich nur, dass ein einziger HTTP-Call sie nacheinander auslöst.

const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');
const { executeCommercialCommand } = require('./_lib/commercial-orchestrator');
const { countersignContract, CountersignError } = require('./_lib/contract-countersign-service');
const { activateContractSafely } = require('./_lib/contract-activation-service');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function trimOrNull(value) {
  const normalized = String(value == null ? '' : value).trim();
  return normalized || null;
}

function addMonthsDateIsoUtc(dateStr, months) {
  const base = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  const next = new Date(base.getTime());
  next.setUTCMonth(next.getUTCMonth() + Number(months || 0));
  return next.toISOString().slice(0, 10);
}

const PRE_SIGNATURE_STATUSES = new Set(['draft', 'pending', 'pending_review', '']);

function normalizeActivationError(err) {
  const step = String(err?.step_failed || 'contracts.activate');
  const dbMessage = err?.db_message || err?.message || null;
  const orchestrationFailure = err?.error === 'Contract billing orchestration failed';
  const baseMessage = orchestrationFailure
    ? `Vertragsaktivierung im Schritt "${step}" fehlgeschlagen`
    : String(err?.message || err?.error || 'Contract activation failed');
  return {
    success: false,
    error: orchestrationFailure && dbMessage ? `${baseMessage}: ${dbMessage}` : baseMessage,
    step_failed: step,
    diagnostics: {
      db_message: err?.db_message || null,
      db_code: err?.db_code || null,
      db_details: err?.db_details || null,
      db_hint: err?.db_hint || null
    }
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbServiceKey || !sbAnonKey) {
    return response(500, { error: 'SUPABASE_URL, SUPABASE_ANON_KEY und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const caller = await requireAdminCaller({ event, supabaseUrl: sbUrl, supabaseAnonKey: sbAnonKey, sbAdmin });
  if (!caller.ok) return response(caller.statusCode, caller.body);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return response(400, { error: 'Ungültiger Request Body' }); }

  const contractId = trimOrNull(body.contract_id);
  const signatureData = trimOrNull(body.signature_data);
  const countersignName = trimOrNull(body.countersign_name) || 'Voxera Team';
  const countersignatureData = trimOrNull(body.countersignature_data) || signatureData;
  const startDate = trimOrNull(body.start_date);
  const durationMonths = Math.max(1, Math.trunc(Number(body.term_months || body.duration_months || 0) || 0));
  const computedEndDate = startDate ? addMonthsDateIsoUtc(startDate, durationMonths) : null;
  const endDate = trimOrNull(body.end_date) || computedEndDate;

  if (!contractId) return response(400, { error: 'contract_id fehlt.' });
  if (!signatureData) return response(400, { error: 'signature_data fehlt.' });
  if (!startDate || !computedEndDate || !endDate) return response(400, { error: 'start_date oder duration_months ungültig.' });

  const { data: contract, error: loadError } = await sbAdmin
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .single();
  if (loadError || !contract) return response(404, { error: 'Vertrag nicht gefunden.' });

  // ── Schritt 1: Signatur speichern ────────────────────────────────────────
  const status = String(contract.status || '').trim().toLowerCase();
  if (PRE_SIGNATURE_STATUSES.has(status) || !contract.signature_data) {
    try {
      await executeCommercialCommand({
        sbAdmin,
        actor: { userId: caller.userId, role: caller.role },
        command: 'contracts.update',
        payload: { contract_id: contractId, payload: { signature_data: signatureData, status: 'signed' } }
      });
    } catch (err) {
      return response(409, { error: err?.message || 'Signatur konnte nicht gespeichert werden.', step_failed: 'save_signature' });
    }
  }

  // ── Schritt 2: Gegenzeichnen (countersigned_at + contract_signed_email) ──
  let countersignResult;
  try {
    countersignResult = await countersignContract({
      sbAdmin,
      contractId,
      countersignName,
      countersignatureData,
      actorUserId: caller.userId
    });
  } catch (err) {
    if (err instanceof CountersignError && err.statusCode === 409) {
      // Bereits gegengezeichnet (z.B. Retry nach Netzwerkfehler) - kein Fehler,
      // einfach mit der Aktivierung fortfahren.
      countersignResult = { contract_id: contractId, countersigned_at: contract.countersigned_at, already_countersigned: true };
    } else {
      const statusCode = err instanceof CountersignError ? err.statusCode : 500;
      return response(statusCode, {
        error: err?.message || 'Gegenzeichnung fehlgeschlagen.',
        step_failed: 'countersign',
        signature_saved: true
      });
    }
  }

  // ── Schritt 3: Vertragsstart bestätigen (Aktivierung + Billing) ─────────
  let activation;
  try {
    const result = await activateContractSafely({
      sbAdmin,
      actor: { userId: caller.userId, role: caller.role },
      contractId,
      requestedCustomerId: body.customer_id || null,
      startDate,
      durationMonths,
      endDate,
      notes: body.notes || null
    });
    activation = {
      success: true,
      subscription_ready: Boolean(result.subscription?.id),
      setup_fee_invoice_created: Boolean(result.setup_fee_invoice_created),
      recurring_invoice_created: Boolean(result.recurring_invoice_created),
      pdfs_generated: Boolean(result.pdfs_generated),
      contract: result.contract,
      subscription: result.subscription || null
    };
  } catch (err) {
    console.error('[contract-onsite-complete] activation failed after countersign succeeded', JSON.stringify({
      contract_id: contractId,
      step_failed: err?.step_failed || null
    }));
    activation = normalizeActivationError(err);
  }

  // Erfolg des Gesamtvorgangs bemisst sich an Signatur+Gegenzeichnung: der
  // Kunde wurde in jedem Fall informiert. Falls die Aktivierung (Billing)
  // scheitert, bleibt der Vertrag über "Vertragsstart bestätigen" manuell
  // nachholbar (idempotent, gleiche Gates wie contract-start-confirm.js).
  return response(200, {
    success: true,
    contract_id: contractId,
    countersigned_at: countersignResult.countersigned_at,
    mail_delivery: countersignResult.mail_delivery || null,
    activation
  });
};
