'use strict';

const PHONE_NUMBERS_BASE = 'https://api.elevenlabs.io/v1/convai/phone-numbers';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizePhone(value) {
  const raw = clean(value);
  if (!raw) return '';
  const compact = raw.replace(/[\s().-]/g, '');
  if (compact.startsWith('+')) {
    const digits = compact.slice(1).replace(/\D/g, '');
    return digits ? `+${digits}` : '';
  }
  const digits = compact.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+41${digits.slice(1)}`;
  return `+${digits}`;
}

async function elevenLabsRequest(apiKey, path = '', { method = 'GET', body } = {}) {
  const key = clean(apiKey);
  if (!key) throw new Error('elevenlabs_api_key_missing');

  const response = await fetch(PHONE_NUMBERS_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': key
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch (_error) { payload = { raw: text.slice(0, 1500) }; }

  if (!response.ok) {
    const detail = payload.detail || payload.error || payload.raw || 'unknown_error';
    const serialized = typeof detail === 'string' ? detail : JSON.stringify(detail);
    const error = new Error(`ElevenLabs phone number ${response.status}: ${serialized.slice(0, 1500)}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function listPhoneNumbers(apiKey) {
  const payload = await elevenLabsRequest(apiKey);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.phone_numbers)) return payload.phone_numbers;
  return [];
}

function phoneNumberId(item) {
  return clean(item?.phone_number_id || item?.id);
}

function assignedAgentId(item) {
  return clean(item?.assigned_agent?.agent_id || item?.agent_id);
}

function customerLabel(customer = {}) {
  const name = clean(customer.customer_display_name || customer.customer_name || customer.contact_name || 'Kunde');
  return `Voxera – ${name}`.slice(0, 100);
}

async function importTwilioPhoneNumber(apiKey, customer, normalizedPhone) {
  const sid = clean(process.env.TWILIO_ACCOUNT_SID);
  const token = clean(process.env.TWILIO_AUTH_TOKEN);
  if (!sid || !token) throw new Error('twilio_configuration_missing_for_elevenlabs_phone_import');

  const result = await elevenLabsRequest(apiKey, '', {
    method: 'POST',
    body: {
      provider: 'twilio',
      label: customerLabel(customer),
      phone_number: normalizedPhone,
      sid,
      token
    }
  });

  const id = phoneNumberId(result);
  if (!id) throw new Error('elevenlabs_phone_number_import_id_missing');
  return id;
}

async function ensureAgentPhoneNumber({ apiKey, agentId, customer }) {
  const normalizedPhone = normalizePhone(customer?.voxera_number);
  const normalizedAgentId = clean(agentId);

  if (!normalizedAgentId) throw new Error('elevenlabs_agent_id_missing');
  if (!normalizedPhone) {
    return {
      status: 'skipped_no_number',
      phone_number: null,
      phone_number_id: null
    };
  }

  const phoneNumbers = await listPhoneNumbers(apiKey);
  const matches = phoneNumbers.filter(item => normalizePhone(item?.phone_number) === normalizedPhone);
  if (matches.length > 1) throw new Error('elevenlabs_duplicate_phone_number_match');

  const item = matches[0] || null;
  let id = phoneNumberId(item);
  let imported = false;

  if (!id) {
    id = await importTwilioPhoneNumber(apiKey, customer, normalizedPhone);
    imported = true;
  }

  if (!imported && assignedAgentId(item) === normalizedAgentId) {
    return {
      status: 'already_assigned',
      phone_number: normalizedPhone,
      phone_number_id: id
    };
  }

  const updated = await elevenLabsRequest(apiKey, `/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { agent_id: normalizedAgentId }
  });

  return {
    status: imported ? 'imported_and_assigned' : 'assigned',
    phone_number: normalizePhone(updated?.phone_number) || normalizedPhone,
    phone_number_id: phoneNumberId(updated) || id
  };
}

module.exports = {
  ensureAgentPhoneNumber,
  _test: {
    normalizePhone,
    listPhoneNumbers,
    phoneNumberId,
    assignedAgentId,
    customerLabel
  }
};
