'use strict';

// Twilio request-signature verification, shared by every Netlify Function
// that receives a Twilio webhook. The HMAC check (requestHeader,
// validateTwilioSignature) is modeled byte-for-byte on the previously
// implemented and correct twilio-inbound-router.js:112-125.
//
// resolveStatusCallbackUrl() duplicates twilio-inbound-router.js's
// normalizeBaseUrl()/resolveStatusCallbackUrl() (lines 9-30) on purpose: it
// must reconstruct the exact same URL string that attachTwilioStatusCallback()
// in that file registered with Twilio as `StatusCallback`, or the signature
// will never validate. If that construction ever changes in
// twilio-inbound-router.js, this function must change with it.

const crypto = require('crypto');

function toStringOrEmpty(value) {
  if (value == null) return '';
  return String(value).trim();
}

function requestHeader(event, name) {
  const headers = event.headers || {};
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? String(headers[match] || '').trim() : '';
}

function computeTwilioSignature(authToken, requestUrl, payload) {
  const suffix = Object.keys(payload || {}).sort().map((key) => {
    const value = payload[key];
    return (Array.isArray(value) ? value : [value]).map((item) => key + String(item ?? '')).join('');
  }).join('');
  return crypto.createHmac('sha1', authToken).update(requestUrl + suffix, 'utf8').digest('base64');
}

function validateTwilioSignature(event, payload, requestUrl) {
  const authToken = toStringOrEmpty(process.env.TWILIO_AUTH_TOKEN);
  const provided = requestHeader(event, 'X-Twilio-Signature');
  const url = toStringOrEmpty(requestUrl);
  if (!authToken || !provided || !url) return false;

  const expected = computeTwilioSignature(authToken, url, payload);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function normalizeBaseUrl(rawUrl) {
  const raw = toStringOrEmpty(rawUrl);
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProtocol);
    return `${u.protocol}//${u.host}`;
  } catch (_err) {
    return '';
  }
}

function resolveStatusCallbackUrl() {
  const baseUrl = normalizeBaseUrl(
    process.env.TWILIO_STATUS_CALLBACK_BASE_URL
    || process.env.URL
    || process.env.DEPLOY_PRIME_URL
    || process.env.DEPLOY_URL
  );
  if (!baseUrl) return '';
  return `${baseUrl}/twilio/status-callback`;
}

module.exports = {
  toStringOrEmpty,
  requestHeader,
  computeTwilioSignature,
  validateTwilioSignature,
  normalizeBaseUrl,
  resolveStatusCallbackUrl
};
