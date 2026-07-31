(function (w) {
  'use strict';
  if (!w || typeof document === 'undefined') return;

  const lower = value => String(value || '').trim().toLowerCase();
  const rawOf = row => row && row.raw && typeof row.raw === 'object' ? row.raw : (row || {});

  const CUSTOMER_FOLLOWUP_SOURCES = new Set([
    'customer_task',
    'customer_tasks',
    'customer_followup',
    'customer_follow_up',
    'customer_portal_followup',
    'customer_dashboard_followup',
    'call_followup',
    'call_follow_up',
    'followup',
    'follow_up',
    'callback',
    'reminder'
  ]);

  const ADMIN_SOURCES = new Set([
    '',
    'admin',
    'admin_portal',
    'manual_admin',
    'internal',
    'operations'
  ]);

  function caseType(row) {
    const raw = rawOf(row);
    return lower(row?.caseType || row?.case_type || raw.case_type || 'internal_task');
  }

  function hasCustomerFollowUpEvidence(row) {
    const raw = rawOf(row);
    const source = lower(row?.source || raw.source);
    const origin = lower(row?.origin_channel || raw.origin_channel);
    const legacyType = lower(row?.type || raw.type);
    const title = lower(row?.title || raw.title);
    const note = lower(row?.note || row?.notes || raw.note || raw.notes);

    if (CUSTOMER_FOLLOWUP_SOURCES.has(source)
      || CUSTOMER_FOLLOWUP_SOURCES.has(origin)
      || CUSTOMER_FOLLOWUP_SOURCES.has(legacyType)) return true;

    // Any internal_task emitted from the Customer Portal is not an admin case.
    // Explicit support and assistant requests are handled by their own case_type.
    if (source.startsWith('customer_portal') || origin === 'customer_portal' || origin === 'customer_dashboard') return true;

    const hasRequester = Boolean(
      row?.requester_user_id || raw.requester_user_id ||
      row?.requester_email || raw.requester_email
    );
    const hasDueOrPhone = Boolean(
      row?.dueAt || row?.due_at || raw.due_at ||
      row?.dueTime || row?.due_time || raw.due_time || raw.due_at_time ||
      row?.phone || raw.phone || row?.callback_at || raw.callback_at
    );
    const hasCallReference = Boolean(
      row?.call_id || raw.call_id || row?.conversation_id || raw.conversation_id ||
      row?.callId || raw.callId || row?.conversationId || raw.conversationId
    );
    const followUpLanguage = /follow[ -]?up|rückruf|callback|zurückrufen|anruf.?nachfassen|erinnerung/.test(`${title} ${note}`);
    const legacyCustomerNote = /\[quelle:\s*(customer|customer_portal|customer_task|follow)/.test(note);

    if (legacyCustomerNote) return true;
    if ((hasRequester || hasCallReference) && (hasDueOrPhone || followUpLanguage)) return true;
    if (hasDueOrPhone && hasCallReference) return true;
    if (hasDueOrPhone && followUpLanguage) return true;

    return false;
  }

  function isAdminQueueCase(row) {
    const raw = rawOf(row);
    const type = caseType(row);
    const source = lower(row?.source || raw.source);

    // These are deliberate operational intake channels.
    if (type === 'customer_support') return true;
    if (type === 'assistant_change') return true;

    // Unknown categories and quarantined legacy follow-ups never enter the queue.
    if (type !== 'internal_task') return false;
    if (hasCustomerFollowUpEvidence(row)) return false;

    // Internal tasks should originate from an admin/operations context. Blank is
    // retained only for genuine legacy admin tasks that have no follow-up evidence.
    return ADMIN_SOURCES.has(source);
  }

  function withAdminCases(fn, context, args) {
    if (typeof fn !== 'function' || typeof w.state === 'undefined' || !Array.isArray(w.state.cases)) {
      return typeof fn === 'function' ? fn.apply(context, args) : undefined;
    }
    const original = w.state.cases;
    w.state.cases = original.filter(isAdminQueueCase);
    try {
      return fn.apply(context, args);
    } finally {
      w.state.cases = original;
    }
  }

  function wrap(name) {
    const current = w[name];
    if (typeof current !== 'function' || current.__voxeraAdminCasesOnly) return;
    const wrapped = function () {
      return withAdminCases(current, this, arguments);
    };
    wrapped.__voxeraAdminCasesOnly = true;
    wrapped.__voxeraOriginal = current;
    w[name] = wrapped;
  }

  function install() {
    [
      'renderCases',
      'renderOverview',
      'renderAll',
      'renderCustomers',
      'renderCustomerWorkspace',
      'renderOnboarding'
    ].forEach(wrap);
  }

  w.VoxeraAdminCases = Object.freeze({
    isAdminQueueCase,
    hasCustomerFollowUpEvidence,
    filter: rows => (Array.isArray(rows) ? rows : []).filter(isAdminQueueCase)
  });

  const start = () => {
    install();
    setTimeout(install, 250);
    setTimeout(() => {
      install();
      if (typeof w.renderCases === 'function' && document.getElementById('section-cases')?.classList.contains('active')) {
        w.renderCases();
      }
    }, 1000);
  };

  if (document.readyState === 'complete') start();
  else w.addEventListener('load', start, { once: true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
