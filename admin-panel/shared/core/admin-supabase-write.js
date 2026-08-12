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
  async function adminSbWrite(queryPromise) {
    const { data, error } = await queryPromise;
    if (error) throw new Error(error.message);
    return data;
  }

  root.adminSbWrite = adminSbWrite;
})(typeof globalThis !== 'undefined' ? globalThis : this);
