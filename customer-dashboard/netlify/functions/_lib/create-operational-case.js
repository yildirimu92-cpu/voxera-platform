'use strict';

function isMissingColumn(error) {
  const code = String(error?.code || '');
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return code === '42703' || code === 'PGRST204' || message.includes('schema cache') || (message.includes('column') && message.includes('does not exist'));
}

async function findExisting(sbAdmin, source, sourceRefId) {
  if (!sourceRefId) return null;
  const { data, error } = await sbAdmin
    .from('voxera_cases')
    .select('*')
    .eq('source', source)
    .eq('source_ref_id', sourceRefId)
    .maybeSingle();
  if (error) {
    if (isMissingColumn(error)) return null;
    throw error;
  }
  return data || null;
}

async function insertOperationalCase(sbAdmin, input) {
  const now = new Date().toISOString();
  const customerId = String(input.customerId || '').trim();
  const title = String(input.title || '').trim();
  const note = String(input.note || '').trim();
  const source = String(input.source || 'customer_portal').trim();
  const sourceRefId = String(input.sourceRefId || '').trim() || null;
  if (!customerId || !title) throw new Error('customerId and title are required');

  const existing = await findExisting(sbAdmin, source, sourceRefId);
  if (existing) return { ...existing, duplicate: true };

  const modern = {
    customer_id: customerId,
    title,
    note: note || null,
    status: 'open',
    priority: String(input.priority || 'medium'),
    case_type: String(input.caseType || 'customer_support'),
    source,
    source_ref_id: sourceRefId,
    origin_channel: String(input.originChannel || 'customer_portal'),
    requester_user_id: input.requesterUserId || null,
    requester_email: input.requesterEmail || null,
    created_at: now,
    updated_at: now
  };

  let { data, error } = await sbAdmin.from('voxera_cases').insert(modern).select('*').single();
  if (!error) return data;
  if (!isMissingColumn(error)) throw error;

  const legacy = {
    customer_id: customerId,
    title,
    note: `${note}${note ? '\n\n' : ''}[Quelle: ${source}${sourceRefId ? ` · Referenz: ${sourceRefId}` : ''}]`,
    status: 'open',
    priority: String(input.priority || 'medium'),
    created_at: now,
    updated_at: now
  };
  ({ data, error } = await sbAdmin.from('voxera_cases').insert(legacy).select('*').single());
  if (error) throw error;
  return data;
}

module.exports = { insertOperationalCase };
