// Prueft die Telefonnummern-Zuweisung an einen ElevenLabs-Agenten.
//
// WARUM VERHALTEN STATT QUELLTEXT-LITERALE
//
// Die erste Fassung dieses Skripts suchte zehn Zeichenketten im Quelltext des
// Helfers, darunter "status: 'imported_and_assigned'". Diese Zeichenkette hat
// dort nie existiert -- der Helfer schreibt den Status seit dem ersten Commit
// ueber einen Ternaeroperator (imported ? 'imported_and_assigned' :
// 'assigned'). Das Skript entstand drei Minuten nach dem Helfer und ist
// offenbar nie ausgefuehrt worden; es war nie gruen und hat nie etwas
// bestaetigt. Ein Check, der Abdeckung suggeriert, ohne zu messen, ist
// gefaehrlicher als gar keiner.
//
// Die Proben unten rufen ensureAgentPhoneNumber deshalb wirklich auf, mit
// gestubbtem fetch, und pruefen die vier Rueckgabezustaende, die abgesetzten
// HTTP-Aufrufe und die Fehlerpfade. Ein Ternaer, eine Umbenennung oder eine
// andere Formatierung koennen daran nichts mehr vorbei brechen -- eine
// geaenderte Semantik dagegen schon.
//
// Als Quelltext-Pruefung bleiben nur die Faelle, die sich nicht durch Aufruf
// zeigen lassen: fest verdrahtete Telefonnummern, Agent-IDs oder Twilio-Tokens
// (Abwesenheit ist nicht aufrufbar) sowie die Einbindung im Sync-Handler, der
// als Netlify-Handler mit Supabase-Abhaengigkeit hier nicht instanziierbar ist.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);

const HELPER_PATH = 'admin-panel/netlify/functions/_lib/elevenlabs-phone-number.js';
const SYNC_PATH = 'admin-panel/netlify/functions/trigger-elevenlabs-sync.js';
const API_BASE = 'https://api.elevenlabs.io/v1/convai/phone-numbers';

const failures = [];
const check = (name, fn) => {
  try { fn(); }
  catch (error) { failures.push(`${name}: ${error.message}`); }
};

// ── Quelltext einlesen und auf Parsierbarkeit pruefen ───────────────────────

const source = {};
for (const [key, path] of Object.entries({ helper: HELPER_PATH, sync: SYNC_PATH })) {
  source[key] = fs.readFileSync(path, 'utf8');
  check(`${key} parst`, () => { new vm.Script(source[key], { filename: path }); });
}

const { ensureAgentPhoneNumber } = require(`../${HELPER_PATH}`);

// ── fetch-Stub ──────────────────────────────────────────────────────────────
//
// Zeichnet jeden Aufruf auf und beantwortet ihn aus `routes`. Antworten ohne
// `ok` gelten als 200; damit laesst sich auch der Fehlerpfad stellen.

const realFetch = globalThis.fetch;

async function withStub(routes, fn) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body === undefined ? null : JSON.parse(init.body)
    };
    calls.push(call);
    const reply = routes(call) || {};
    const status = reply.status || 200;
    return {
      ok: reply.ok === undefined ? status < 400 : reply.ok,
      status,
      text: async () => JSON.stringify(reply.payload === undefined ? {} : reply.payload)
    };
  };
  try { return { result: await fn(), calls }; }
  finally { globalThis.fetch = realFetch; }
}

// Jede Probe einzeln kapseln. Ohne das reisst ein unerwarteter Wurf in einer
// fruehen Probe den ganzen Lauf ab, und die spaeteren Proben melden nichts --
// der Bericht zeigte dann einen Abbruch statt der Liste der Befunde.
async function probe(name, fn) {
  try { await fn(); }
  catch (error) { failures.push(`${name}: unerwarteter Abbruch -- ${error.message}`); }
}

async function expectRejection(name, fn, expected) {
  try {
    await fn();
    failures.push(`${name}: erwarteter Fehler "${expected}" blieb aus`);
  } catch (error) {
    if (error.message !== expected) {
      failures.push(`${name}: erwartet "${expected}", bekam "${error.message}"`);
    }
  }
}

