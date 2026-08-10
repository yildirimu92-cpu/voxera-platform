'use strict';

const { createClient } = require('@supabase/supabase-js');

// Nur noch Eingangspruefung: welches Ablaufdatum ein Addon bekommt und ob
// eine erneute Buchung addiert oder ueberschreibt, entscheidet
// activate_customer_addon_v1 in der Datenbank -- dort ist der Vorzustand der
// Zeile innerhalb derselben atomaren Anweisung sichtbar.
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

    // Verfuegbarkeitspruefung (coming_soon) und Preisuebernahme liegen in der
    // Funktion. Ein unbekanntes oder noch nicht freigegebenes Add-on meldet
    // sie als `addon_not_available`.
    const { data, error } = await supabase.rpc('activate_customer_addon_v1', {
      p_customer_id: customer.id,
      p_addon_code: addonCode,
      p_quantity: addonQuantity(body.quantity)
    });

    if (error) {
      if (String(error.message || '').includes('addon_not_available')) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Add-on nicht verfügbar' }) };
      }
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
    // Die Zeile wandert mit zurueck, damit der Aufrufer die aufaddierte Menge
    // und die neue Laufzeit anzeigen kann statt nur ein "hat geklappt".
    return { statusCode: 200, body: JSON.stringify({ success: true, addon: data }) };
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
