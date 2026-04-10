'use strict';

const PLAN_ALIASES = Object.freeze({
  pro: 'professional',
  professional: 'professional',
  starter: 'starter',
  business: 'business',
  'kein plan': 'kein_plan',
  kein_plan: 'kein_plan',
  noplan: 'kein_plan',
  no_plan: 'kein_plan'
});

function normalizePlanCode(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!raw) return '';
  return PLAN_ALIASES[raw] || raw;
}

function isSalesPlanCode(code) {
  return ['starter', 'business', 'professional'].includes(normalizePlanCode(code));
}

async function loadPlanByCode(sbAdmin, code) {
  const normalized = normalizePlanCode(code);
  if (!normalized) return { plan: null, error: null, normalizedCode: normalized };

  const tries = Array.from(new Set([normalized, normalized === 'professional' ? 'pro' : null].filter(Boolean)));
  for (const id of tries) {
    const { data, error } = await sbAdmin
      .from('plan_config')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return { plan: null, error, normalizedCode: normalized };
    if (data) return { plan: data, error: null, normalizedCode: normalized };
  }

  return { plan: null, error: null, normalizedCode: normalized };
}

module.exports = {
  normalizePlanCode,
  isSalesPlanCode,
  loadPlanByCode
};
