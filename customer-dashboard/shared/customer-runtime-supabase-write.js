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
  async function vxSbWrite(queryPromise) {
    const { data, error } = await queryPromise;
    if (error) throw new Error(error.message);
    return data;
  }

  root.vxSbWrite = vxSbWrite;
})(typeof globalThis !== 'undefined' ? globalThis : this);
