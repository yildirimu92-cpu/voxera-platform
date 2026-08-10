#!/usr/bin/env node
/**
 * Wächter für die drei nachgerüsteten Einstiegspunkte im Admin-Portal.
 *
 * Alle drei Funktionen waren vollständig geschrieben und von keiner Stelle des
 * Portals aus erreichbar. Bei zweien fehlte ausserdem die Gegenstelle:
 *
 *   - resendInvite          war fertig, es fehlte nur der Aufruf
 *   - Kulanzgutschrift      rief eine Server-Aktion, die es nicht gab
 *   - markCallReviewed      schrieb nur in den lokalen Zustand, nie in die DB
 *
 * Dieses Skript prüft beides zusammen: dass die Einstiege da sind UND dass sie
 * auf etwas zeigen, das tatsächlich existiert. Ein Knopf, der ins Leere greift,
 * ist schlimmer als kein Knopf — er sieht aus wie eine Funktion.
 *
 * Aufruf:  node scripts/verify-admin-entry-points.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const lies = (pfad) => readFileSync(join(ROOT, pfad), 'utf8');

const indexHtml = lies('admin-panel/index.html');
const adminMutate = lies('admin-panel/netlify/functions/admin-mutate.js');

const MIG_GUTSCHRIFT = 'supabase/migrations/2026-08-10_standalone_credit_notes.sql';
const MIG_PRUEFUNG = 'supabase/migrations/2026-08-10_calls_admin_review.sql';

const pruefungen = [];
const pruefe = (name, bedingung, hinweis) => pruefungen.push({ name, erfuellt: Boolean(bedingung), hinweis });

/* ── 1 · Einladung erneut senden ─────────────────────────────────────────── */