const withTwilioEnv = async (sid, token, fn) => {
  const before = {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN
  };
  if (sid === null) delete process.env.TWILIO_ACCOUNT_SID; else process.env.TWILIO_ACCOUNT_SID = sid;
  if (token === null) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = token;
  try { return await fn(); }
  finally {
    if (before.sid === undefined) delete process.env.TWILIO_ACCOUNT_SID; else process.env.TWILIO_ACCOUNT_SID = before.sid;
    if (before.token === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = before.token;
  }
};

const numberItem = (overrides = {}) => ({
  phone_number: '+41441234567',
  phone_number_id: 'pn_1',
  ...overrides
});

const customer = { voxera_number: '044 123 45 67', customer_name: 'Muster AG' };

async function run() {
  // 1) Kunde ohne Nummer: sauberer Ausstieg, und zwar OHNE Netzaufruf. Ein
  //    Aufruf hier waere eine unnoetige API-Runde je Sync.
  await probe('Probe 1 ohne Nummer', async () => {
    const { result, calls } = await withStub(() => ({}), () =>
      ensureAgentPhoneNumber({ apiKey: 'k', agentId: 'agent_x', customer: { voxera_number: '' } }));
    check('ohne Nummer: Status', () => assert.equal(result.status, 'skipped_no_number'));
    check('ohne Nummer: keine Nummer gemeldet', () => {
      assert.equal(result.phone_number, null);
      assert.equal(result.phone_number_id, null);
    });
    check('ohne Nummer: kein HTTP-Aufruf', () => assert.equal(calls.length, 0));
  });

  // 2) Nummer bereits am richtigen Agenten: keine Zuweisung mehr noetig.
  await probe('Probe 2 bereits zugewiesen', async () => {
    const { result, calls } = await withStub(
      () => ({ payload: { phone_numbers: [numberItem({ assigned_agent: { agent_id: 'agent_x' } })] } }),
      () => ensureAgentPhoneNumber({ apiKey: 'k', agentId: 'agent_x', customer }));
    check('bereits zugewiesen: Status', () => assert.equal(result.status, 'already_assigned'));
    check('bereits zugewiesen: ID durchgereicht', () => assert.equal(result.phone_number_id, 'pn_1'));
    check('bereits zugewiesen: kein PATCH', () => {
      assert.equal(calls.length, 1, `erwartet 1 Aufruf, bekam ${calls.length}`);
      assert.equal(calls[0].method, 'GET');
    });
    check('Basis-URL und API-Key-Header', () => {
      assert.equal(calls[0].url, API_BASE);
      assert.equal(calls[0].headers['xi-api-key'], 'k');
    });
  });

  // 3) Nummer vorhanden, haengt aber an einem anderen Agenten: umhaengen.
  await probe('Probe 3 umhaengen', async () => {
    const { result, calls } = await withStub(
      (call) => call.method === 'PATCH'
        ? { payload: numberItem() }
        : { payload: { phone_numbers: [numberItem({ assigned_agent: { agent_id: 'agent_alt' } })] } },
      () => ensureAgentPhoneNumber({ apiKey: 'k', agentId: 'agent_neu', customer }));
    check('umhaengen: Status', () => assert.equal(result.status, 'assigned'));
    check('umhaengen: PATCH auf die Nummer', () => {
      const patch = calls.find(c => c.method === 'PATCH');
      assert.ok(patch, 'kein PATCH abgesetzt');
      assert.equal(patch.url, `${API_BASE}/pn_1`);
      assert.deepEqual(patch.body, { agent_id: 'agent_neu' });
    });
    check('umhaengen: kein Import', () => {
      assert.equal(calls.filter(c => c.method === 'POST').length, 0);
    });
  });

  // 4) Nummer bei ElevenLabs unbekannt: aus Twilio importieren, dann zuweisen.
  //    Das ist der Pfad, den die alte Fassung pruefen wollte und nie traf.
  await probe('Probe 4 Import', async () => {
    const { result, calls } = await withTwilioEnv('AC_test', 'tok_test', () => withStub(
      (call) => {
        if (call.method === 'POST') return { payload: { phone_number_id: 'pn_neu' } };
        if (call.method === 'PATCH') return { payload: numberItem({ phone_number_id: 'pn_neu' }) };
        return { payload: { phone_numbers: [] } };
      },
      () => ensureAgentPhoneNumber({ apiKey: 'k', agentId: 'agent_x', customer })));
    check('Import: Status', () => assert.equal(result.status, 'imported_and_assigned'));
    check('Import: POST mit Twilio-Zugangsdaten aus der Umgebung', () => {
      const post = calls.find(c => c.method === 'POST');
      assert.ok(post, 'kein Import-POST abgesetzt');
      assert.equal(post.url, API_BASE);
      assert.equal(post.body.provider, 'twilio');
      assert.equal(post.body.phone_number, '+41441234567');
      assert.equal(post.body.sid, 'AC_test');
      assert.equal(post.body.token, 'tok_test');
      assert.ok(String(post.body.label).startsWith('Voxera'), 'Label ohne Voxera-Praefix');
    });
    check('Import: danach PATCH auf die neue ID', () => {
      const patch = calls.find(c => c.method === 'PATCH');
      assert.ok(patch, 'kein PATCH nach dem Import');
      assert.equal(patch.url, `${API_BASE}/pn_neu`);
      assert.deepEqual(patch.body, { agent_id: 'agent_x' });
    });
    check('Import: gemeldete Nummer und ID', () => {
      assert.equal(result.phone_number, '+41441234567');
      assert.equal(result.phone_number_id, 'pn_neu');
    });
  });

  // 5) Schweizer Nummernformate landen auf derselben E.164-Form -- sonst
  //    importiert der Sync dieselbe Nummer ein zweites Mal.
  for (const variante of ['044 123 45 67', '+41 44 123 45 67', '0041441234567', '(044) 123-45-67']) {
    // Trifft die Normalisierung nicht, gilt die Nummer als unbekannt und der
    // Helfer laeuft in den Import -- der hier ohne Twilio-Umgebung wirft. Das
    // wird abgefangen, damit die Meldung die Ursache nennt und nicht als
    // Abbruch des ganzen Laufs erscheint.
    try {
      const { result } = await withStub(
        () => ({ payload: { phone_numbers: [numberItem({ assigned_agent: { agent_id: 'agent_x' } })] } }),
        () => ensureAgentPhoneNumber({ apiKey: 'k', agentId: 'agent_x', customer: { voxera_number: variante } }));
      check(`Normalisierung "${variante}"`, () => assert.equal(result.status, 'already_assigned',
        `ergab "${result.status}" statt "already_assigned" -- Nummer wurde nicht als dieselbe erkannt`));
    } catch (error) {
      failures.push(`Normalisierung "${variante}": nicht auf +41441234567 abgebildet (${error.message})`);
    }
  }

  // 6) Fehlerpfade. Jeder davon darf nicht still in eine Zuweisung laufen.
  await expectRejection('ohne Agent-ID',
    () => withStub(() => ({}), () => ensureAgentPhoneNumber({ apiKey: 'k', agentId: '', customer })),
    'elevenlabs_agent_id_missing');

  await expectRejection('ohne API-Key',
    () => withStub(() => ({}), () => ensureAgentPhoneNumber({ apiKey: '', agentId: 'agent_x', customer })),
    'elevenlabs_api_key_missing');

  await expectRejection('mehrdeutige Nummer',
    () => withStub(
      () => ({ payload: { phone_numbers: [numberItem(), numberItem({ phone_number_id: 'pn_2' })] } }),
      () => ensureAgentPhoneNumber({ apiKey: 'k', agentId: 'agent_x', customer })),
    'elevenlabs_duplicate_phone_number_match');

  await expectRejection('Import ohne Twilio-Konfiguration',
    () => withTwilioEnv(null, null, () => withStub(
      () => ({ payload: { phone_numbers: [] } }),
      () => ensureAgentPhoneNumber({ apiKey: 'k', agentId: 'agent_x', customer }))),
    'twilio_configuration_missing_for_elevenlabs_phone_import');

  // 7) Ein HTTP-Fehler der API darf nicht als Erfolg durchgehen.
  await probe('Probe 7 API-Fehler', async () => {
    const { calls } = await withStub(() => ({ status: 422, payload: { detail: 'nope' } }), async () => {
      try {
        await ensureAgentPhoneNumber({ apiKey: 'k', agentId: 'agent_x', customer });
        failures.push('API-Fehler: 422 wurde nicht als Fehler behandelt');
      } catch (error) {
        check('API-Fehler: Status durchgereicht', () => assert.equal(error.status, 422));
        check('API-Fehler: Meldung nennt den Grund', () => assert.match(error.message, /422/));
      }
    });
    check('API-Fehler: kein Folgeaufruf', () => assert.equal(calls.length, 1));
  });

  // ── Quelltext-Pruefungen, die sich nicht aufrufen lassen ──────────────────

  for (const token of [
    "require('./_lib/elevenlabs-phone-number')",
    'ensureAgentPhoneNumber({',
    'phone_number_status: phoneNumberStatus',
    'phone_number_id: phoneNumberId'
  ]) {
    check('Sync-Einbindung', () => assert.ok(source.sync.includes(token), `fehlt: ${token}`));
  }

  for (const forbidden of [
    /phone_number:\s*['"]\+\d+['"]/,
    /agent_id:\s*['"][A-Za-z0-9_-]{10,}['"]/,
    /TWILIO_AUTH_TOKEN\s*=\s*['"][^'"]+['"]/
  ]) {
    check('keine fest verdrahteten Telefoniewerte', () => {
      assert.ok(!forbidden.test(source.helper), `Helper: ${forbidden}`);
      assert.ok(!forbidden.test(source.sync), `Sync: ${forbidden}`);
    });
  }
}

run().then(() => {
  if (failures.length) {
    console.error(failures.join('\n'));
    console.error(`\nElevenLabs phone number assignment verification failed (${failures.length}).`);
    process.exit(1);
  }
  console.log('ElevenLabs phone number assignment verification passed.');
}).catch((error) => {
  console.error('Verifikation abgebrochen:', error?.stack || error?.message || error);
  process.exit(1);
});
