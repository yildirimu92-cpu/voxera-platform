'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCustomerCaller } = require('./_lib/require-customer');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function text(value, maxLength = 500) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function publicDocumentUrl(value) {
  const candidate = text(value, 2000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveContractUrl(contract, publicBaseUrl) {
  const direct = publicDocumentUrl(
    contract?.signed_pdf_url
      || contract?.contract_pdf_url
      || contract?.pdf_url
  );
  if (direct) return direct;

  const token = text(contract?.contract_public_token, 160);
  if (!token || !contract?.countersigned_at) return null;
  return `${publicBaseUrl}/contract-signed.html?token=${encodeURIComponent(token)}`;
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbAnonKey = process.env.SUPABASE_ANON_KEY;
  const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbAnonKey || !sbServiceKey) {
    return response(500, { error: 'Supabase configuration missing', code: 'configuration_missing' });
  }

  const sbAdmin = createClient(sbUrl, sbServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const guard = await requireCustomerCaller({
    event,
    sbUrl,
    sbAnonKey,
    sbAdmin,
    requireActiveContract: false,
    functionName: 'customer-documents'
  });
  if (!guard.ok) return response(guard.statusCode, guard.body);

  const [invoiceResult, contractResult] = await Promise.all([
    sbAdmin
      .from('invoices')
      .select('*')
      .eq('customer_id', guard.customerId)
      .order('issued_at', { ascending: false })
      .limit(50),
    sbAdmin
      .from('contracts')
      .select('*')
      .eq('customer_id', guard.customerId)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20)
  ]);

  if (invoiceResult.error) {
    console.error('[customer-documents] invoice lookup failed', invoiceResult.error);
    return response(500, { error: 'Rechnungen konnten nicht geladen werden', code: 'invoice_lookup_failed' });
  }
  if (contractResult.error) {
    console.error('[customer-documents] contract lookup failed', contractResult.error);
    return response(500, { error: 'Vertrag konnte nicht geladen werden', code: 'contract_lookup_failed' });
  }

  const invoices = (invoiceResult.data || [])
    .filter((invoice) => !['draft', 'cancelled'].includes(text(invoice?.status, 40).toLowerCase()))
    .map((invoice) => ({
      id: text(invoice.id, 100),
      invoice_number: text(invoice.invoice_number, 100),
      status: text(invoice.status, 40).toLowerCase(),
      currency: text(invoice.currency, 10) || 'CHF',
      total_amount: Number(invoice.total_amount || 0),
      issued_at: invoice.issued_at || invoice.created_at || null,
      due_at: invoice.due_at || null,
      paid_at: invoice.paid_at || null,
      pdf_url: publicDocumentUrl(invoice.pdf_url)
    }));

  const publicBaseUrl = String(process.env.PUBLIC_SITE_URL || 'https://voxera.ch').replace(/\/+$/, '');
  const signedContracts = (contractResult.data || [])
    .filter((contract) => contract?.countersigned_at || contract?.signed_pdf_url || contract?.contract_pdf_url)
    .map((contract) => ({
      id: text(contract.id, 100),
      plan: text(contract.plan, 100),
      status: text(contract.status, 40).toLowerCase(),
      start_date: contract.start_date || null,
      end_date: contract.end_date || null,
      accepted_at: contract.accepted_at || null,
      countersigned_at: contract.countersigned_at || null,
      document_url: resolveContractUrl(contract, publicBaseUrl)
    }))
    .filter((contract) => !!contract.document_url);

  return response(200, {
    ok: true,
    invoices,
    contract: signedContracts[0] || null
  });
};
