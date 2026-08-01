'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { createClient } = require('@supabase/supabase-js');
const { requireAdminCaller } = require('./_lib/require-admin');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EXTRACTED_CHARS = 12_000;
const FETCH_TIMEOUT_MS = 12_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://admin.voxera.ch',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

const INDUSTRIES = new Set([
  'generic', 'versicherung', 'facharzt', 'zahnarzt', 'physiotherapie',
  'garage', 'hotel', 'restaurant', 'coiffeur', 'kosmetik', 'treuhand',
  'immobilien', 'handwerk', 'reinigung', 'it-support', 'fitness',
  'anwalt', 'baeckerei', 'digitalmarketing'
]);
const LANGUAGES = new Set(['de', 'fr', 'it', 'en']);
const ASSISTANT_FUNCTIONS = new Set([
  'information', 'consulting', 'lead', 'appointment',
  'quote', 'callback', 'support', 'transfer'
]);
const APPOINTMENT_MODES = new Set(['none', 'request', 'direct']);
const UNKNOWN_HANDLING = new Set(['transparent', 'callback', 'human']);

class ScrapeError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'ScrapeError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function response(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function isBlockedIpv4(address) {
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIp(address) {
  const normalized = String(address || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const version = net.isIP(normalized);
  if (version === 4) return isBlockedIpv4(normalized);
  if (version !== 6) return true;

  if (normalized.startsWith('::ffff:') || normalized.startsWith('64:ff9b:')) return true;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('2001:db8:')) return true;
  return false;
}

async function resolveTarget(rawUrl) {
  let target;
  try {
    target = new URL(String(rawUrl || '').trim());
  } catch (_error) {
    throw new ScrapeError(400, 'invalid_url', 'Bitte eine gültige Website-URL eingeben.');
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new ScrapeError(400, 'unsupported_protocol', 'Nur HTTP- und HTTPS-Websites sind zulässig.');
  }
  if (target.username || target.password) {
    throw new ScrapeError(400, 'url_credentials_not_allowed', 'URLs mit Zugangsdaten sind nicht zulässig.');
  }

  const expectedPort = target.protocol === 'https:' ? '443' : '80';
  if (target.port && target.port !== expectedPort) {
    throw new ScrapeError(400, 'unsupported_port', 'Nur der Standard-Port des gewählten Protokolls ist zulässig.');
  }

  target.hash = '';
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new ScrapeError(400, 'private_target', 'Lokale oder interne Ziele sind nicht zulässig.');
  }

  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    if (isBlockedIp(hostname)) {
      throw new ScrapeError(400, 'private_target', 'Lokale oder interne Ziele sind nicht zulässig.');
    }
    return { target, address: hostname, family: literalFamily };
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (_error) {
    throw new ScrapeError(502, 'dns_lookup_failed', 'Die Website-Adresse konnte nicht aufgelöst werden.');
  }

  if (!addresses.length || addresses.some(entry => isBlockedIp(entry.address))) {
    throw new ScrapeError(400, 'private_target', 'Lokale oder interne Ziele sind nicht zulässig.');
  }

  const selected = addresses[0];
  return { target, address: selected.address, family: selected.family };
}

async function validateTarget(rawUrl) {
  const resolved = await resolveTarget(rawUrl);
  return resolved.target;
}

