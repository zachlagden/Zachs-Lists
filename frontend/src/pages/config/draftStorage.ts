export interface StoredDraft {
  sources: string;
  whitelist: string;
}

const KEY_PREFIX = 'zl-config-draft:';

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function readStoredDraft(userId: string): StoredDraft | null {
  try {
    const stored = sessionStore()?.getItem(keyFor(userId));
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (parsed === null || typeof parsed !== 'object') return null;
    const { sources, whitelist } = parsed as Record<string, unknown>;
    return typeof sources === 'string' && typeof whitelist === 'string'
      ? { sources, whitelist }
      : null;
  } catch {
    return null;
  }
}

export function writeStoredDraft(userId: string, draft: StoredDraft): boolean {
  try {
    const store = sessionStore();
    if (!store) return false;
    store.setItem(keyFor(userId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredDraft(userId: string): void {
  try {
    sessionStore()?.removeItem(keyFor(userId));
  } catch {
    return;
  }
}
