export interface SessionExpirySteps {
  isSignedIn: () => boolean;
  currentPath: () => string;
  rememberReturnPath: (path: string) => void;
  markSessionEnded: () => void;
  endSession: () => void;
  showLogin: (from: string) => void;
}

export function createSessionExpiry(steps: SessionExpirySteps): () => void {
  return () => {
    if (!steps.isSignedIn()) return;
    const path = steps.currentPath();
    steps.rememberReturnPath(path);
    steps.markSessionEnded();
    steps.endSession();
    steps.showLogin(path);
  };
}

export type RefreshedSession = 'unchanged' | 'updated' | 'expired';

export function sessionAfterRefresh(stillSignedIn: boolean, hasUser: boolean): RefreshedSession {
  if (!stillSignedIn) return 'unchanged';
  return hasUser ? 'updated' : 'expired';
}

const DEAD_SESSION_STATUSES: ReadonlyArray<number | null> = [401, 403];

export function isDeadSessionStatus(status: number | null): boolean {
  return DEAD_SESSION_STATUSES.includes(status);
}
