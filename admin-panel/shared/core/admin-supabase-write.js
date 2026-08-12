(function initVoxeraAdminSupabaseWrite(root) {
  'use strict';
  if (!root || typeof root.adminSbWrite === 'function') return;

  // Same gap as core/admin-api.js closes for callAdminFunction, but for the
  // direct Supabase client writes admin-panel/index.html still makes on its
  // own (authClient.from(...).update()/.insert() outside admin-mutate).
  // Supabase resolves those with { data, error } instead of rejecting on a
  // query-level failure, so a bare `await` never throws by itself -- code
  // has to read `.error` explicitly, or a failed write is silently treated
  // as success (e.g. a toast saying "gespeichert" when nothing was written).
  //   const data = await adminSbWrite(authClient.from('ai_change_requests').update({...}).eq('id', id));
  //
  // Zweite Pruefung, gefunden im Codex-Review auf #971 (dort fuer customers,
  // hier gleiche Ursache): {error} allein belegt keinen Schreibvorgang. Eine
  // RLS-USING-Klausel kann die Zeile beim update()/delete() herausfiltern --
  // PostgREST meldet 0 betroffene Zeilen als error: null, kein SQL-Fehlerfall.
  // Nur eine zurueckgelesene Zeile belegt den echten Erfolg: haengt der
  // Aufrufer .select() an die Kette (data wird dadurch ein Array), gilt ein
  // leeres Array als Fehlschlag.
  //
  // WICHTIG, nicht generalisieren: das ist nur sicher, wenn die SELECT-Policy
  // der Zieltabelle dieselbe Bedingung prueft wie die UPDATE/DELETE-Policy --
  // sonst kaeme ein echter Erfolg faelschlich leer zurueck (false failure).
  // Fuer ai_change_requests wurde das gegen die tatsaechliche Policy-Definition
  // in supabase/migrations/20260808031625_ai_change_requests_tenant_isolation_
  // reassert.sql geprueft (eine einzige FOR-ALL-Policy deckt SELECT und
  // UPDATE mit derselben is_admin(auth.uid())-Bedingung ab), nicht angenommen.
  // Wer .select() an eine neue Aufrufstelle haengt, muss das fuer die
  // jeweilige Tabelle selbst nachpruefen -- diese Funktion kann das nicht
  // automatisch wissen.
  async function adminSbWrite(queryPromise, options) {
    const { data, error } = await queryPromise;
    if (error) throw new Error(error.message);
    const allowEmpty = Boolean(options && options.allowEmpty);
    if (!allowEmpty && Array.isArray(data) && data.length === 0) {
      throw new Error('Kein Datensatz betroffen (Berechtigung oder Datensatz nicht mehr vorhanden).');
    }
    return data;
  }

  root.adminSbWrite = adminSbWrite;
})(typeof globalThis !== 'undefined' ? globalThis : this);