pruefe(
  'resendInvite ist aus dem Kunden-Workspace erreichbar',
  /onclick="resendInvite\(/.test(indexHtml),
  'Der Einstieg gehört in cw-actions in renderCustomerWorkspace().'
);
pruefe(
  'resendInvite erscheint nur bei gesendetem, noch nicht aktiviertem Zugang',
  /actionState\.showInvitationSent[\s\S]{0,400}?resendInvite\(/.test(indexHtml),
  'Ohne die Bedingung böte das Portal ein erneutes Senden an, wo es sinnlos oder irreführend ist.'
);
pruefe(
  'resendInvite ruft den bestehenden, geschützten Endpunkt',
  /resendInvite[\s\S]{0,700}?callAdminFunction\('send-customer-access'/.test(indexHtml),
  'send-customer-access ist über require-admin abgesichert.'
);

/* ── 2 · Kulanzgutschrift ────────────────────────────────────────────────── */

pruefe(
  'Die Migration für die freistehende Gutschrift liegt im Repo',
  existsSync(join(ROOT, MIG_GUTSCHRIFT)),
  'Migrationen gehören als Datei ins Repo, bevor sie auf einer Datenbank landen.'
);

if (existsSync(join(ROOT, MIG_GUTSCHRIFT))) {
  const migration = lies(MIG_GUTSCHRIFT);
  pruefe(
    'Die Gutschrift-Funktion benutzt den bestehenden Nummernkreis',
    /next_credit_note_number_v1\(\)/.test(migration),
    'Ein zweiter Nummernkreis wäre ein zweites Gutschriftsystem.'
  );
  pruefe(
    'Die Funktion ist idempotent über request_id',
    /invoice_financial_actions[\s\S]{0,300}?where request_id = v_request_id/.test(migration),
    'Ohne Idempotenz erzeugt ein Doppelklick zwei Gutschriften.'
  );
  pruefe(
    'Das Prüfprotokoll kennt die neue Aktion',
    /create_standalone_credit/.test(migration) && /invoice_financial_actions_action_check/.test(migration),
    'Sonst scheitert der Protokolleintrag an der Check-Bedingung.'
  );
  pruefe(
    'Nur service_role darf die Funktion ausführen',
    /grant execute on function public\.admin_create_standalone_credit_note_v1[^;]*to service_role/.test(migration)
      && /revoke all on function public\.admin_create_standalone_credit_note_v1[^;]*from anon, authenticated/.test(migration),
    'Der Browser darf Gutschriften nie direkt anlegen können.'
  );
}

pruefe(
  'admin-mutate kennt credit-notes.create mit Capability billing:write',
  /action === 'credit-notes\.create'[\s\S]{0,200}?requireCapabilityOrFail\(caller, 'billing:write'\)/.test(adminMutate),
  'Ohne Capability-Prüfung dürfte jede Admin-Rolle Gutschriften buchen.'
);
pruefe(
  'admin-mutate ruft die RPC und nicht einen eigenen Insert',
  /admin_create_standalone_credit_note_v1/.test(adminMutate),
  'Die Buchungslogik gehört in eine Transaktion in der Datenbank, nicht in die Function.'
);
pruefe(
  'Das Formular ruft credit-notes.create',
  /action: 'credit-notes\.create'/.test(indexHtml),
  'Vorher rief es invoices.create — eine Aktion, die es nie gab.'
);
pruefe(
  'Die tote Aktion invoices.create ist verschwunden',
  !/'invoices\.create'/.test(indexHtml),
  'Ein Aufruf auf eine unbekannte Aktion kommt mit 400 zurück.'
);
pruefe(
  'Das Formular schickt eine request_id mit',
  /_creditNoteRequestId/.test(indexHtml) && /request_id: _creditNoteRequestId/.test(indexHtml),
  'Die Idempotenz der Datenbankfunktion greift nur, wenn der Client denselben Wert wiederverwendet.'
);
pruefe(
  'Der Gutschrift-Dialog ist aus dem Kunden-Workspace erreichbar',
  /onclick="openCreditNoteModal\(/.test(indexHtml),
  'Der Dialog war vollständig gebaut und hatte keinen Einstieg.'
);

/* ── 3 · Anruf als geprüft markieren ─────────────────────────────────────── */

pruefe(
  'Die Migration für den Prüf-Zustand liegt im Repo',
  existsSync(join(ROOT, MIG_PRUEFUNG)),
  'Ohne die Spalte schreibt die Aktion ins Leere.'
);

if (existsSync(join(ROOT, MIG_PRUEFUNG))) {
  const migration = lies(MIG_PRUEFUNG);
  pruefe(
    'Der Prüf-Zustand bekommt eine eigene Spalte',
    /add column if not exists reviewed_at/.test(migration) && /add column if not exists reviewed_by/.test(migration),
    'read_at gehört dem Kunden-Dashboard und darf nicht doppelt belegt werden.'
  );
  pruefe(
    'read_at wird nicht umgedeutet',
    !/read_at\s*=/.test(migration),
    'Zwei Bedeutungen in einer Spalte lassen sich später nicht mehr trennen.'
  );
}

pruefe(
  'admin-mutate kennt calls.setReviewed mit Capability customer:write',
  /action === 'calls\.setReviewed'[\s\S]{0,200}?requireCapabilityOrFail\(caller, 'customer:write'\)/.test(adminMutate),
  'Ohne Capability-Prüfung könnte jeder Aufrufer den Zustand setzen.'
);
pruefe(
  'markCallReviewed schreibt über den Server',
  /async function markCallReviewed[\s\S]{0,900}?action: 'calls\.setReviewed'/.test(indexHtml),
  'Vorher schrieb die Funktion nur in den lokalen Zustand — beim nächsten Laden war die Markierung weg.'
);
pruefe(
  'markCallReviewed veraendert die Zusammenfassung nicht mehr im Browser',
  !/async function markCallReviewed[\s\S]{0,1400}?call\.summary\s*=/.test(indexHtml),
  'Das war die alte Attrappe: sie haengte "(reviewed)" an einen Text, der nie gespeichert wurde — '
    + 'bei jedem Klick erneut.'
);
pruefe(
  'Ein fehlgeschlagener Aufruf stellt den vorherigen Zustand wieder her',
  /const vorher = call\.reviewedAt[\s\S]{0,1200}?call\.reviewedAt = vorher/.test(indexHtml),
  'Sonst zeigt das Portal "geprüft" an, obwohl nichts gespeichert wurde.'
);
pruefe(
  'Die Aktion ist aus der Aktivitätsliste erreichbar',
  /onclick="markCallReviewed\(/.test(indexHtml),
  'Der Aktivitäts-Screen hatte vorher null Bedienelemente.'
);
pruefe(
  'reviewed_at wird in das UI-Objekt uebernommen',
  /reviewedAt: dbRow\.reviewed_at/.test(indexHtml),
  'Ohne die Abbildung sieht das Portal den gespeicherten Zustand nach dem Laden nicht.'
);

/* ── Ausgabe ─────────────────────────────────────────────────────────────── */

let fehler = 0;
console.log('Nachgerüstete Einstiegspunkte im Admin-Portal\n');
for (const p of pruefungen) {
  if (!p.erfuellt) fehler += 1;
  console.log('  ' + (p.erfuellt ? '✓' : '✗') + ' ' + p.name);
  if (!p.erfuellt) console.log('      ' + p.hinweis);
}

if (fehler > 0) {
  console.error(`\n${fehler} von ${pruefungen.length} Pruefungen fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nAlle ${pruefungen.length} Pruefungen bestanden.`);
