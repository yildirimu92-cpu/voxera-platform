function normalizePhoneE164(raw, defaultCountryCallingCode = '41') {
  const input = String(raw || '').trim();
  if (!input) return { normalized: '', empty: true, valid: false };

  let value = input.replace(/[^\d+]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;

  if (value.startsWith('+')) {
    value = `+${value.slice(1).replace(/\D/g, '')}`;
  } else {
    const digits = value.replace(/\D/g, '');
    if (!digits) return { normalized: '', empty: false, valid: false, original: input };

    // Swiss national format such as 079 123 45 67 -> +41791234567.
    // The default calling code remains overridable for future markets.
    if (digits.startsWith('0')) {
      value = `+${String(defaultCountryCallingCode || '41').replace(/\D/g, '')}${digits.slice(1)}`;
    } else {
      value = `+${digits}`;
    }
  }

  const digitCount = value.replace(/\D/g, '').length;
  const valid = /^\+[1-9]\d+$/.test(value) && digitCount >= 8 && digitCount <= 15;
  return {
    normalized: valid ? value : '',
    empty: false,
    valid,
    original: input
  };
}

module.exports = { normalizePhoneE164 };
