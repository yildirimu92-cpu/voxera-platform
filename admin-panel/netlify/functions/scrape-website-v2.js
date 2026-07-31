'use strict';

const { handler: scrapeWebsite } = require('./scrape-website');

const FALLBACK_CODES = new Set([
  'website_unreachable',
  'website_timeout',
  'dns_lookup_failed',
  'website_http_error',
  'invalid_url'
]);

function normalizeCandidates(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return [];
  if (/^https?:\/\//i.test(raw)) return [raw];
  return [`https://${raw}`, `http://${raw}`];
}

function parseBody(result) {
  try { return JSON.parse(result?.body || '{}'); }
  catch (_error) { return {}; }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return scrapeWebsite(event);
  if (event.httpMethod !== 'POST') return scrapeWebsite(event);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_error) { return scrapeWebsite(event); }

  const candidates = normalizeCandidates(body.url);
  if (!candidates.length) return scrapeWebsite(event);

  let lastResult = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const result = await scrapeWebsite({
      ...event,
      body: JSON.stringify({ ...body, url: candidate })
    });
    const payload = parseBody(result);

    if (Number(result.statusCode) >= 200 && Number(result.statusCode) < 300 && payload.success) {
      payload.input_url = String(body.url || '').trim();
      payload.attempted_urls = candidates.slice(0, index + 1);
      return { ...result, body: JSON.stringify(payload) };
    }

    lastResult = result;
    const errorCode = String(payload.error_code || '');
    const mayFallback = index < candidates.length - 1 && FALLBACK_CODES.has(errorCode);
    if (!mayFallback) break;
  }

  if (!lastResult) return scrapeWebsite(event);
  const payload = parseBody(lastResult);
  payload.input_url = String(body.url || '').trim();
  payload.attempted_urls = candidates;
  return { ...lastResult, body: JSON.stringify(payload) };
};

module.exports.normalizeCandidates = normalizeCandidates;
