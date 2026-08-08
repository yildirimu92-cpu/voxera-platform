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

function renderHero(profile, voices) {
  const context = {
    profile,
    voices: voices || [],
    previewLoading: false,
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
    extractFunction('toneLabel'),
    extractFunction('selectedVoice'),
    extractFunction('formatDay'),
    extractFunction('statusSummary'),
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
