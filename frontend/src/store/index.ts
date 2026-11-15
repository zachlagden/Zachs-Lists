import { create } from 'zustand';
import type { User } from '../types';
import type { ConnectionState } from '../realtime/backoff';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  sessionEnded: boolean;

  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  markSessionEnded: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  sessionEnded: false,

  setUser: (user) =>
    set((state) => ({
      user,
      isAuthenticated: !!user,
      isLoading: false,
      sessionEnded: user ? false : state.sessionEnded,
    })),

  markSessionEnded: () => set({ sessionEnded: true }),

  setLoading: (loading) => set({ isLoading: loading }),

  logout: () =>
    set({
      user: null,
      isAuthenticated: false,
    }),
}));

interface ConnectionStoreState {
  state: ConnectionState;
  setState: (state: ConnectionState) => void;
}

export const useConnectionStore = create<ConnectionStoreState>((set) => ({
  state: 'connecting',
  setState: (state) => set({ state }),
}));
