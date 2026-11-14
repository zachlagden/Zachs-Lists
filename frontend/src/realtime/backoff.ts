export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 30000;
export const OFFLINE_AFTER_FAILURES = 5;

export function reconnectDelay(failures: number, random: () => number = Math.random): number {
  const doublings = Math.min(Math.max(failures - 1, 0), 30);
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** doublings);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export function stateAfterFailures(failures: number, browserOnline: boolean): ConnectionState {
  if (!browserOnline || failures >= OFFLINE_AFTER_FAILURES) return 'offline';
  return 'reconnecting';
}
