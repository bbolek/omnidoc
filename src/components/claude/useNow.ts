import { useEffect, useSyncExternalStore } from "react";

/**
 * Shared 1 Hz heartbeat. All Claude-panel relative-time consumers subscribe
 * to one store so the panel does a single re-render per second instead of
 * scheduling its own interval per component. useSyncExternalStore makes the
 * subscription cheap and tear-proof under concurrent rendering.
 */
let now = Date.now();
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function ensureInterval() {
  if (intervalId != null) return;
  intervalId = setInterval(() => {
    now = Date.now();
    for (const l of listeners) l();
  }, 1000);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  ensureInterval();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && intervalId != null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot(): number {
  return now;
}

export function useNow(): number {
  // Prime `now` once on mount so the first paint after a long idle doesn't
  // display stale timestamps. The subscription will then keep it fresh.
  useEffect(() => {
    now = Date.now();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
