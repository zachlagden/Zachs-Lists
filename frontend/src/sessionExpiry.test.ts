import { describe, expect, it } from 'vitest';
import { createSessionExpiry, isDeadSessionStatus, sessionAfterRefresh } from './sessionExpiry';

function expiry(signedIn: boolean): { expire: () => void; steps: string[] } {
  const steps: string[] = [];
  let isSignedIn = signedIn;
  const expire = createSessionExpiry({
    isSignedIn: () => isSignedIn,
    currentPath: () => '/config?tab=whitelist',
    rememberReturnPath: (path) => steps.push(`remember ${path}`),
    markSessionEnded: () => steps.push('mark ended'),
    endSession: () => {
      isSignedIn = false;
      steps.push('end');
    },
    showLogin: (from) => steps.push(`login from ${from}`),
  });
  return { expire, steps };
}

describe('a session that ended on the server', () => {
  it('remembers the page, marks the session ended, clears it and shows the login page', () => {
    const { expire, steps } = expiry(true);
    expire();
    expect(steps).toEqual([
      'remember /config?tab=whitelist',
      'mark ended',
      'end',
      'login from /config?tab=whitelist',
    ]);
  });

  it('does nothing when nobody is signed in, and nothing on a second report', () => {
    const signedOut = expiry(false);
    signedOut.expire();
    expect(signedOut.steps).toEqual([]);

    const signedIn = expiry(true);
    signedIn.expire();
    signedIn.expire();
    expect(signedIn.steps).toHaveLength(4);
  });

  it('treats a refresh that returns no user as an expired session', () => {
    expect(sessionAfterRefresh(true, false)).toBe('expired');
    expect(sessionAfterRefresh(true, true)).toBe('updated');
    expect(sessionAfterRefresh(false, false)).toBe('unchanged');
    expect(sessionAfterRefresh(false, true)).toBe('unchanged');
  });

  it('treats a refused session check on the socket path as an expired session', () => {
    expect(isDeadSessionStatus(401)).toBe(true);
    expect(isDeadSessionStatus(403)).toBe(true);
    expect(isDeadSessionStatus(500)).toBe(false);
    expect(isDeadSessionStatus(null)).toBe(false);
  });
});
