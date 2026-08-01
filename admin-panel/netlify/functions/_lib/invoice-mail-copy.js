'use strict';

const trim = value => String(value == null ? '' : value).trim();

function formatDateCh(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return trim(value) || null;
  return new Intl.DateTimeFormat('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Zurich'
  }).format(date);
}

function formatMoneyCh(value, currency = 'CHF') {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: trim(currency).toUpperCase() || 'CHF',
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0);
}

function mailCopy(type, invoice, customer) {
  const number = invoice.invoice_number || invoice.id;
  const amount = formatMoneyCh(invoice.total_amount, invoice.currency || 'CHF');
  const due = formatDateCh(invoice.due_at);
  const name = trim(customer.contact_name || customer.customer_name || customer.company_name);
  const greeting = name ? `Guten Tag ${name}` : 'Guten Tag';

  if (type === 'reminder_final_email') {
    return {
      subject: `Letzte Mahnung zur Rechnung ${number}`,
      body_text: `${greeting}\n\nTrotz unserer bisherigen Zahlungserinnerung ist die Rechnung ${number} über ${amount} noch offen.\n\nWir bitten Sie, den ausstehenden Betrag umgehend zu begleichen. Die Rechnung finden Sie nochmals im Anhang.\n\nFalls Sie die Zahlung bereits veranlasst haben, können Sie diese Nachricht als gegenstandslos betrachten.\n\nFreundliche Grüsse\nVoxera`,
      intro: `Die Rechnung ${number} ist weiterhin offen.`,
      payment_instruction: 'Die Zahlungsangaben finden Sie auf der Rechnung im Anhang.'
    };
  }

  if (type === 'reminder_email') {
    return {
      subject: `Zahlungserinnerung zur Rechnung ${number}`,
      body_text: `${greeting}\n\nBei der Durchsicht unserer offenen Posten haben wir festgestellt, dass die Rechnung ${number} über ${amount}${due ? `, fällig am ${due}` : ''}, noch nicht beglichen wurde.\n\nDie Rechnung finden Sie nochmals im Anhang. Wir bitten Sie, den offenen Betrag in den nächsten Tagen zu überweisen.\n\nFalls Sie die Zahlung bereits veranlasst haben, können Sie diese Nachricht als gegenstandslos betrachten.\n\nFreundliche Grüsse\nVoxera`,
      intro: `Zahlungserinnerung zur Rechnung ${number}.`,
      payment_instruction: 'Die Zahlungsangaben finden Sie auf der Rechnung im Anhang.'
    };
  }

  const type = trim(invoice.invoice_type).toLowerCase();
  const overage = type === 'extra_minutes' || type === 'overage';
  return {
    subject: overage ? `Ihre Abrechnung für zusätzliche Gesprächsminuten – ${number}` : `Ihre Voxera Rechnung ${number}`,
    body_text: overage
      ? `${greeting}\n\nIm Anhang erhalten Sie die Abrechnung für die zusätzlich beanspruchten Gesprächsminuten über ${amount}${due ? `, zahlbar bis ${due}` : ''}.\n\nDie detaillierte Aufstellung und sämtliche Zahlungsangaben finden Sie auf der Rechnung.\n\nBei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nFreundliche Grüsse\nVoxera`
      : `${greeting}\n\nIm Anhang erhalten Sie Ihre Voxera Rechnung ${number} über ${amount}${due ? `, zahlbar bis ${due}` : ''}.\n\nSämtliche Zahlungsangaben finden Sie direkt auf der Rechnung.\n\nBei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nFreundliche Grüsse\nVoxera`,
    intro: `Im Anhang erhalten Sie Ihre Voxera Rechnung ${number}.`,
    payment_instruction: 'Die Zahlungsangaben finden Sie auf der Rechnung im Anhang.'
  };
}

module.exports = { formatDateCh, formatMoneyCh, mailCopy };
