export const RETURN_PATH_KEY = 'zl-return-to';

const SIGNED_OUT_PATHS = ['/login', '/'];

export function safeReturnPath(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return null;
  }
  const pathname = candidate.split(/[?#]/)[0];
  if (SIGNED_OUT_PATHS.includes(pathname)) return null;
  return candidate;
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberReturnPath(candidate: unknown): void {
  const path = safeReturnPath(candidate);
  if (!path) return;
  try {
    sessionStore()?.setItem(RETURN_PATH_KEY, path);
  } catch {
    return;
  }
}

export function takeReturnPath(): string | null {
  const store = sessionStore();
  if (!store) return null;
  try {
    const path = safeReturnPath(store.getItem(RETURN_PATH_KEY));
    store.removeItem(RETURN_PATH_KEY);
    return path;
  } catch {
    return null;
  }
}
