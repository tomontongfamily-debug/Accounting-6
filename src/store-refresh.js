// Reload after offline uploads only when they actually changed the online store.
export async function refreshStore(load, flush) {
  const store = await load();
  return flush && await flush() ? load() : store;
}

// Focus, visibility and realtime events can arrive during a slow paged load.
// Keep one load active and combine those events into one subsequent refresh.
export function createStoreRefreshQueue(run) {
  let active = null;
  let queued = false;
  let stopped = false;
  return {
    refresh(silent = false) {
      if (stopped) return Promise.resolve();
      if (active) {
        queued = true;
        return active;
      }
      active = Promise.resolve().then(async () => {
        do {
          queued = false;
          if (stopped) break;
          await run(silent);
          silent = true;
        } while (queued && !stopped);
      }).finally(() => { active = null; });
      return active;
    },
    stop() {
      stopped = true;
      queued = false;
    },
  };
}
