'use strict';

/**
 * Regressionstest fuer den Kopfbereich "So meldet sich Ihr Assistent"
 * (Etappe 6 / S2).
 *
 * Der Begruessungssatz ist das visuelle Zentrum des Assistent-Screens. Drei
 * Dinge duerfen dabei nicht kippen:
 *   1. Ohne eingerichteten Agenten steht dort ein ehrlicher Platzhalter und
 *      kein erfundener Beispielsatz — das ist heute der Regelfall.
 *   2. Kundendaten laufen durch den Escaper.
 *   3. Die Statuszeile faerbt sich nur bei einer echten Abweichung.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'shared', 'customer-runtime-assistant-profile.js'),
  'utf8'
);

function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' nicht in customer-runtime-assistant-profile.js gefunden');
  let depth = 0;
  let seenBody = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') { depth += 1; seenBody = true; }
    else if (char === '}') {
      depth -= 1;
      if (seenBody && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('Funktionsende fuer ' + name + ' nicht gefunden');
}

function extractConst(name) {
  const start = source.indexOf('const ' + name + ' = [');
  assert.notEqual(start, -1, name + ' nicht in customer-runtime-assistant-profile.js gefunden');
  const end = source.indexOf('];', start);
  assert.notEqual(end, -1, 'Ende von ' + name + ' nicht gefunden');
  return source.slice(start, end + 2);
}

function renderHero(profile, voices, options) {
  const context = {
    profile,
    voices: voices || [],
    previewLoading: false,
    busy: false,
    toneEditorOpen: Boolean(options && options.toneEditorOpen),
    // Bewusst ein eigener, minimaler Escaper: laeuft ein Wert nicht durch esc(),
    // taucht er hier unveraendert auf und der Test schlaegt an.
    esc: (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char])),
    Intl,
    Number,
    Date,
    String
  };
  const code = [
    extractConst('ADDRESS_OPTIONS'),
    extractConst('TONE_OPTIONS'),
    extractFunction('toneLabel'),
    extractFunction('selectedVoice'),
    extractFunction('formatDay'),
    extractFunction('statusSummary'),
    extractFunction('optionList'),
    extractFunction('toneEditor'),
    extractFunction('heroCard'),
    'result = heroCard();'
  ].join('\n');
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.result;
}

test('ohne Agent steht ein Platzhalter statt eines erfundenen Satzes', () => {
  const html = renderHero({
    assistant: { tone: 'professional', address_form: 'sie' },
    greeting: { text: null, source: 'none' },
    technical_status: { assistant: { status: 'inactive' } }
  });
  assert.match(html, /is-pending/);
  assert.match(html, /sobald Ihr Assistent aktiviert ist/);
  assert.doesNotMatch(html, /Grüezi/);
});

test('die uebertragene Begruessung erscheint in Anfuehrungszeichen', () => {
  const html = renderHero({
    assistant: { tone: 'casual', address_form: 'du' },
    greeting: { text: 'Hoi, hier ist Lara.', source: 'effective' },
    technical_status: { assistant: { status: 'active' } }
  });
  assert.match(html, /„Hoi, hier ist Lara\."/);
  assert.doesNotMatch(html, /Noch nicht an den Assistenten übertragen/);
  assert.match(html, /Du-Form/);
  assert.match(html, /locker und direkt/);
});

test('eine gesetzte, aber nie synchronisierte Begruessung wird als solche ausgewiesen', () => {
  const html = renderHero({
    assistant: { tone: 'professional', address_form: 'sie' },
    greeting: { text: 'Guten Tag.', source: 'custom' },
    technical_status: {}
  });
  assert.match(html, /Noch nicht an den Assistenten übertragen/);
});

test('Kundendaten laufen durch den Escaper', () => {
  const html = renderHero({
    assistant: { tone: 'professional', address_form: 'sie' },
    greeting: { text: '<img src=x onerror=alert(1)>', source: 'effective' },
    technical_status: {}
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('die Statuszeile bleibt ohne Abweichung ruhig und faerbt sich sonst', () => {
  const calm = renderHero({
    assistant: {},
    greeting: { text: 'Guten Tag.', source: 'effective' },
    technical_status: {
      assistant: { status: 'active' },
      forwarding: { status: 'active' },
      voice_sync: { status: 'active' },
      calendar: { status: 'active' }
    }
  });
  assert.match(calm, /vx-ap-hero-status active/);
  assert.match(calm, /betriebsbereit/);

  const loud = renderHero({
    assistant: {},
    greeting: { text: 'Guten Tag.', source: 'effective' },
    technical_status: {
      assistant: { status: 'active' },
      forwarding: { status: 'error' },
      voice_sync: { status: 'attention' },
      calendar: { status: 'active' }
    }
  });
  assert.match(loud, /vx-ap-hero-status error/);
  assert.match(loud, /nicht betriebsbereit/);
});

test('der Anhoeren-Button erscheint nur mit ausgewaehlter Stimme', () => {
  const withoutVoice = renderHero({
    assistant: {},
    greeting: { text: 'Guten Tag.', source: 'effective' },
    technical_status: {}
  });
  assert.doesNotMatch(withoutVoice, /data-vx-preview/);
  assert.match(withoutVoice, /Stimme von Voxera eingerichtet/);

  const withVoice = renderHero(
    {
      assistant: { voice_id: 'v-1' },
      greeting: { text: 'Guten Tag.', source: 'effective' },
      technical_status: {}
    },
    [{ voice_id: 'v-1', display_name: 'Sofia' }]
  );
  assert.match(withVoice, /data-vx-preview="v-1"/);
  assert.match(withVoice, /Stimme Sofia/);
});

test('das Datum des letzten Syncs wird angehaengt, wenn vorhanden', () => {
  const html = renderHero({
    assistant: {},
    greeting: { text: 'Guten Tag.', source: 'effective' },
    technical_status: { last_successful_sync_at: '2026-07-14T09:30:00.000Z' }
  });
  assert.match(html, /Zuletzt aktualisiert am/);
  assert.match(html, /2026/);
});

// ── Etappe 6 / S3: Ansprache und Ton im Kopfbereich ─────────────────────────
// Die Sperre darf ausschliesslich an permissions.can_change_tone haengen. Steht
// im Frontend wieder ein Plan-Name, ist das Freischalten kein DB-Update mehr,
// sondern ein Deploy — genau der Zustand, den S3 abloest.

const baseProfile = (permissions) => ({
  assistant: { tone: 'professional', address_form: 'sie' },
  greeting: { text: 'Guten Tag.', source: 'effective' },
  technical_status: {},
  permissions: permissions || {}
});

test('geschlossen ist der Editor nur eine Zeile', () => {
  const html = renderHero(baseProfile({ can_change_tone: true }));
  assert.match(html, /data-vx-tone-edit/);
  assert.match(html, /Ansprache und Ton anpassen/);
  assert.doesNotMatch(html, /vx-hero-tune-save/);
});

test('freigeschaltet sind beide Felder bedienbar', () => {
  const html = renderHero(baseProfile({ can_change_tone: true }), [], { toneEditorOpen: true });
  assert.match(html, /<select id="vx-hero-address"[^>]*>/);
  assert.match(html, /<select id="vx-hero-tone">/);
  assert.doesNotMatch(html, /vx-ap-plan-badge/);
  assert.match(html, /vx-hero-tune-save/);
});

test('gesperrt bleibt der Ton lesbar, die Anrede aber aenderbar', () => {
  const html = renderHero(baseProfile({ can_change_tone: false }), [], { toneEditorOpen: true });
  // Der Ton ist markiert und deaktiviert — nicht ausgegraut und nicht versteckt.
  assert.match(html, /vx-ap-plan-badge">ab Business</);
  assert.match(html, /<select id="vx-hero-tone" disabled>/);
  assert.match(html, /ab dem Business-Paket/);
  // Die Anrede ist eine Frage der Grundhoeflichkeit und bleibt frei.
  assert.match(html, /<select id="vx-hero-address">/);
});

test('fehlende Berechtigungen sperren, statt versehentlich zu oeffnen', () => {
  const html = renderHero(baseProfile(), [], { toneEditorOpen: true });
  assert.match(html, /<select id="vx-hero-tone" disabled>/);
});

test('die aktuellen Werte sind vorausgewaehlt', () => {
  const profile = baseProfile({ can_change_tone: true });
  profile.assistant = { tone: 'casual', address_form: 'du' };
  const html = renderHero(profile, [], { toneEditorOpen: true });
  assert.match(html, /<option value="du" selected>/);
  assert.match(html, /<option value="casual" selected>/);
  assert.doesNotMatch(html, /<option value="sie" selected>/);
});

test('kein Plan-Name im gerenderten Kopfbereich', () => {
  for (const permissions of [{ can_change_tone: true }, { can_change_tone: false }]) {
    const html = renderHero(baseProfile(permissions), [], { toneEditorOpen: true });
    assert.doesNotMatch(html, /starter|professional_plan|plan_code/i);
  }
});
