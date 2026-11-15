import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/errors';
import { errorDetails, formFailure } from './fieldErrors';
import { canChangeAdminRole, canManageAccount } from './permissions';
import { ADMIN_SECTIONS, activeSection, legacyTabPath } from './sections';
import { createSpacedRunner } from './spacedRunner';
import { choiceFromSearch, pageFromSearch, pageRange, withSearchChanges } from './urlState';

function refusal(body: Record<string, unknown>, status = 400): ApiError {
  return new ApiError({
    kind: 'http',
    status,
    message: String(body.error ?? 'Refused'),
    code: typeof body.code === 'string' ? body.code : undefined,
    field: typeof body.field === 'string' ? body.field : undefined,
    body,
  });
}

describe('admin sections', () => {
  it('sends each old tab link to its route', () => {
    expect(legacyTabPath('?tab=users')).toBe('/admin/users');
    expect(legacyTabPath('?tab=default')).toBe('/admin/default-lists');
    expect(legacyTabPath('?tab=jobs')).toBe('/admin/builds');
    expect(legacyTabPath('?tab=overview')).toBe('/admin');
    expect(legacyTabPath('?tab=nonsense')).toBe('/admin');
    expect(legacyTabPath('')).toBeNull();
    expect(legacyTabPath('?page=2')).toBeNull();
  });

  it('gives every section a distinct path and old tab name', () => {
    expect(new Set(ADMIN_SECTIONS.map((section) => section.path)).size).toBe(8);
    expect(new Set(ADMIN_SECTIONS.map((section) => section.legacyTab)).size).toBe(8);
  });

  it('marks the section a nested page belongs to', () => {
    expect(activeSection('/admin').label).toBe('Overview');
    expect(activeSection('/admin/').label).toBe('Overview');
    expect(activeSection('/admin/users/abc').label).toBe('Users');
    expect(activeSection('/admin/jobs/abc').label).toBe('Builds');
    expect(activeSection('/admin/builds').label).toBe('Builds');
    expect(activeSection('/admin/default-lists').label).toBe('Default lists');
  });
});

describe('url state', () => {
  it('reads a page number and falls back to the first page', () => {
    expect(pageFromSearch(new URLSearchParams('page=3'))).toBe(3);
    expect(pageFromSearch(new URLSearchParams('page=0'))).toBe(1);
    expect(pageFromSearch(new URLSearchParams('page=abc'))).toBe(1);
    expect(pageFromSearch(new URLSearchParams('reviews_page=2'), 'reviews_page')).toBe(2);
  });

  it('accepts only a known choice', () => {
    const choices = ['all', 'admins'] as const;
    expect(choiceFromSearch(new URLSearchParams('role=admins'), 'role', choices, 'all')).toBe(
      'admins',
    );
    expect(choiceFromSearch(new URLSearchParams('role=root'), 'role', choices, 'all')).toBe('all');
  });

  it('sets, replaces and removes query values', () => {
    const current = new URLSearchParams('q=al&page=2&role=admins');
    expect(withSearchChanges(current, { q: 'alex', page: null, banned: true, role: '' })).toBe(
      'q=alex&banned=1',
    );
    expect(withSearchChanges(current, { banned: false })).toBe('q=al&page=2&role=admins');
  });

  it('describes the rows on a page', () => {
    expect(pageRange(2, 25, 33)).toEqual({ first: 26, last: 33 });
    expect(pageRange(1, 25, 0)).toEqual({ first: 0, last: 0 });
  });
});

describe('server field errors', () => {
  const options = { fields: ['max_domains', 'reason'] as const, fallback: 'Not saved.' };

  it('puts a named field error on that field', () => {
    const failure = formFailure(
      refusal({
        error: 'limits.max_domains must be between 1 and 20000000',
        field: 'limits.max_domains',
      }),
      { ...options, prefix: 'limits.' },
    );
    expect(failure.form).toBeNull();
    expect(failure.fields.max_domains).toBe('limits.max_domains must be between 1 and 20000000.');
  });

  it('shows an unknown or missing field as a form error', () => {
    expect(formFailure(refusal({ error: 'Nope', field: 'other' }), options)).toEqual({
      fields: {},
      form: 'Nope.',
    });
    expect(formFailure(refusal({ error: 'Already handled' }, 409), options).form).toBe(
      'Already handled.',
    );
  });

  it('maps an alias to a form field', () => {
    const failure = formFailure(refusal({ error: 'Bad', field: 'list_name' }), {
      fields: ['listName'] as const,
      aliases: { list_name: 'listName' },
      fallback: 'Not saved.',
    });
    expect(failure.fields.listName).toBe('Bad.');
  });

  it('reads the line errors the server lists', () => {
    expect(errorDetails(refusal({ error: 'Bad', details: ['Line 2: no', 7] }))).toEqual([
      'Line 2: no',
    ]);
    expect(errorDetails(new Error('offline'))).toEqual([]);
  });
});

describe('permissions', () => {
  const root = { id: 'r', is_root: true };
  const admin = { id: 'a', is_root: false };
  const member = { id: 'm', is_root: false, is_admin: false };
  const otherAdmin = { id: 'b', is_root: false, is_admin: true };
  const rootAccount = { id: 'r', is_root: true, is_admin: true };

  it('lets any admin manage a member', () => {
    expect(canManageAccount(admin, member).allowed).toBe(true);
    expect(canManageAccount(root, member).allowed).toBe(true);
  });

  it('keeps admin accounts for the root account', () => {
    expect(canManageAccount(admin, otherAdmin).allowed).toBe(false);
    expect(canManageAccount(admin, { ...otherAdmin, id: 'a' }).reason).toMatch(/your own/);
    expect(canManageAccount(root, otherAdmin).allowed).toBe(true);
  });

  it('never allows changing the root account', () => {
    expect(canManageAccount(root, rootAccount).allowed).toBe(false);
    expect(canChangeAdminRole(root, rootAccount).allowed).toBe(false);
  });

  it('lets only the root account change admin access', () => {
    expect(canChangeAdminRole(admin, member)).toEqual({
      allowed: false,
      reason: 'Only the root account can grant or remove admin access.',
    });
    expect(canChangeAdminRole(root, member).allowed).toBe(true);
  });
});

describe('spaced runner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('runs at once, then at most once in each interval', () => {
    const run = vi.fn();
    const runner = createSpacedRunner(run, 30_000);
    runner.request();
    expect(run).toHaveBeenCalledTimes(1);
    runner.request();
    runner.request();
    vi.advanceTimersByTime(29_000);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    runner.request();
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('drops a waiting run when cancelled', () => {
    const run = vi.fn();
    const runner = createSpacedRunner(run, 30_000);
    runner.request();
    runner.request();
    runner.cancel();
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
