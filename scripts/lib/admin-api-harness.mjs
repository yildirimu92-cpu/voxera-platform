/**
 * Lädt shared/core/admin-api.js in eine Sandbox und gibt seine Auflösung frei.
 *
 * Warum es das gibt
 * -----------------
 * Bis Welle 1 lag jede Umleitung vom Admin-Portal zum Server in einer eigenen
 * Patch-Datei, die `callAdminFunction` umwickelte. Die Prüfskripte haben
 * entsprechend im Quelltext dieser Dateien nach Zeichenketten gesucht -- etwa
 * `/contracts\.cancel/.test(runtime)`. Das prüfte, wo etwas steht, nicht was es
 * tut, und ging deshalb kaputt, sobald dieselbe Zusage an einen anderen Ort zog.
 *
 * `core/admin-api.js` gibt `resolve(name, payload)` frei: dieselbe Regelkette,
 * die der Browser durchläuft, nur ohne `fetch`. Ein Prüfskript kann damit die
 * Zusage selbst nachvollziehen -- "eine Vertragskündigung landet bei
 * contract-terminate" -- statt eine Schreibweise festzuhalten. Zieht die Regel
 * später in einen Screen um, muss dieses Modul nachgezogen werden; die
 * Zusicherung selbst bleibt gültig.
 */

import fs from 'node:fs';
import vm from 'node:vm';

export const ADMIN_API_PATH = 'admin-panel/shared/core/admin-api.js';

/**
 * @returns {{api: object, source: string, sandbox: object}}
 *   `api` ist das fertige VoxeraAdminApi, `sandbox` das Fenster-Ersatzobjekt
 *   (enthält z. B. `state`, falls eine Nachbearbeitung hineingeschrieben hat).
 */
export function ladeAdminApi() {
  const source = fs.readFileSync(ADMIN_API_PATH, 'utf8');
  const sandbox = { console, fetch: async () => { throw new Error('kein Netz im Prueflauf'); } };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  new vm.Script(source, { filename: ADMIN_API_PATH }).runInContext(sandbox);
  if (!sandbox.VoxeraAdminApi) throw new Error(`${ADMIN_API_PATH} stellt kein VoxeraAdminApi bereit.`);
  return { api: sandbox.VoxeraAdminApi, source, sandbox };
}

/** Kurzform: wohin geht ein Aufruf am Ende? */
export function zielVon(api, name, payload) {
  const aufgeloest = api.resolve(name, payload);
  return aufgeloest.reject ? { fehler: aufgeloest.reject } : aufgeloest;
}