function createPinnedLookup(address, family) {
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (options && options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

function requestPinnedTarget({ target, address, family }) {
  return new Promise((resolve, reject) => {
    const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const transport = target.protocol === 'https:' ? https : http;
    const requestOptions = {
      protocol: target.protocol,
      hostname,
      port: target.port || undefined,
      method: 'GET',
      path: (target.pathname || '/') + target.search,
      headers: {
        'Host': target.host,
        'User-Agent': 'Mozilla/5.0 (compatible; VoxeraWebsiteSetup/1.0; +https://voxera.ch)',
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9',
        'Accept-Encoding': 'identity'
      },
      lookup: createPinnedLookup(address, family)
    };

    if (target.protocol === 'https:' && !net.isIP(hostname)) {
      requestOptions.servername = hostname;
    }

    const request = transport.request(requestOptions, resolve);
    request.setTimeout(FETCH_TIMEOUT_MS, () => {
      const timeoutError = new Error('Website request timed out');
      timeoutError.code = 'ETIMEDOUT';
      request.destroy(timeoutError);
    });
    request.on('error', reject);
    request.end();
  });
}

async function readLimitedText(res) {
  const declaredLength = Number(res.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    res.destroy();
    throw new ScrapeError(413, 'website_too_large', 'Die Website ist für die automatische Analyse zu gross.');
  }

  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of res) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += value.length;
      if (bytes > MAX_RESPONSE_BYTES) {
        res.destroy();
        throw new ScrapeError(413, 'website_too_large', 'Die Website ist für die automatische Analyse zu gross.');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ScrapeError) throw error;
    throw new ScrapeError(502, 'website_read_failed', 'Die Website-Inhalte konnten nicht vollständig gelesen werden.');
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function fetchWebsite(rawUrl, redirectCount = 0) {
  const resolved = await resolveTarget(rawUrl);
  const { target } = resolved;

  let res;
  try {
    res = await requestPinnedTarget(resolved);
  } catch (error) {
    if (error && error.code === 'ETIMEDOUT') {
      throw new ScrapeError(504, 'website_timeout', 'Die Website hat nicht rechtzeitig geantwortet.');
    }
    throw new ScrapeError(502, 'website_unreachable', 'Die Website konnte nicht erreicht werden.');
  }

  const statusCode = Number(res.statusCode || 0);
  if ([301, 302, 303, 307, 308].includes(statusCode)) {
    if (redirectCount >= MAX_REDIRECTS) {
      res.destroy();
      throw new ScrapeError(502, 'too_many_redirects', 'Die Website leitet zu oft weiter.');
    }
    const location = res.headers.location;
    res.destroy();
    if (!location) {
      throw new ScrapeError(502, 'invalid_redirect', 'Die Website hat eine ungültige Weiterleitung geliefert.');
    }
    return fetchWebsite(new URL(location, target).toString(), redirectCount + 1);
  }

  if (statusCode < 200 || statusCode >= 300) {
    res.destroy();
    throw new ScrapeError(502, 'website_http_error', 'Die Website antwortete mit HTTP ' + statusCode + '.');
  }

  const contentType = String(res.headers['content-type'] || '').toLowerCase();
  if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !contentType.includes('text/plain')) {
    res.destroy();
    throw new ScrapeError(415, 'unsupported_content_type', 'Die URL liefert keine auslesbare HTML- oder Textseite.');
  }

  return { html: await readLimitedText(res), finalUrl: target.toString() };
}

function decodeNumericEntity(raw, radix) {
  const value = parseInt(raw, radix);
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return '';
  try {
    return String.fromCodePoint(value);
  } catch (_error) {
    return '';
  }
}

function decodeEntities(value) {
  const named = {
    nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>'
  };
  return String(value)
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_match, code) => decodeNumericEntity(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => decodeNumericEntity(code, 16));
}

function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS);
}

function parseAiJson(text) {
  const clean = String(text || '').replace(/\x60\x60\x60json|\x60\x60\x60/gi, '').trim();
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first < 0 || last <= first) {
    throw new Error('AI response did not contain JSON');
  }
  const parsed = JSON.parse(clean.slice(first, last + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI response was not an object');
  }
  return parsed;
}

function cleanResult(input) {
  const value = input && typeof input === 'object' ? input : {};
  const read = (key, max = 2000) => String(value[key] || '').trim().slice(0, max);
  const readList = (key, allowed, maxItems = 8) => {
    const raw = Array.isArray(value[key])
      ? value[key]
      : String(value[key] || '').split(/[,;\n]+/);
    return [...new Set(raw.map(item => String(item || '').trim().toLowerCase()).filter(item => allowed.has(item)))].slice(0, maxItems);
  };
  const industry = read('industry_guess', 40).toLowerCase();
  const language = read('language', 10).toLowerCase();
  const appointmentMode = read('appointment_mode', 20).toLowerCase();
  const unknownHandling = read('unknown_handling', 20).toLowerCase();
  return {
    company_name: read('company_name', 200),
    industry_guess: INDUSTRIES.has(industry) ? industry : 'generic',
    short_description: read('short_description', 1200),
    target_groups: read('target_groups', 1200),
    services: read('services', 3000),
    location_hours: read('location_hours', 2000),
    frequent_questions: read('frequent_questions', 2500),
    assistant_functions: readList('assistant_functions', ASSISTANT_FUNCTIONS),
    function_instructions: read('function_instructions', 3000),
    required_information: read('required_information', 2000),
    success_definition: read('success_definition', 1200),
    appointment_mode: APPOINTMENT_MODES.has(appointmentMode) ? appointmentMode : 'request',
    unknown_handling: UNKNOWN_HANDLING.has(unknownHandling) ? unknownHandling : 'callback',
    address: read('address', 500),
    phone: read('phone', 100),
    language: LANGUAGES.has(language) ? language : 'de'
  };
}

