import { QueryClient } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  describeApiError,
  retryAfterSeconds,
  shouldRetryRequest,
  toApiError,
} from './api/errors';
import { JOBS_PAGE_SIZE, jobsKeys, type JobsResponse } from './api/jobs';
import {
  breadcrumbsFor,
  buildsBadge,
  isNavActive,
  MORE_NAV,
  visibleNav,
} from './components/shell/navigation';
import { jobStatusDescription, sourceOutcome } from './components/ui/status';
import { nextTabIndex } from './components/ui/tabKeys';
import { applyJobToCache, applyJobsToCache, cachedJobs } from './realtime/jobsCacheBridge';
import { createRoomSubscribers } from './realtime/roomSubscribers';
import { safeReturnPath } from './routes/returnPath';
import {
  oppositeTheme,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  writeStoredTheme,
} from './theme/theme';
import type { Job } from './types';

function httpError(
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
): AxiosError {
  const response = {
    status,
    data,
    headers: new AxiosHeaders(headers),
    statusText: '',
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse;
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', response.config, null, response);
}

describe('API errors', () => {
  it('carries the server error, code and field', () => {
    const error = toApiError(
      httpError(400, { error: 'Invalid tier requested', code: 'invalid_field', field: 'tier' }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'invalid_field',
      field: 'tier',
      message: 'Invalid tier requested',
      isClientError: true,
    });
  });

  it('appends validation details', () => {
    const error = toApiError(httpError(400, { error: 'Invalid whitelist', details: ['line 2'] }));
    expect(error.message).toBe('Invalid whitelist: line 2');
  });

  it('reads Retry-After from the header, then the body', () => {
    const limited = toApiError(
      httpError(
        429,
        { error: 'Too many requests. Try again shortly.', code: 'rate_limited' },
        {
          'retry-after': '42',
        },
      ),
    );
    expect(limited.isRateLimited).toBe(true);
    expect(limited.retryAfterSeconds).toBe(42);
    expect(describeApiError(limited, 'fallback')).toBe(
      'Too many requests. Try again shortly. Try again in 42 s.',
    );
    expect(retryAfterSeconds(undefined, { retry_after: 7 })).toBe(7);
    expect(retryAfterSeconds(undefined, { cooldown_remaining: 90 })).toBe(90);
    expect(
      retryAfterSeconds('Sat, 14 Nov 2026 20:42:00 GMT', {}, new Date('2026-11-14T20:41:00Z')),
    ).toBe(60);
    expect(retryAfterSeconds(undefined, {})).toBeNull();
  });

  it('tells a timeout from an unreachable server', () => {
    const timeout = toApiError(new AxiosError('timeout', 'ECONNABORTED'));
    const offline = toApiError(new AxiosError('Network Error', 'ERR_NETWORK'));
    expect(timeout.kind).toBe('timeout');
    expect(offline.kind).toBe('network');
    expect(describeApiError(offline, 'fallback')).toBe(
      'Could not reach the server. Check your connection.',
    );
  });

  it('uses the fallback for a server error with no message', () => {
    expect(describeApiError(httpError(500, '<html>'), 'The list could not be loaded.')).toBe(
      'The list could not be loaded.',
    );
  });

  it('retries once, and never a client error', () => {
    expect(shouldRetryRequest(0, httpError(503, {}))).toBe(true);
    expect(shouldRetryRequest(1, httpError(503, {}))).toBe(false);
    expect(shouldRetryRequest(0, httpError(404, {}))).toBe(false);
    expect(shouldRetryRequest(0, httpError(429, {}))).toBe(false);
  });
});

function job(jobId: string, rev: number, status: Job['status'], createdAt: string): Job {
  return {
    id: jobId,
    job_id: jobId,
    user_id: 'user-1',
    username: 'alex',
    type: 'manual',
    status,
    progress: {} as Job['progress'],
    created_at: createdAt,
    rev,
  };
}

describe('jobs cache bridge', () => {
  function clientWith(jobs: Job[]): QueryClient {
    const client = new QueryClient();
    client.setQueryData<JobsResponse>(jobsKeys.list(), { jobs, has_unread_failures: false });
    return client;
  }

  it('merges a live event by rev and ignores a stale one', () => {
    const client = clientWith([job('a', 3, 'processing', '2026-11-14T20:00:00Z')]);
    applyJobToCache(client, job('a', 2, 'queued', '2026-11-14T20:00:00Z'));
    expect(cachedJobs(client)[0]).toMatchObject({ rev: 3, status: 'processing' });
    applyJobToCache(client, job('a', 4, 'completed', '2026-11-14T20:00:00Z'));
    expect(cachedJobs(client)[0]).toMatchObject({ rev: 4, status: 'completed' });
    expect(client.getQueryData<Job>(jobsKeys.detail('a'))).toMatchObject({ rev: 4 });
  });

  it('adds a new job at the top and keeps one page', () => {
    const existing = Array.from({ length: JOBS_PAGE_SIZE }, (_, index) =>
      job(
        `old-${index}`,
        1,
        'completed',
        `2026-11-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
      ),
    ).reverse();
    const client = clientWith(existing);
    applyJobToCache(client, job('new', 1, 'queued', '2026-11-30T00:00:00Z'));
    const jobs = cachedJobs(client);
    expect(jobs).toHaveLength(JOBS_PAGE_SIZE);
    expect(jobs[0].job_id).toBe('new');
  });

  it('flags an unread failure and leaves an unloaded list alone', () => {
    const client = clientWith([job('a', 1, 'processing', '2026-11-14T20:00:00Z')]);
    applyJobsToCache(client, [job('a', 2, 'failed', '2026-11-14T20:00:00Z')]);
    expect(client.getQueryData<JobsResponse>(jobsKeys.list())?.has_unread_failures).toBe(true);
    const empty = new QueryClient();
    applyJobToCache(empty, job('a', 1, 'queued', '2026-11-14T20:00:00Z'));
    expect(empty.getQueryData(jobsKeys.list())).toBeUndefined();
    expect(cachedJobs(empty)).toEqual([]);
  });
});

describe('room subscribers', () => {
  it('reports the last subscriber leaving', () => {
    const rooms = createRoomSubscribers();
    rooms.join('user');
    rooms.join('user');
    expect(rooms.leave('user')).toBe(false);
    expect(rooms.count('user')).toBe(1);
    expect(rooms.leave('user')).toBe(true);
    expect(rooms.count('user')).toBe(0);
  });
});

describe('navigation', () => {
  it('marks nested paths as active', () => {
    expect(isNavActive('/admin/users/abc', '/admin')).toBe(true);
    expect(isNavActive('/admin', '/admin')).toBe(true);
    expect(isNavActive('/jobs/', '/jobs')).toBe(true);
    expect(isNavActive('/administrator', '/admin')).toBe(false);
    expect(isNavActive('/dashboard', '/jobs')).toBe(false);
  });

  it('builds breadcrumbs', () => {
    expect(breadcrumbsFor('/dashboard')).toEqual([{ label: 'Dashboard' }]);
    expect(breadcrumbsFor('/admin/users/abc')).toEqual([
      { label: 'Admin', to: '/admin' },
      { label: 'User' },
    ]);
    expect(breadcrumbsFor('/admin/jobs/abc')[1]).toEqual({ label: 'Build' });
    expect(breadcrumbsFor('/jobs/abc')).toEqual([
      { label: 'Builds', to: '/jobs' },
      { label: 'Build' },
    ]);
  });

  it('says whether builds are running or only waiting', () => {
    expect(buildsBadge([{ status: 'queued' }])).toBe('1 queued');
    expect(buildsBadge([{ status: 'queued' }, { status: 'queued' }])).toBe('2 queued');
    expect(buildsBadge([{ status: 'processing' }, { status: 'queued' }])).toBe('1 building');
    expect(buildsBadge([{ status: 'completed' }, { status: 'failed' }])).toBeNull();
    expect(buildsBadge([])).toBeNull();
  });

  it('hides admin links from other users', () => {
    expect(visibleNav(MORE_NAV, false).map((item) => item.to)).toEqual(['/browse']);
    expect(visibleNav(MORE_NAV, true).map((item) => item.to)).toEqual(['/admin', '/browse']);
  });
});

describe('return path', () => {
  it('accepts only local app paths', () => {
    expect(safeReturnPath('/config?tab=whitelist')).toBe('/config?tab=whitelist');
    expect(safeReturnPath('//example.com')).toBeNull();
    expect(safeReturnPath('https://example.com')).toBeNull();
    expect(safeReturnPath('/login')).toBeNull();
    expect(safeReturnPath('/')).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
  });
});

describe('theme', () => {
  it('follows the system until a choice is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(oppositeTheme('dark')).toBe('light');
  });

  it('reads and writes the stored choice and survives blocked storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    expect(readStoredTheme(storage)).toBeNull();
    expect(writeStoredTheme(storage, 'light')).toBe(true);
    expect(values.get(THEME_STORAGE_KEY)).toBe('light');
    expect(readStoredTheme(storage)).toBe('light');
    values.set(THEME_STORAGE_KEY, 'sepia');
    expect(readStoredTheme(storage)).toBeNull();
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredTheme(blocked)).toBeNull();
    expect(writeStoredTheme(blocked, 'dark')).toBe(false);
  });
});

describe('status and tabs', () => {
  it('maps job and source status to one description', () => {
    expect(jobStatusDescription('processing')).toMatchObject({ tone: 'info', label: 'Building' });
    expect(jobStatusDescription('skipped')).toMatchObject({ tone: 'neutral', label: 'Skipped' });
    expect(sourceOutcome({ status: 'completed', stale: true, cache_hit: true })).toBe('stale');
    expect(sourceOutcome({ status: 'completed', stale: false, cache_hit: true })).toBe('cached');
    expect(sourceOutcome({ status: 'completed', stale: false, cache_hit: false })).toBe('current');
    expect(sourceOutcome({ status: 'failed', stale: false, cache_hit: false })).toBe('failed');
  });

  it('moves between tabs with the arrow, Home and End keys', () => {
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
    expect(nextTabIndex('Enter', 0, 3)).toBeNull();
  });
});
