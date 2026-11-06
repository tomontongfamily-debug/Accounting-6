// Reload after offline uploads only when they actually changed the online store.
export async function refreshStore(load, flush) {
  const store = await load();
  return flush && await flush() ? load() : store;
}

// Focus, visibility and realtime events can arrive during a slow paged load.
// Keep one load active and combine those events into one subsequent refresh.
export function createStoreRefreshQueue(run, {minIntervalMs=0}={}) {
  let active = null;
  let queued = false;
  let stopped = false;
  let finishedAt = -Infinity;
  let cancelWait = () => {};
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
          const remaining=silent?Math.max(0,minIntervalMs-(Date.now()-finishedAt)):0;
          if(remaining)await new Promise(resolve=>{
            const timer=setTimeout(resolve,remaining);
            cancelWait=()=>{clearTimeout(timer);resolve();};
          });
          cancelWait=()=>{};
          if(stopped)break;
          // Events arriving during the cooldown are covered by this new load.
          queued=false;
          try {await run(silent);} finally {finishedAt=Date.now();}
          silent = true;
        } while (queued && !stopped);
      }).finally(() => { active = null; });
      return active;
    },
    stop() {
      stopped = true;
      queued = false;
      cancelWait();
    },
  };
}
