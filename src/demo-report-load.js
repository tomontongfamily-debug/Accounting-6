// Reading saved reports must not depend on every offline draft being accepted.
export async function loadReportsWithDraftSync({ load, flush }) {
  const firstStore = await load();
  if (!flush) return { onlineStore: firstStore, draftSyncError: null };
  let draftSyncError = null;
  try { await flush(); }
  catch (error) {
    if (error.status === 401 || error.status === 403) throw error;
    draftSyncError = error;
  }
  // Earlier queued saves may have succeeded before another draft was rejected.
  const onlineStore = await load();
  return { onlineStore, draftSyncError };
}
