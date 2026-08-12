(function initVoxeraSupabaseWrite(root) {
  'use strict';
  if (!root || typeof root.vxSbWrite === 'function') return;

  // Supabase's JS client resolves insert()/update()/upsert()/delete() with
  // { data, error } instead of rejecting on a query-level failure (RLS
  // denial, constraint violation, ...). A bare `await` on such a call never
  // throws by itself -- code has to read `.error` explicitly, or a failed
  // write is silently treated as success. This wraps that one check so a
  // write can be treated like any other operation that fails by throwing:
  //   const data = await vxSbWrite(sb.from('customers').update({...}).eq('id', id));
  // See vxSaveProfil() (Fund vom 2026-08-11): the button showed "Gespeichert
  // ✓" and the change was applied locally even though nothing was written,
  // because the .update() result went unchecked.
  //
  // Zweite Pruefung, gefunden im Codex-Review auf #971: {error} allein
  // belegt keinen Schreibvorgang. Eine RLS-USING-Klausel kann die Zeile beim
  // update()/delete() herausfiltern (z.B. Berechtigung laeuft waehrend
  // offener Sitzung ab) -- PostgREST meldet 0 betroffene Zeilen als
  // error: null, das ist kein SQL-Fehlerfall. Nur eine zurueckgelesene Zeile
  // belegt den echten Erfolg, deshalb: haengt der Aufrufer .select() an die
  // Kette (data wird dadurch ein Array), gilt ein leeres Array als
  // Fehlschlag.
  //
  // WICHTIG, nicht generalisieren: das ist nur sicher, wenn die SELECT-Policy
  // der Zieltabelle dieselbe Bedingung prueft wie die UPDATE/DELETE-Policy --
  // sonst kaeme ein echter Erfolg faelschlich leer zurueck (false failure).
  // Fuer customers (#971), notifications und ai_change_requests (#973-Folge)
  // wurde das jeweils gegen die tatsaechlichen Policy-Definitionen in
  // supabase/migrations/ geprueft, nicht angenommen. Wer .select() an eine
  // neue Aufrufstelle haengt, muss das fuer die jeweilige Tabelle selbst
  // nachpruefen -- diese Funktion kann das nicht automatisch wissen.
  async function vxSbWrite(queryPromise, options) {
    const { data, error } = await queryPromise;
    if (error) throw new Error(error.message);
    const allowEmpty = Boolean(options && options.allowEmpty);
    if (!allowEmpty && Array.isArray(data) && data.length === 0) {
      throw new Error('Kein Datensatz betroffen (Berechtigung oder Datensatz nicht mehr vorhanden).');
    }
    return data;
  }

  root.vxSbWrite = vxSbWrite;
})(typeof globalThis !== 'undefined' ? globalThis : this);
