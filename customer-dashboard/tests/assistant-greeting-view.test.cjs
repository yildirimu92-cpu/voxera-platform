'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGreetingView } = require('../netlify/functions/_lib/assistant-greeting');

test('uses the greeting the agent actually received', () => {
  const view = buildGreetingView({
    ai_effective_greeting: 'Grüezi, hier ist Lara von der Muster AG.',
    ai_greeting: 'Alter Entwurf'
  });
  assert.equal(view.source, 'effective');
  assert.equal(view.text, 'Grüezi, hier ist Lara von der Muster AG.');
});

test('falls back to the customer greeting when no sync has run yet', () => {
  const view = buildGreetingView({ ai_greeting: 'Guten Tag, hier ist Lara.' });
  assert.equal(view.source, 'custom');
  assert.equal(view.text, 'Guten Tag, hier ist Lara.');
});

test('reports none instead of inventing a sentence', () => {
  const view = buildGreetingView({});
  assert.equal(view.source, 'none');
  assert.equal(view.text, null);
});

test('treats whitespace-only values as absent', () => {
  const view = buildGreetingView({ ai_effective_greeting: '   ', ai_greeting: '\n\t' });
  assert.equal(view.source, 'none');
  assert.equal(view.text, null);
});

test('trims a stored greeting before handing it to the dashboard', () => {
  const view = buildGreetingView({ ai_effective_greeting: '  Grüezi.  ' });
  assert.equal(view.text, 'Grüezi.');
});
