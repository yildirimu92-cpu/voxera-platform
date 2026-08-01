'use strict';

const crypto = require('crypto');

function encryptionKey() {
  const raw = String(process.env.CALENDAR_TOKEN_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('calendar_encryption_key_missing');
  const candidates = [];
  try { candidates.push(Buffer.from(raw, 'base64')); } catch (_error) {}
  if (/^[a-f0-9]{64}$/i.test(raw)) candidates.push(Buffer.from(raw, 'hex'));
  candidates.push(Buffer.from(raw, 'utf8'));
  const key = candidates.find((value) => value.length === 32);
  if (!key) throw new Error('calendar_encryption_key_invalid');
  return key;
}

function encryptSecret(value) {
  const plain = String(value || '');
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptSecret(value) {
  const raw = String(value || '');
  if (!raw) return '';
  const [version, ivRaw, tagRaw, dataRaw] = raw.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !dataRaw) throw new Error('calendar_secret_format_invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8');
}

function randomState() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashState(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeEqual(value, expected) {
  const left = Buffer.from(String(value || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = { encryptSecret, decryptSecret, randomState, hashState, safeEqual };
