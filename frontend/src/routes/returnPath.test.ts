import { describe, expect, it } from 'vitest';
import {
  RETURN_PATH_KEY,
  RETURN_PATH_LIFETIME_MS,
  rememberReturnPath,
  returnPathOnArrival,
  safeReturnPath,
  takeReturnPath,
  type ReturnPathStore,
} from './returnPath';

const SAVED_AT = Date.parse('2026-11-15T12:00:00Z');

function memoryStore(): ReturnPathStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe('the path to return to after signing in', () => {
  it('rejects anything that could leave this site', () => {
    expect(safeReturnPath('/config?tab=whitelist#top')).toBe('/config?tab=whitelist#top');
    expect(safeReturnPath('/\t/example.com')).toBeNull();
    expect(safeReturnPath('/\n/example.com')).toBeNull();
    expect(safeReturnPath('/\\example.com')).toBeNull();
    expect(safeReturnPath('javascript:alert(1)')).toBeNull();
    expect(safeReturnPath('/login?error=state_mismatch')).toBeNull();
  });

  it('survives a failed sign-in, because only a signed-in arrival takes it', () => {
    const store = memoryStore();
    rememberReturnPath('/config', store, SAVED_AT);
    const take = () => takeReturnPath(store, SAVED_AT + 60_000);

    expect(returnPathOnArrival(false, '/login', take)).toBeNull();
    expect(store.values.has(RETURN_PATH_KEY)).toBe(true);

    expect(returnPathOnArrival(true, '/dashboard', take)).toBe('/config');
    expect(store.values.has(RETURN_PATH_KEY)).toBe(false);
  });

  it('is cleared without redirecting when a signed-in page other than the landing page loads', () => {
    const store = memoryStore();
    rememberReturnPath('/config', store, SAVED_AT);
    const take = () => takeReturnPath(store, SAVED_AT);
    expect(returnPathOnArrival(true, '/lists', take)).toBeNull();
    expect(store.values.has(RETURN_PATH_KEY)).toBe(false);
  });

  it('expires after thirty minutes', () => {
    const store = memoryStore();
    rememberReturnPath('/config', store, SAVED_AT);
    expect(takeReturnPath(store, SAVED_AT + RETURN_PATH_LIFETIME_MS + 1)).toBeNull();
    rememberReturnPath('/config', store, SAVED_AT);
    expect(takeReturnPath(store, SAVED_AT + RETURN_PATH_LIFETIME_MS)).toBe('/config');
  });

  it('ignores a stored value it did not write or that names another site', () => {
    const store = memoryStore();
    store.values.set(RETURN_PATH_KEY, '/config');
    expect(takeReturnPath(store, SAVED_AT)).toBeNull();
    store.values.set(RETURN_PATH_KEY, JSON.stringify({ path: '//example.com', savedAt: SAVED_AT }));
    expect(takeReturnPath(store, SAVED_AT)).toBeNull();
    store.values.set(RETURN_PATH_KEY, JSON.stringify({ path: '/config', savedAt: 'soon' }));
    expect(takeReturnPath(store, SAVED_AT)).toBeNull();
  });

  it('keeps the earlier path when asked to remember nothing', () => {
    const store = memoryStore();
    rememberReturnPath('/config', store, SAVED_AT);
    rememberReturnPath(undefined, store, SAVED_AT);
    expect(takeReturnPath(store, SAVED_AT)).toBe('/config');
  });
});
