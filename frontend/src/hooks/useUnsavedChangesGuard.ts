import { useEffect } from 'react';
import { useBlocker, type Blocker } from 'react-router-dom';
import { useAuthStore } from '../store';
import { shouldBlockNavigation } from './unsavedChanges';

export function useUnsavedChangesGuard(dirty: boolean): Blocker {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return useBlocker(({ currentLocation, nextLocation }) =>
    shouldBlockNavigation({
      dirty,
      signedIn: useAuthStore.getState().isAuthenticated,
      fromPath: currentLocation.pathname,
      toPath: nextLocation.pathname,
    }),
  );
}