async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return response(405, { error: 'Method not allowed' });
  }

  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    return response(500, { error: 'Server-Konfiguration unvollständig.' });
  }

  const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const guard = await requireAdminCaller({
    event,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    sbAdmin,
    requiredCapability: 'customer:write'
  });
  if (!guard.ok) return response(guard.statusCode, guard.body);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_error) {
    return response(400, { error: 'Ungültige Anfrage.' });
  }
  if (!body.url) {
    return response(400, { error: 'Bitte eine Website-URL eingeben.' });
  }

  let website;
  try {
    website = await fetchWebsite(body.url);
  } catch (error) {
    const statusCode = error instanceof ScrapeError ? error.statusCode : 502;
    const code = error instanceof ScrapeError ? error.code : 'website_read_failed';
    console.warn('[scrape-website] website read failed', { code, message: error.message });
    return response(statusCode, { error: error.message || 'Website konnte nicht ausgelesen werden.', error_code: code });
  }

  const websiteContent = htmlToText(website.html);
  if (websiteContent.length < 80) {
    return response(422, {
      error: 'Auf der Website wurde zu wenig auslesbarer Text gefunden.',
      error_code: 'insufficient_content'
    });
  }

  const prompt = [
    'Analysiere den folgenden Website-Inhalt eines Schweizer Unternehmens und extrahiere strukturierte Informationen.',
    '',
    'Website-Inhalt:',
    websiteContent,
    '',
    'Antworte NUR mit einem JSON-Objekt (kein Markdown, keine Erklärungen):',
    '{',
    '  "company_name": "Firmenname",',
    '  "industry_guess": "eine von: generic, versicherung, facharzt, zahnarzt, physiotherapie, garage, hotel, restaurant, coiffeur, kosmetik, treuhand, immobilien, handwerk, reinigung, it-support, fitness, anwalt, baeckerei, digitalmarketing",',
    '  "short_description": "2-4 Sätze: Unternehmen, Nutzen und Positionierung; nur belegte Website-Angaben",',
    '  "target_groups": "Zielgruppen und typische Interessenten; sonst leer",',
    '  "services": "Konkrete Angebote und Hauptleistungen, eine pro Zeile",',
    '  "location_hours": "Öffnungszeiten, Einsatzgebiet und Adresse falls vorhanden",',
    '  "frequent_questions": "Häufige belegte Fragen und Antworten, eine pro Zeile; sonst leer",',
    '  "assistant_functions": ["eine oder mehrere von: information, consulting, lead, appointment, quote, callback, support, transfer"],',
    '  "function_instructions": "Konkrete Regeln, wie der Telefonassistent die erkannten Funktionen für dieses Unternehmen ausführen soll. Keine erfundenen Preise oder Zusagen.",',
    '  "required_information": "Welche Angaben der Assistent je nach Anliegen erfassen soll, eine pro Zeile",',
    '  "success_definition": "Wann ein Gespräch für dieses Unternehmen erfolgreich abgeschlossen ist",',
    '  "appointment_mode": "none, request oder direct. direct nur wenn die Website eine echte direkte Online-Buchung klar belegt",',
    '  "unknown_handling": "transparent, callback oder human",',
    '  "address": "Adresse falls vorhanden, sonst leer",',
    '  "phone": "Telefonnummer falls vorhanden, sonst leer",',
    '  "language": "de, fr, it oder en — Hauptsprache der Website"',
    '}'
  ].join('\n');

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!aiRes.ok) {
      throw new Error('Anthropic returned HTTP ' + aiRes.status);
    }
    const aiData = await aiRes.json();
    const extracted = cleanResult(parseAiJson(aiData?.content?.[0]?.text));

    return response(200, {
      success: true,
      data: extracted,
      source_url: website.finalUrl
    });
  } catch (error) {
    console.error('[scrape-website] AI extraction failed', { message: error.message });
    return response(502, {
      error: 'Die Website wurde gelesen, aber die Inhalte konnten nicht strukturiert ausgewertet werden.',
      error_code: 'ai_extraction_failed'
    });
  }
}

module.exports = {
  handler,
  isBlockedIpv4,
  isBlockedIp,
  validateTarget,
  resolveTarget,
  createPinnedLookup,
  htmlToText,
  parseAiJson,
  cleanResult
};
