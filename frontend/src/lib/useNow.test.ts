import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClock } from './useNow';

describe('a shared clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks at the interval it was made with', () => {
    const seconds = createClock(1000);
    const halfMinutes = createClock(30_000);
    const everySecond = vi.fn();
    const everyHalfMinute = vi.fn();
    const stopSeconds = seconds.subscribe(everySecond);
    const stopHalfMinutes = halfMinutes.subscribe(everyHalfMinute);
    everySecond.mockClear();
    everyHalfMinute.mockClear();

    vi.advanceTimersByTime(30_000);

    expect(everySecond).toHaveBeenCalledTimes(30);
    expect(everyHalfMinute).toHaveBeenCalledTimes(1);
    expect(seconds.read().toISOString()).toBe('2026-11-15T12:00:30.000Z');
    stopSeconds();
    stopHalfMinutes();
  });

  it('runs one timer for every subscriber and stops it when the last one leaves', () => {
    const clock = createClock(1000);
    const stopFirst = clock.subscribe(() => undefined);
    const stopSecond = clock.subscribe(() => undefined);
    expect(vi.getTimerCount()).toBe(1);
    stopFirst();
    expect(vi.getTimerCount()).toBe(1);
    stopSecond();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reads the current time as soon as a component subscribes again', () => {
    const clock = createClock(1000);
    clock.subscribe(() => undefined)();
    vi.advanceTimersByTime(90_000);
    const stop = clock.subscribe(() => undefined);
    expect(clock.read().toISOString()).toBe('2026-11-15T12:01:30.000Z');
    stop();
  });
});
