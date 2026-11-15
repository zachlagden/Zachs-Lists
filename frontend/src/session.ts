import { authKeys, fetchCurrentUser, signOut } from './api/auth';
import { onUnauthorized } from './api/http';
import { queryClient } from './api/queryClient';
import { endSession } from './hooks/socketConnection';
import { rememberReturnPath } from './routes/returnPath';
import { useAuthStore } from './store';
import type { User } from './types';

export async function startSession(): Promise<User | null> {
  try {
    const user = await queryClient.fetchQuery({
      queryKey: authKeys.me(),
      queryFn: fetchCurrentUser,
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
      queryFn: fetchCurrentUser,
      retry: false,
      staleTime: 0,
    });
    if (useAuthStore.getState().isAuthenticated) useAuthStore.getState().setUser(user);
  } catch {
    return;
  }
}

function handleExpiredSession(): void {
  if (!useAuthStore.getState().isAuthenticated) return;
  rememberReturnPath(`${window.location.pathname}${window.location.search}`);
  useAuthStore.getState().markSessionEnded();
  endSession();
}

export function watchForExpiredSession(): void {
  onUnauthorized(handleExpiredSession);
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
