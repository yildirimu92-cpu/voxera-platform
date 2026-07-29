'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
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

async function validateTarget(rawUrl) {
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
  if (target.port && !['80', '443'].includes(target.port)) {
    throw new ScrapeError(400, 'unsupported_port', 'Nur die Standard-Ports 80 und 443 sind zulässig.');
  }

  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new ScrapeError(400, 'private_target', 'Lokale oder interne Ziele sind nicht zulässig.');
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new ScrapeError(400, 'private_target', 'Lokale oder interne Ziele sind nicht zulässig.');
    }
    return target;
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

  return target;
}

async function readLimitedText(res) {
  const declaredLength = Number(res.headers.get('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new ScrapeError(413, 'website_too_large', 'Die Website ist für die automatische Analyse zu gross.');
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new ScrapeError(413, 'website_too_large', 'Die Website ist für die automatische Analyse zu gross.');
    }
    return text;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ScrapeError(413, 'website_too_large', 'Die Website ist für die automatische Analyse zu gross.');
    }
    chunks.push(Buffer.from(result.value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchWebsite(rawUrl, redirectCount = 0) {
  const target = await validateTarget(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(target, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VoxeraWebsiteSetup/1.0; +https://voxera.ch)',
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9'
      }
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new ScrapeError(504, 'website_timeout', 'Die Website hat nicht rechtzeitig geantwortet.');
    }
    throw new ScrapeError(502, 'website_unreachable', 'Die Website konnte nicht erreicht werden.');
  } finally {
    clearTimeout(timeout);
  }

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    if (redirectCount >= MAX_REDIRECTS) {
      throw new ScrapeError(502, 'too_many_redirects', 'Die Website leitet zu oft weiter.');
    }
    const location = res.headers.get('location');
    if (!location) {
      throw new ScrapeError(502, 'invalid_redirect', 'Die Website hat eine ungültige Weiterleitung geliefert.');
    }
    if (res.body && typeof res.body.cancel === 'function') {
      await res.body.cancel().catch(() => {});
    }
    return fetchWebsite(new URL(location, target).toString(), redirectCount + 1);
  }

  if (!res.ok) {
    throw new ScrapeError(502, 'website_http_error', 'Die Website antwortete mit HTTP ' + res.status + '.');
  }

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !contentType.includes('text/plain')) {
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
  const industry = read('industry_guess', 40).toLowerCase();
  const language = read('language', 10).toLowerCase();
  return {
    company_name: read('company_name', 200),
    industry_guess: INDUSTRIES.has(industry) ? industry : 'generic',
    short_description: read('short_description', 1000),
    services: read('services', 3000),
    location_hours: read('location_hours', 2000),
    address: read('address', 500),
    phone: read('phone', 100),
    language: LANGUAGES.has(language) ? language : 'de'
  };
}

exports.handler = async (event) => {
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
    '  "short_description": "1-2 Sätze Beschreibung",',
    '  "services": "Hauptleistungen, kommagetrennt",',
    '  "location_hours": "Öffnungszeiten und Adresse falls vorhanden",',
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
        max_tokens: 900,
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
};

module.exports = {
  isBlockedIpv4,
  isBlockedIp,
  validateTarget,
  htmlToText,
  parseAiJson,
  cleanResult
};
