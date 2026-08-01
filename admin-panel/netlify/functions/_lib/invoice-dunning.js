'use strict';

const POLICY = Object.freeze({
  graceDays: 3,
  finalReminderDelayDays: 7,
  suspensionReviewDelayDays: 7,
  timezone: 'Europe/Zurich'
});

const trim = value => String(value == null ? '' : value).trim();

function dateKeyZurich(value) {
  if (!value) return null;
  const raw = trim(value);
  const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly) return dateOnly[1];
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: POLICY.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function dayNumber(dateKey) {
  const match = trim(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

function calendarDaysBetween(fromValue, toValue) {
  const from = dayNumber(dateKeyZurich(fromValue));
  const to = dayNumber(dateKeyZurich(toValue));
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return to - from;
}

function addDays(dateValue, days) {
  const key = dateKeyZurich(dateValue);
  const number = dayNumber(key);
  if (!Number.isFinite(number)) return null;
  return new Date((number + Number(days || 0)) * 86400000).toISOString().slice(0, 10);
}

function invoiceState(invoice) {
  if (invoice?.paid_at) return 'paid';
  const status = trim(invoice?.status || invoice?.payment_status).toLowerCase();
  if (['paid', 'bezahlt'].includes(status)) return 'paid';
  if (['cancelled', 'canceled', 'void', 'voided', 'storniert'].includes(status)) return 'cancelled';
  if (['sent', 'gesendet'].includes(status)) return 'sent';
  if (['overdue', 'ueberfaellig', 'überfällig'].includes(status)) return 'overdue';
  if (['draft', 'entwurf'].includes(status)) return 'draft';
  return status || 'open';
}

function reminderLevel(invoice) {
  if (Object.prototype.hasOwnProperty.call(invoice || {}, 'reminder_level')) {
    const direct = Number(invoice?.reminder_level);
    return Number.isFinite(direct) ? Math.max(0, Math.min(2, Math.floor(direct))) : 0;
  }
  if (invoice?.final_reminder_sent_at) return 2;
  if (invoice?.reminder_1_sent_at) return 1;
  return 0;
}

function blocked(base, reasonCode, reason, extra = {}) {
  return {
    ...base,
    can_remind: false,
    eligible_level: null,
    reason_code: reasonCode,
    reason,
    ...extra
  };
}

function evaluateInvoiceDunning(invoice, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const requestedLevel = options.requestedLevel == null ? null : Number(options.requestedLevel);
  const status = invoiceState(invoice);
  const currentLevel = reminderLevel(invoice);
  const dueOn = dateKeyZurich(invoice?.due_at || invoice?.due_date || invoice?.invoice_due_date);
  const todayOn = dateKeyZurich(now);
  const overdueDays = dueOn && todayOn ? calendarDaysBetween(dueOn, todayOn) : null;
  const base = {
    status,
    current_level: currentLevel,
    due_on: dueOn,
    today_on: todayOn,
    overdue_days: overdueDays,
    policy: POLICY,
    stage: 'open',
    next_eligible_on: null,
    suspension_review_on: null
  };

  if (status === 'paid') return blocked({ ...base, stage: 'closed_paid' }, 'invoice_paid', 'Bezahlte Rechnungen können nicht gemahnt werden.');
  if (status === 'cancelled') return blocked({ ...base, stage: 'closed_cancelled' }, 'invoice_cancelled', 'Stornierte Rechnungen können nicht gemahnt werden.');
  if (!['open', 'sent', 'overdue'].includes(status)) {
    return blocked(base, 'invoice_not_actionable', 'Nur offene, versendete oder überfällige Rechnungen können gemahnt werden.');
  }
  if (!dueOn || !Number.isFinite(overdueDays)) {
    return blocked(base, 'invoice_due_date_missing', 'Für die Rechnung ist kein gültiges Fälligkeitsdatum hinterlegt.');
  }

  if (currentLevel >= 2) {
    const finalSentAt = invoice?.final_reminder_sent_at;
    const suspensionReviewOn = finalSentAt ? addDays(finalSentAt, POLICY.suspensionReviewDelayDays) : null;
    const daysSinceFinal = finalSentAt ? calendarDaysBetween(finalSentAt, now) : null;
    const stage = Number.isFinite(daysSinceFinal) && daysSinceFinal >= POLICY.suspensionReviewDelayDays
      ? 'suspension_review'
      : 'final_sent';
    return blocked({ ...base, stage, suspension_review_on: suspensionReviewOn }, 'dunning_complete', 'Die letzte Mahnung wurde bereits versendet.');
  }

  if (currentLevel === 0) {
    const nextEligibleOn = addDays(dueOn, POLICY.graceDays);
    if (overdueDays <= 0) {
      return blocked({ ...base, stage: 'open', next_eligible_on: nextEligibleOn }, 'invoice_not_overdue', 'Die Rechnung ist noch nicht überfällig.');
    }
    if (overdueDays < POLICY.graceDays) {
      return blocked({ ...base, stage: 'grace_period', next_eligible_on: nextEligibleOn }, 'reminder_grace_period', 'Die Rechnung befindet sich noch in der Kulanzfrist.');
    }
    if (requestedLevel != null && requestedLevel !== 1) {
      return blocked({ ...base, stage: 'reminder_due', next_eligible_on: todayOn }, 'reminder_level_invalid', 'Als nächster Schritt ist nur die erste Zahlungserinnerung zulässig.');
    }
    return {
      ...base,
      stage: 'reminder_due',
      can_remind: true,
      eligible_level: 1,
      reason_code: 'reminder_due',
      reason: 'Die erste Zahlungserinnerung kann gesendet werden.',
      next_eligible_on: todayOn
    };
  }

  const firstSentAt = invoice?.reminder_1_sent_at;
  if (!firstSentAt) {
    return blocked({ ...base, stage: 'state_inconsistent' }, 'reminder_timestamp_missing', 'Die erste Mahnstufe ist gespeichert, aber der Versandzeitpunkt fehlt.');
  }
  const daysSinceFirst = calendarDaysBetween(firstSentAt, now);
  const nextEligibleOn = addDays(firstSentAt, POLICY.finalReminderDelayDays);
  if (!Number.isFinite(daysSinceFirst) || daysSinceFirst < POLICY.finalReminderDelayDays) {
    return blocked({ ...base, stage: 'reminder_sent', next_eligible_on: nextEligibleOn }, 'final_reminder_wait', 'Die Wartefrist nach der ersten Zahlungserinnerung läuft noch.');
  }
  if (requestedLevel != null && requestedLevel !== 2) {
    return blocked({ ...base, stage: 'final_due', next_eligible_on: todayOn }, 'reminder_level_invalid', 'Als nächster Schritt ist nur die letzte Mahnung zulässig.');
  }
  return {
    ...base,
    stage: 'final_due',
    can_remind: true,
    eligible_level: 2,
    reason_code: 'final_reminder_due',
    reason: 'Die letzte Mahnung kann gesendet werden.',
    next_eligible_on: todayOn
  };
}

function dunningPatchForLevel(level, options = {}) {
  const numericLevel = Number(level);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const nowIso = now.toISOString();
  const common = {
    reminder_level: numericLevel,
    dunning_updated_at: nowIso,
    dunning_last_outbox_id: options.outboxId ? String(options.outboxId) : null,
    updated_at: nowIso
  };
  if (numericLevel === 1) {
    return {
      ...common,
      dunning_status: 'reminder_sent',
      reminder_1_sent_at: nowIso
    };
  }
  if (numericLevel === 2) {
    return {
      ...common,
      dunning_status: 'final_sent',
      final_reminder_sent_at: nowIso,
      suspension_review_at: new Date(now.getTime() + POLICY.suspensionReviewDelayDays * 86400000).toISOString()
    };
  }
  throw new Error('Unsupported reminder level.');
}

module.exports = {
  POLICY,
  dateKeyZurich,
  calendarDaysBetween,
  addDays,
  invoiceState,
  reminderLevel,
  evaluateInvoiceDunning,
  dunningPatchForLevel
};
