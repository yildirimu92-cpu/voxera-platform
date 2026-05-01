/**
 * offer-acceptance.js — PATCH für 3-Checkbox Legal Flow
 * 
 * ANLEITUNG: Ergänze in deiner offer-acceptance.js Netlify Function
 * die nachfolgenden Felder beim Supabase-Update der Offerte.
 * 
 * Voraussetzung: Supabase-Migration (siehe unten) muss zuerst laufen.
 * 
 * ─────────────────────────────────────────────────────────────────
 * SCHRITT 1: Supabase Migration ausführen
 * ─────────────────────────────────────────────────────────────────
 * 
 * In deinem Supabase SQL Editor ausführen:
 * 
 *   ALTER TABLE offers
 *     ADD COLUMN IF NOT EXISTS agb_accepted     boolean DEFAULT false,
 *     ADD COLUMN IF NOT EXISTS agb_version      text,
 *     ADD COLUMN IF NOT EXISTS avv_accepted     boolean DEFAULT false,
 *     ADD COLUMN IF NOT EXISTS avv_version      text,
 *     ADD COLUMN IF NOT EXISTS dse_accepted     boolean DEFAULT false,
 *     ADD COLUMN IF NOT EXISTS dse_version      text;
 * 
 * ─────────────────────────────────────────────────────────────────
 * SCHRITT 2: offer-acceptance.js anpassen
 * ─────────────────────────────────────────────────────────────────
 * 
 * Suche in offer-acceptance.js nach dem Supabase-Update der Offerte.
 * Es sollte ungefähr so aussehen:
 * 
 *   const { error: updateError } = await supabase
 *     .from('offers')
 *     .update({
 *       status: 'accepted',
 *       accepted_at: new Date().toISOString(),
 *       signer_name,
 *       signer_email,
 *       signature_data,
 *       confirm_accepted: true,
 *     })
 *     .eq('id', offer.id);
 * 
 * Ersetze diesen Block durch:
 */

// ── NEUER Update-Block ─────────────────────────────────────────────────────

const {
  token,
  signer_name,
  signer_email,
  signature_data,
  // Neue Felder (kommen vom neuen offer-accept.html)
  agb_accepted = false,
  agb_version  = null,
  avv_accepted = false,
  avv_version  = null,
  dse_accepted = false,
  dse_version  = null,
  // Legacy-Feld — bleibt zur Rückwärtskompatibilität
  confirm_accepted = false,
} = body; // body = JSON.parse(event.body) wie bisher

// Validierung (ergänze diese Checks zu deinen bestehenden Validierungen)
if (!agb_accepted) {
  return { statusCode: 400, body: JSON.stringify({ error: 'AGB müssen akzeptiert werden.' }) };
}
if (!avv_accepted) {
  return { statusCode: 400, body: JSON.stringify({ error: 'AVV muss akzeptiert werden.' }) };
}
if (!dse_accepted) {
  return { statusCode: 400, body: JSON.stringify({ error: 'Datenschutzerklärung muss zur Kenntnis genommen werden.' }) };
}

// Supabase Update — ersetze deinen bestehenden .update()-Aufruf:
const { error: updateError } = await supabase
  .from('offers')
  .update({
    status:           'accepted',
    accepted_at:      new Date().toISOString(),
    signer_name,
    signer_email,
    signature_data,
    // Legacy
    confirm_accepted: true,
    // Neu: 3 separate Zustimmungen mit Versionsangabe
    agb_accepted,
    agb_version,
    avv_accepted,
    avv_version,
    dse_accepted,
    dse_version,
  })
  .eq('id', offer.id); // offer.id wie bisher aus dem token-lookup

/**
 * ─────────────────────────────────────────────────────────────────
 * SCHRITT 3: Verifizierung
 * ─────────────────────────────────────────────────────────────────
 * 
 * Nach dem Deployment:
 * 1. Test-Offerte an dich selbst senden
 * 2. Im Accept-Flow alle 3 Checkboxen anklicken und unterschreiben
 * 3. In Supabase prüfen:
 *    SELECT id, agb_accepted, agb_version, avv_accepted, avv_version,
 *           dse_accepted, dse_version, accepted_at
 *    FROM offers
 *    WHERE accepted_at IS NOT NULL
 *    ORDER BY accepted_at DESC
 *    LIMIT 5;
 * 
 * ─────────────────────────────────────────────────────────────────
 * SCHRITT 4: Admin-Portal (index.html)
 * ─────────────────────────────────────────────────────────────────
 * 
 * Opcional: Im Admin-Portal die Annahme-Details anzeigen.
 * Im Offer-Detail-Modal kannst du ergänzen:
 * 
 *   AGB: ${offer.agb_version || '—'} ✓
 *   AVV: ${offer.avv_version || '—'} ✓
 *   DSE: ${offer.dse_version || '—'} ✓
 *   Angenommen: ${formatDate(offer.accepted_at)}
 *   Unterzeichnet von: ${offer.signer_name} (${offer.signer_email})
 * 
 * ─────────────────────────────────────────────────────────────────
 * SCHRITT 5 (PRIO 3): AVV-PDF als E-Mail-Anhang
 * ─────────────────────────────────────────────────────────────────
 * 
 * Das ist die nächste Aufgabe (Prio 3 in deiner Liste).
 * Im mail-dispatch.js beim Offer-Versand den AVV-PDF-Anhang ergänzen.
 * Dafür brauchen wir die avv-voxera.pdf irgendwo zugänglich (z.B.
 * Supabase Storage oder als Base64 im Code hardcoded).
 */
