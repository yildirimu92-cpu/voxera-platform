'use strict';

const { createClient } = require('@supabase/supabase-js');

// Einmal-Addons mit Minutenkontingent gelten fuer den laufenden Monat. Das
// Dashboard summiert `quantity x 50` nur ueber Zeilen, deren `valid_until`
// noch nicht verstrichen ist (index.html:16869) -- ohne gesetztes Datum liefe
// ein gekaufter Block nie ab. Monatliche Addons haben kein Ablaufdatum.
function addonValidUntil(addonRef) {
  if (String(addonRef.billing_type || '') !== 'onetime') return null;
  if (!Number(addonRef.extra_minutes)) return null;
  const now = new Date();
  // Tag 0 des Folgemonats ist der letzte Tag des laufenden Monats.
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString().slice(0, 10);
}

function addonQuantity(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 100);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const token = event.headers.authorization?.replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user) return { statusCode: 401, body: 'Unauthorized' };

  const { data: customer } = await supabase.from('customers').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (!customer?.id) return { statusCode: 404, body: 'Kunde nicht gefunden' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const action = String(body.action || '').trim();
  const addonCode = String(body.addon_code || '').trim();
  const customerAddonId = String(body.customer_addon_id || '').trim();

  if (action === 'activate') {
    if (!addonCode) return { statusCode: 400, body: JSON.stringify({ error: 'addon_code required' }) };
    const { data: addonRef } = await supabase
      .from('voxera_addons')
      .select('*')
      .eq('addon_code', addonCode)
      .eq('coming_soon', false)
      .maybeSingle();

    if (!addonRef) return { statusCode: 400, body: JSON.stringify({ error: 'Add-on nicht verfügbar' }) };

    const nowIso = new Date().toISOString();
    const { error } = await supabase.from('customer_addons').upsert({
      customer_id: customer.id,
      addon_code: addonCode,
      status: 'active',
      billing_cycle: addonRef.billing_type,
      price_chf: addonRef.price_monthly_chf || addonRef.price_onetime_chf,
      quantity: addonQuantity(body.quantity),
      valid_until: addonValidUntil(addonRef),
      starts_at: nowIso,
      // Der Upsert trifft bei einer Reaktivierung dieselbe Zeile. Ohne das
      // Zuruecksetzen bliebe der Stornozeitpunkt der vorherigen Kuendigung
      // stehen und wuerde eine aktive Zeile als gekuendigt ausweisen.
      cancelled_at: null,
      updated_at: nowIso
    }, { onConflict: 'customer_id,addon_code' });

    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  if (action === 'cancel') {
    if (!customerAddonId) return { statusCode: 400, body: 'customer_addon_id required' };
    const { data: customerAddon } = await supabase.from('customer_addons').select('id').eq('id', customerAddonId).eq('customer_id', customer.id).maybeSingle();
    if (!customerAddon) return { statusCode: 403, body: 'Nicht erlaubt' };

    const { error } = await supabase.from('customer_addons').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', customerAddonId);

    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 400, body: 'Ungültige Action' };
};
