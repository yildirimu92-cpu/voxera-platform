'use strict';

// Einzige Quelle der Wahrheit für die effektiv genutzte Stimme.
//
// Vorher entschieden Sync und Vorschau jeweils selbst und liessen bei fehlender
// voice_id den TTS-Patch stillschweigend weg. Der ElevenLabs-Agent behielt dann
// eine beliebige frühere Stimme, während der Prompt weiterhin von einer
// weiblichen Assistenz sprach. Ab hier gilt: es gibt immer eine definierte
// Stimme, oder ein benannter Grund, warum keine ermittelt werden konnte.

const DEFAULT_ASSISTANT_GENDER = 'female';
const VOICE_FIELDS = 'voice_id,gender,display_name,is_default,is_active';

function normalizeGender(value) {
  return String(value || '').trim().toLowerCase() === 'male' ? 'male' : DEFAULT_ASSISTANT_GENDER;
}

async function loadCatalogDefault(sb) {
  const { data, error } = await sb
    .from('voxera_voices')
    .select(VOICE_FIELDS)
    .eq('is_default', true)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

/**
 * Ermittelt die Stimme, die tatsächlich an ElevenLabs gehen soll.
 *
 * source erklärt die Herkunft und wird ins Sync-Log geschrieben:
 *   customer          – der Kunde hat eine gültige, aktive Stimme gewählt
 *   catalog_default   – keine Kundenwahl vorhanden, Katalog-Default greift
 *   catalog_fallback  – Kundenwahl existiert, ist aber inaktiv/unbekannt
 *   none              – der Katalog hat keine aktive Default-Stimme
 */
async function resolveAssistantVoice(sb, customer) {
  const configured = String(customer?.voice_id || '').trim();

  if (configured) {
    const { data, error } = await sb
      .from('voxera_voices')
      .select(VOICE_FIELDS)
      .eq('voice_id', configured)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      return {
        voiceId: data.voice_id,
        gender: normalizeGender(data.gender),
        displayName: data.display_name || null,
        source: 'customer'
      };
    }
  }

  const fallback = await loadCatalogDefault(sb);
  if (!fallback) {
    return {
      voiceId: null,
      gender: DEFAULT_ASSISTANT_GENDER,
      displayName: null,
      source: 'none'
    };
  }

  return {
    voiceId: fallback.voice_id,
    gender: normalizeGender(fallback.gender),
    displayName: fallback.display_name || null,
    source: configured ? 'catalog_fallback' : 'catalog_default'
  };
}

module.exports = {
  DEFAULT_ASSISTANT_GENDER,
  normalizeGender,
  resolveAssistantVoice
};
