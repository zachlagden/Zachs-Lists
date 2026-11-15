import { useSyncExternalStore } from 'react';

const TICK_MS = 30_000;

let current = new Date();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  current = new Date();
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  if (timer === null) {
    tick();
    timer = setInterval(tick, TICK_MS);
  }
  return () => {
    listeners.delete(notify);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): Date {
  return useSyncExternalStore(subscribe, () => current);
}
