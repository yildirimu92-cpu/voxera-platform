'use strict';

const crypto = require('crypto');

function trimOrNull(value) {
  const v = String(value || '').trim();
  return v || null;
}

function ensureOfferPublicToken(offer) {
  const existing = trimOrNull(offer?.public_token);
  if (existing) return existing;
  return crypto.randomBytes(24).toString('hex');
}

function normalizeBaseUrl() {
  const raw = trimOrNull(process.env.PUBLIC_APP_BASE_URL)
    || trimOrNull(process.env.ADMIN_PANEL_BASE_URL)
    || trimOrNull(process.env.APP_BASE_URL)
    || trimOrNull(process.env.URL);
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

function normalizePublicSiteUrl() {
  // Separate Base-URL für kundenseitige Seiten (voxera.ch, nicht admin.voxera.ch)
  const raw = trimOrNull(process.env.PUBLIC_SITE_BASE_URL) || trimOrNull(process.env.PUBLIC_OFFER_BASE_URL) || normalizeBaseUrl();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

function derivePublicOfferAcceptanceUrl(publicToken) {
  const base = normalizePublicSiteUrl();
  if (!base || !publicToken) return null;
  return `${base}/offer-accept.html?token=${encodeURIComponent(publicToken)}`;
}

function derivePublicOfferPdfUrl(publicToken) {
  const base = normalizePublicSiteUrl();
  if (!base || !publicToken) return null;
  return `${base}/offer-pdf.html?token=${encodeURIComponent(publicToken)}`;
}

function resolvePublicExpiryFromOffer(offer) {
  if (offer?.public_expires_at) return offer.public_expires_at;
  if (!offer?.valid_until) return null;
  const date = new Date(`${String(offer.valid_until).slice(0, 10)}T23:59:59.999Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

module.exports = {
  trimOrNull,
  ensureOfferPublicToken,
  derivePublicOfferAcceptanceUrl,
  derivePublicOfferPdfUrl,
  resolvePublicExpiryFromOffer
};
