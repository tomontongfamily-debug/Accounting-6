// A local recovery copy can still have the revision from before its successful
// save. The server's acknowledgement identifies that copy without replaying it.
export function pilotDraftAlreadySaved(draft, saved) {
  if (!saved?.pilot || !draft || ['branch', 'date', 'shiftId'].some(key => draft[key] !== saved[key])) return false;
  const local = draft.clientSave, online = saved.clientSave;
  return Boolean(local?.clientId && local.clientId === online?.clientId
    && Number(local.version) > 0 && Number(online.version) >= Number(local.version));
}
