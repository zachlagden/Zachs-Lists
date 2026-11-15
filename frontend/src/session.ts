import { authKeys, fetchSession, signOut } from './api/auth';
import { onUnauthorized } from './api/http';
import { queryClient } from './api/queryClient';
import { rememberReturnPath } from './routes/returnPath';
import { createSessionExpiry, sessionAfterRefresh } from './sessionExpiry';
import { useAuthStore } from './store';
import type { User } from './types';

type SessionCleanup = () => void;
type LoginNavigator = (from: string) => void;

const sessionCleanups = new Set<SessionCleanup>();

let showLogin: LoginNavigator | null = null;

export function onSessionExpired(navigate: LoginNavigator): void {
  showLogin = navigate;
}

export function onSessionEnd(cleanup: SessionCleanup): void {
  sessionCleanups.add(cleanup);
}

export function endSession(): void {
  for (const cleanup of sessionCleanups) cleanup();
  useAuthStore.getState().setUser(null);
  queryClient.clear();
}

export async function startSession(): Promise<User | null> {
  try {
    const user = await queryClient.fetchQuery({
      queryKey: authKeys.me(),
      queryFn: fetchSession,
      retry: false,
      staleTime: 0,
    });
    useAuthStore.getState().setUser(user);
    return user;
  } catch {
    useAuthStore.getState().setUser(null);
    return null;
  }
}

export async function refreshSession(): Promise<void> {
  if (!useAuthStore.getState().isAuthenticated) return;
  try {
    const user = await queryClient.fetchQuery({
      queryKey: authKeys.me(),
      queryFn: fetchSession,
      retry: false,
      staleTime: 0,
    });
    const outcome = sessionAfterRefresh(useAuthStore.getState().isAuthenticated, user !== null);
    if (outcome === 'expired') expireSession();
    else if (outcome === 'updated') useAuthStore.getState().setUser(user);
  } catch {
    return;
  }
}

export const expireSession = createSessionExpiry({
  isSignedIn: () => useAuthStore.getState().isAuthenticated,
  currentPath: () => `${window.location.pathname}${window.location.search}`,
  rememberReturnPath,
  markSessionEnded: () => useAuthStore.getState().markSessionEnded(),
  endSession,
  showLogin: (from) => showLogin?.(from),
});

export function watchForExpiredSession(): void {
  onUnauthorized(expireSession);
}

export async function signOutOfSession(): Promise<boolean> {
  let reachedServer = true;
  try {
    await signOut();
  } catch {
    reachedServer = false;
  }
  endSession();
  return reachedServer;
}
