import { describe, expect, it, vi } from 'vitest';
import { localInputToUtcIso, utcIsoToLocalInput } from './datetimeLocal';
import { loginErrorMessage } from './loginErrors';

vi.stubEnv('TZ', 'America/New_York');

describe('announcement expiry conversion', () => {
  it('runs in a zone that is not UTC', () => {
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(300);
  });

  it('reads the input as local time and sends UTC', () => {
    expect(localInputToUtcIso('2026-01-15T09:30')).toBe('2026-01-15T14:30:00.000Z');
    expect(localInputToUtcIso('2026-07-15T09:30')).toBe('2026-07-15T13:30:00.000Z');
    expect(localInputToUtcIso('2026-01-15T21:45:10')).toBe('2026-01-16T02:45:10.000Z');
  });

  it('shows a stored UTC time in local time', () => {
    expect(utcIsoToLocalInput('2026-01-15T14:30:00.000Z')).toBe('2026-01-15T09:30');
    expect(utcIsoToLocalInput('2026-07-15T13:30:00.000Z')).toBe('2026-07-15T09:30');
    expect(utcIsoToLocalInput('2026-01-01T03:05:00Z')).toBe('2025-12-31T22:05');
  });

  it('round-trips in both directions', () => {
    for (const local of ['2026-03-08T01:59', '2026-11-01T00:30', '2030-12-31T23:59']) {
      expect(utcIsoToLocalInput(localInputToUtcIso(local))).toBe(local);
    }
    const stored = '2026-06-01T00:00:00.000Z';
    expect(localInputToUtcIso(utcIsoToLocalInput(stored))).toBe(stored);
  });

  it('treats an empty or malformed value as no expiry', () => {
    expect(localInputToUtcIso('')).toBeNull();
    expect(localInputToUtcIso('tomorrow')).toBeNull();
    expect(utcIsoToLocalInput(null)).toBe('');
    expect(utcIsoToLocalInput(undefined)).toBe('');
    expect(utcIsoToLocalInput('not a date')).toBe('');
  });
});

describe('login error messages', () => {
  const backendCodes = [
    'oauth_declined',
    'state_mismatch',
    'no_code',
    'api_error',
    'token_exchange_failed',
    'no_access_token',
    'invalid_profile',
    'account_setup_retry',
    'account_disabled',
    'account_banned',
  ];

  it('explains every code the backend redirects with', () => {
    const fallback = loginErrorMessage('something_else');
    for (const code of backendCodes) {
      expect(loginErrorMessage(code)).not.toBe(fallback);
      expect(loginErrorMessage(code).length).toBeGreaterThan(10);
    }
  });

  it('includes the end of a timed ban in the given zone', () => {
    const until = '2026-01-15T14:30:00.000Z';
    const options = { timeZone: 'Europe/London', now: new Date('2026-01-10T09:00:00.000Z') };
    expect(loginErrorMessage('account_banned', until, options)).toBe(
      'Your account is banned until 15 Jan, 14:30. You cannot sign in until then.',
    );
    expect(
      loginErrorMessage('account_banned', until, { ...options, timeZone: 'Asia/Tokyo' }),
    ).toContain('15 Jan, 23:30');
    expect(loginErrorMessage('account_banned')).not.toContain('until');
    expect(loginErrorMessage('account_banned', 'garbage')).not.toContain('until');
  });
});
