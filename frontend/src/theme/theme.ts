export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'zl-theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

export function resolveTheme(stored: Theme | null, systemPrefersDark: boolean): Theme {
  if (stored) return stored;
  return systemPrefersDark ? 'dark' : 'light';
}

export function oppositeTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

export function readStoredTheme(storage: Pick<Storage, 'getItem'> | null): Theme | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(storage: Pick<Storage, 'setItem'> | null, theme: Theme): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}
