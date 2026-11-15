import { useSyncExternalStore } from 'react';

export interface Clock {
  subscribe: (notify: () => void) => () => void;
  read: () => Date;
}

export function createClock(tickMs: number): Clock {
  let current = new Date();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = (): void => {
    current = new Date();
    listeners.forEach((notify) => notify());
  };

  const subscribe = (notify: () => void): (() => void) => {
    listeners.add(notify);
    if (timer === null) {
      tick();
      timer = setInterval(tick, tickMs);
    }
    return () => {
      listeners.delete(notify);
      if (listeners.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  };

  return { subscribe, read: () => current };
}

const HALF_MINUTE_MS = 30_000;
const SECOND_MS = 1000;

const halfMinuteClock = createClock(HALF_MINUTE_MS);
const secondsClock = createClock(SECOND_MS);

export function useNow(): Date {
  return useSyncExternalStore(halfMinuteClock.subscribe, halfMinuteClock.read);
}

export function useNowEverySecond(): Date {
  return useSyncExternalStore(secondsClock.subscribe, secondsClock.read);
}
