const CALL_STATUS = Object.freeze({
  NEW: 'new',
  IN_PROGRESS: 'in_progress',
  FOLLOW_UP_SCHEDULED: 'follow_up_scheduled',
  CLOSED: 'closed'
});

const CALL_TRANSITIONS = Object.freeze({
  [CALL_STATUS.NEW]: new Set([CALL_STATUS.IN_PROGRESS]),
  [CALL_STATUS.IN_PROGRESS]: new Set([CALL_STATUS.FOLLOW_UP_SCHEDULED]),
  [CALL_STATUS.FOLLOW_UP_SCHEDULED]: new Set([CALL_STATUS.CLOSED]),
  [CALL_STATUS.CLOSED]: new Set([])
});

function normalizeCallStatus(status) {
  const raw = String(status || '').trim().toLowerCase().replace(/\s+/g, '_');
  const aliases = {
    neu: CALL_STATUS.NEW,
    new: CALL_STATUS.NEW,
    in_bearbeitung: CALL_STATUS.IN_PROGRESS,
    in_progress: CALL_STATUS.IN_PROGRESS,
    follow_up_scheduled: CALL_STATUS.FOLLOW_UP_SCHEDULED,
    'follow-up_geplant': CALL_STATUS.FOLLOW_UP_SCHEDULED,
    abgeschlossen: CALL_STATUS.CLOSED,
    erledigt: CALL_STATUS.CLOSED,
    closed: CALL_STATUS.CLOSED,
    done: CALL_STATUS.CLOSED,
    complete: CALL_STATUS.CLOSED,
    completed: CALL_STATUS.CLOSED
  };
  return aliases[raw] || CALL_STATUS.NEW;
}

function assertCallTransition(from, to) {
  const src = normalizeCallStatus(from);
  const dst = normalizeCallStatus(to);
  if (src === dst) return;
  const allowed = CALL_TRANSITIONS[src];
  if (!allowed || !allowed.has(dst)) {
    throw new Error(`Illegal call transition: ${src} -> ${dst}`);
  }
}

module.exports = {
  CALL_STATUS,
  normalizeCallStatus,
  assertCallTransition,
  CALL_TRANSITIONS
};
