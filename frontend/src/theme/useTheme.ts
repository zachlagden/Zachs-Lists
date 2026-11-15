import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import {
  oppositeTheme,
  readStoredTheme,
  resolveTheme,
  writeStoredTheme,
  type Theme,
} from './theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

interface ThemeChoiceState {
  chosen: Theme | null;
  choose: (theme: Theme) => void;
}

const useThemeChoice = create<ThemeChoiceState>((set) => ({
  chosen: readStoredTheme(browserStorage()),
  choose: (theme) => {
    writeStoredTheme(browserStorage(), theme);
    document.documentElement.dataset.theme = theme;
    set({ chosen: theme });
  },
}));

function subscribeToSystemTheme(notify: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}

function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

export interface ThemeControls {
  theme: Theme;
  followsSystem: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export function useTheme(): ThemeControls {
  const chosen = useThemeChoice((state) => state.chosen);
  const choose = useThemeChoice((state) => state.choose);
  const prefersDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark);
  const theme = resolveTheme(chosen, prefersDark);
  return {
    theme,
    followsSystem: chosen === null,
    setTheme: choose,
    toggleTheme: () => choose(oppositeTheme(theme)),
  };
}
