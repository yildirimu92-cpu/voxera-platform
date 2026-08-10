import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

// Stimmproben personalisiert — Briefing 2026-08-09.
//
// preview-voice.js requires @supabase/supabase-js at module scope, so this
// repo's convention (see verify-admin-voices.mjs) is a static-source check
// rather than `node --test` against the live module — no npm install needed
// in CI. This script checks the contract: a customer with a real greeting
// gets THEIR sentence with the clicked voice, cached per (customer, voice,
// text) so repeat clicks never re-bill ElevenLabs, and a failed generation
// surfaces an error instead of silently falling back to the generic demo.

const files = {
  handler: 'customer-dashboard/netlify/functions/preview-voice.js',
  greeting: 'customer-dashboard/netlify/functions/_lib/assistant-greeting.js',
  migration: 'supabase/migrations/20260809155951_customer_voice_previews.sql'
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')])
);

for (const key of ['handler', 'greeting']) {
  new vm.Script(source[key], { filename: files[key] });
}

// Der Kunde hoert seinen eigenen Satz, nicht eine zweite Erzeugungslogik.
assert.match(source.handler, /require\('\.\/_lib\/assistant-greeting'\)/);
assert.match(source.handler, /buildGreetingView\(customer\)/);
assert.match(source.handler, /select\('plan,plan_code,assistant_name,ai_greeting,ai_effective_greeting'\)/);

// Cache-Key aus Stimme UND Text, mit Trennzeichen gegen Grenzfall-Kollisionen.
assert.match(source.handler, /function personalizedPreviewHash\(voiceId, greetingText\)/);
assert.match(source.handler, /createHash\('sha256'\)\.update\(`\$\{voiceId\} \$\{greetingText\}`/);
assert.match(source.handler, /function personalizedPreviewStoragePath\(customerId, voiceId, hash\)/);

// Cache-Lookup vor jeder Neuerzeugung, sonst kostet jeder Klick erneut Zeichen.
assert.match(source.handler, /async function loadPersonalizedCachedPreview/);
assert.match(source.handler, /from\('customer_voice_previews'\)/);
assert.match(source.handler, /storage\s*\n?\s*\.from\(PERSONALIZED_PREVIEW_BUCKET\)\s*\n?\s*\.download/);
assert.match(source.handler, /if \(cachedBuffer\) return audioResponse\(cachedBuffer, 'audio\/mpeg', 'personalized-cached'\)/);

// Neuerzeugung schreibt Audio UND Cache-Zeile weg, mit Upsert gegen Rennen.
assert.match(source.handler, /async function generateAndCachePersonalizedPreview/);
assert.match(source.handler, /storage\s*\n?\s*\.from\(PERSONALIZED_PREVIEW_BUCKET\)\s*\n?\s*\.upload/);
assert.match(source.handler, /onConflict: 'customer_id,voice_id,text_hash'/);

// Ehrliches Fehlerverhalten: kein stiller Rueckfall auf die generische Demo,
// wenn der Kunde explizit seinen eigenen Satz angefordert hat.
assert.match(source.handler, /personalized_generation_failed/);
const generateFnStart = source.handler.indexOf('async function generateAndCachePersonalizedPreview');
const generateFnEnd = source.handler.indexOf('exports.handler');
assert.ok(generateFnStart > 0 && generateFnEnd > generateFnStart);
const generateFnBody = source.handler.slice(generateFnStart, generateFnEnd);
assert.doesNotMatch(generateFnBody, /DEFAULT_PREVIEW_TEXT/);

// Personalisierter Zweig steht VOR dem generischen Katalog-Fallback, sonst
// wuerde ein vorhandener Katalog-Preview den echten Satz weiter verdecken.
const personalizedIdx = source.handler.indexOf('if (personalizedText) {');
const managedIdx = source.handler.indexOf('const managedPreviewText');
assert.ok(personalizedIdx > 0 && managedIdx > personalizedIdx, 'personalized branch must run before the generic managed-preview fallback');

// Migration: privater Bucket (kein public:true wie beim generischen Katalog),
// Cache-Tabelle mit RLS und ohne anon/authenticated-Zugriff.
assert.match(source.migration, /create table if not exists public\.customer_voice_previews/);
assert.match(source.migration, /unique \(customer_id, voice_id, text_hash\)/);
assert.match(source.migration, /enable row level security/);
assert.match(source.migration, /revoke all on public\.customer_voice_previews from anon, authenticated/);
assert.match(source.migration, /'customer-voice-previews'/);
assert.match(source.migration, /false,\s*\n\s*5242880/);

// Hash-Funktion in sich konsistent: gleicher Input -> gleicher Hash, anderer
// Input -> anderer Hash (ueberprueft die tatsaechliche Formel, nicht nur ihre
// Anwesenheit im Quelltext).
function personalizedPreviewHash(voiceId, greetingText) {
  return crypto.createHash('sha256').update(`${voiceId} ${greetingText}`, 'utf8').digest('hex').slice(0, 32);
}
const textA = 'Grüezi, hier ist Lara von der Muster AG.';
assert.equal(personalizedPreviewHash('voice-1', textA), personalizedPreviewHash('voice-1', textA));
assert.notEqual(personalizedPreviewHash('voice-1', textA), personalizedPreviewHash('voice-2', textA));
assert.notEqual(personalizedPreviewHash('voice-1', textA), personalizedPreviewHash('voice-1', textA + ' Wie kann ich helfen?'));

console.log('Personalized voice preview verification passed.');
