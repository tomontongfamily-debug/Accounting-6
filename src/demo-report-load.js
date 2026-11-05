// Reading saved reports must not depend on every offline draft being accepted.
export async function loadReportsWithDraftSync({ load, flush }) {
  const firstStore = await load();
  if (!flush) return { onlineStore: firstStore, draftSyncError: null };
  let draftSyncError = null;
  let changed;
  try { changed = await flush(firstStore); }
  catch (error) {
    if (error.status === 401 || error.status === 403) throw error;
    draftSyncError = error;
  }
  // Reload after successful or uncertain uploads. An explicitly unchanged
  // queue needs no second history download on every background refresh.
  const onlineStore = !draftSyncError && changed === false ? firstStore : await load();
  return { onlineStore, draftSyncError };
}
