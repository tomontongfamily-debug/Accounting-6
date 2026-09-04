import { createClient } from "@supabase/supabase-js";

export function subscribeToStoreChanges({ url, publishableKey, onChange, onStatus }) {
  if (!url || !publishableKey) return () => {};

  const client = createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      params: { eventsPerSecond: 2 },
    },
  });

  const channel = client
    .channel("fueltech-store-changes")
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "fueltech_realtime_signals",
    }, (payload) => {
      onChange?.(payload.new?.topic || payload.old?.topic || "store");
    })
    .subscribe((status) => onStatus?.(status));

  return () => {
    client.removeChannel(channel).catch(() => {});
  };
}
