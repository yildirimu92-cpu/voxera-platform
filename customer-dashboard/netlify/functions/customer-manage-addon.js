'use strict';

const { createClient } = require('@supabase/supabase-js');

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

    const { error } = await supabase.from('customer_addons').upsert({
      customer_id: customer.id,
      addon_code: addonCode,
      status: 'active',
      billing_cycle: addonRef.billing_type,
      price_chf: addonRef.price_monthly_chf || addonRef.price_onetime_chf,
      starts_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
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
