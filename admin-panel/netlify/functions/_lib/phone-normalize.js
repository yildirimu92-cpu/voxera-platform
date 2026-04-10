function normalizePhoneE164(raw) {
  const input = String(raw || '').trim();
  if (!input) return { normalized: '', empty: true, valid: false };

  let value = input.replace(/[^\d+]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;

  if (value.startsWith('+')) {
    value = `+${value.slice(1).replace(/\D/g, '')}`;
  } else {
    value = `+${value.replace(/\D/g, '')}`;
  }

  const valid = /^\+\d+$/.test(value) && value.length > 1;
  return { normalized: valid ? value : '', empty: false, valid, original: input };
}

module.exports = { normalizePhoneE164 };
