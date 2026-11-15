export const RETURN_PATH_KEY = 'zl-return-to';
export const RETURN_PATH_LIFETIME_MS = 30 * 60 * 1000;
export const SIGN_IN_LANDING_PATH = '/dashboard';

const SIGNED_OUT_PATHS = ['/login', '/'];
const PLACEHOLDER_ORIGIN = 'https://app.invalid';
const LAST_CONTROL_CODE = 0x1f;
const DELETE_CODE = 0x7f;

export type ReturnPathStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const code = character.charCodeAt(0);
    return code <= LAST_CONTROL_CODE || code === DELETE_CODE;
  });
}

function staysOnThisOrigin(candidate: string): boolean {
  try {
    return new URL(candidate, PLACEHOLDER_ORIGIN).origin === PLACEHOLDER_ORIGIN;
  } catch {
    return false;
  }
}

export function safeReturnPath(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return null;
  }
  if (hasControlCharacter(candidate) || !staysOnThisOrigin(candidate)) return null;
  const pathname = candidate.split(/[?#]/)[0];
  if (SIGNED_OUT_PATHS.includes(pathname)) return null;
  return candidate;
}

export function storedReturnPath(path: string, now: number): string {
  return JSON.stringify({ path, savedAt: now });
}

export function readReturnPath(stored: string | null, now: number): string | null {
  if (stored === null) return null;
  let entry: unknown;
  try {
    entry = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof entry !== 'object' || entry === null) return null;
  const { path, savedAt } = entry as { path?: unknown; savedAt?: unknown };
  if (typeof savedAt !== 'number') return null;
  const age = now - savedAt;
  if (age < 0 || age > RETURN_PATH_LIFETIME_MS) return null;
  return safeReturnPath(path);
}

function sessionStore(): ReturnPathStore | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberReturnPath(
  candidate: unknown,
  store: ReturnPathStore | null = sessionStore(),
  now: number = Date.now(),
): void {
  const path = safeReturnPath(candidate);
  if (!path || !store) return;
  try {
    store.setItem(RETURN_PATH_KEY, storedReturnPath(path, now));
  } catch {
    return;
  }
}

export function takeReturnPath(
  store: ReturnPathStore | null = sessionStore(),
  now: number = Date.now(),
): string | null {
  if (!store) return null;
  try {
    const path = readReturnPath(store.getItem(RETURN_PATH_KEY), now);
    store.removeItem(RETURN_PATH_KEY);
    return path;
  } catch {
    return null;
  }
}

export function returnPathOnArrival(
  signedIn: boolean,
  pathname: string,
  take: () => string | null = takeReturnPath,
): string | null {
  if (!signedIn) return null;
  const path = take();
  return pathname === SIGN_IN_LANDING_PATH ? path : null;
}
