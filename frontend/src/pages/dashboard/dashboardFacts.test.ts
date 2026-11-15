import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors';
import type { UserListsResponse } from '../../api/lists';
import {
  attemptSeconds,
  compressedSize,
  describeBuildRefusal,
  domainChange,
  domainsAfter,
  sourceProblemCause,
} from '../../lib/builds';
import fixture from '../../../../tests/fixtures/job-progress.json';
import type { Job, JobResult, LimitReview, SourceProgress, UserList } from '../../types';
import {
  attentionItems,
  describeAttention,
  describeManualBuilds,
  describeSourceSummary,
  domainUsage,
  lastCheckFoundChanges,
  nextManualBuildReset,
  publicationState,
  publishedJob,
  sourceSummary,
} from './dashboardFacts';

const completedProgress = fixture.completed.progress as Job['progress'];
const completedResult = fixture.completed.result as JobResult;
const GENERATION = completedResult.generation_id as string;

function job(overrides: Partial<Job> & Pick<Job, 'job_id' | 'status'>): Job {
  return {
    id: overrides.job_id,
    user_id: 'user-1',
    username: 'alex',
    type: 'manual',
    progress: completedProgress,
    result: null,
    started_at: '2026-11-08T06:40:00.000Z',
    completed_at: '2026-11-08T06:41:48.000Z',
    created_at: '2026-11-08T06:40:00.000Z',
    rev: 1,
    ...overrides,
  };
}

function list(name: string, domainCount: number): UserList {
  return {
    name,
    domain_count: domainCount,
    formats: ['hosts', 'plain', 'adblock'],
    last_updated: '',
  };
}

function listsResponse(overrides: Partial<UserListsResponse> = {}): UserListsResponse {
  return {
    lists: [list('all_domains', 3000), list('advertising', 1780), list('tracking', 1220)],
    published_at: '2026-11-08T06:42:00.000Z',
    generation_id: GENERATION,
    stats: {
      total_domains: 3000,
      total_output_size_bytes: 1,
      last_build_at: null,
      manual_updates_this_week: 1,
      week_reset_at: null,
    },
    limits: {
      max_source_lists: 50,
      max_domains: 4000,
      max_config_size_mb: 1,
      manual_updates_per_week: 3,
    },
    remaining_updates: 2,
    enforce_domain_limit: false,
    next_rebuild_at: '2026-11-15T07:30:00.000Z',
    last_checked_at: '2026-11-08T06:41:48.000Z',
    ...overrides,
  };
}

const published = job({ job_id: 'published', status: 'completed', result: completedResult });
const earlier = job({
  job_id: 'earlier',
  status: 'completed',
  created_at: '2026-11-01T06:40:00.000Z',
  result: { ...completedResult, unique_domains: 2800, generation_id: 'older' },
});
const skipped = job({
  job_id: 'skipped',
  status: 'skipped',
  created_at: '2026-11-12T19:20:00.000Z',
  completed_at: '2026-11-12T19:20:09.000Z',
});
const failed = job({ job_id: 'failed', status: 'failed', created_at: '2026-11-13T10:00:00.000Z' });
const running = job({
  job_id: 'running',
  status: 'processing',
  created_at: '2026-11-14T20:41:00.000Z',
  started_at: '2026-11-14T20:41:00.000Z',
  completed_at: null,
});

describe('schedule', () => {
  it('resets manual builds at the start of Sunday UTC', () => {
    expect(nextManualBuildReset(new Date('2026-11-14T20:41:00Z')).toISOString()).toBe(
      '2026-11-15T00:00:00.000Z',
    );
    expect(nextManualBuildReset(new Date('2026-11-15T09:00:00Z')).toISOString()).toBe(
      '2026-11-22T00:00:00.000Z',
    );
  });
});

describe('build history', () => {
  const jobs = [skipped, published, earlier];

  it('finds the build that produced the published generation', () => {
    expect(publishedJob(jobs, GENERATION)?.job_id).toBe('published');
    expect(publishedJob(jobs, 'unknown')).toBeNull();
    expect(publishedJob(jobs, null)).toBeNull();
  });

  it('says whether the last check of the sources found anything new', () => {
    expect(lastCheckFoundChanges(jobs, '2026-11-12T19:20:09.000Z')).toBe(false);
    expect(lastCheckFoundChanges([failed, published], '2026-11-08T06:41:48.000Z')).toBe(true);
    expect(lastCheckFoundChanges(jobs, '2026-10-01T00:00:00.000Z')).toBeNull();
    expect(lastCheckFoundChanges(jobs, null)).toBeNull();
  });

  it('works out the change against the previous completed build', () => {
    expect(domainChange(jobs, published)).toBe(200);
    expect(domainChange(jobs, skipped)).toBe(0);
    expect(domainChange(jobs, earlier)).toBeNull();
    expect(domainChange([failed], failed)).toBeNull();
  });

  it('shows the published count for a skipped build', () => {
    expect(domainsAfter(jobs, skipped)).toBe(3000);
    expect(domainsAfter(jobs, published)).toBe(3000);
    expect(domainsAfter([failed], failed)).toBeNull();
  });

  it('measures how long a build took, or has taken so far', () => {
    expect(attemptSeconds(published, new Date())).toBe(108);
    expect(attemptSeconds(running, new Date('2026-11-14T20:41:42Z'))).toBe(42);
    expect(attemptSeconds({ ...running, started_at: null }, new Date())).toBeNull();
  });
});

describe('publicationState', () => {
  const lists = listsResponse();
  const unpublished = listsResponse({ lists: [], published_at: null, generation_id: null });

  it('covers a new account, a first build and a published list', () => {
    expect(publicationState(false, unpublished, [])).toBe('no-config');
    expect(publicationState(true, unpublished, [])).toBe('never-built');
    expect(publicationState(true, unpublished, [running])).toBe('building');
    expect(publicationState(true, lists, [published])).toBe('published');
    expect(publicationState(true, lists, [skipped, published])).toBe('published');
    expect(publicationState(true, lists, [failed, published])).toBe('published-last-failed');
    expect(publicationState(true, lists, [running, failed, published])).toBe('building');
  });
});

describe('domainUsage', () => {
  const openReview: LimitReview = {
    actual_domains: 5200,
    max_domains: 4000,
    method: 'stored',
    detected_at: null,
    notified_at: null,
    status: 'open',
    resolved_at: null,
    resolved_by: null,
    resolved_reason: null,
  };

  it('uses the exact count the published build measured across all categories', () => {
    const measured = job({
      job_id: 'measured',
      status: 'completed',
      result: { ...completedResult, limit: { max_domains: 4000, actual_domains: 3300 } },
    });
    const lists = listsResponse({
      lists: [list('all_domains', 3000), list('nsfw', 400), list('advertising', 1780)],
    });
    expect(domainUsage(lists, null, [measured])).toEqual({
      domains: 3300,
      exact: true,
      limit: 4000,
      ratio: 0.825,
      over: false,
    });
  });

  it('adds the nsfw list to the combined list when no build measurement is known', () => {
    const lists = listsResponse({
      lists: [list('all_domains', 3000), list('nsfw', 1200)],
      generation_id: 'not-in-history',
    });
    const usage = domainUsage(lists, null, [published]);
    expect(usage.domains).toBe(4200);
    expect(usage.exact).toBe(false);
    expect(usage.over).toBe(true);
  });

  it('is exact from list metadata when nothing is left out of the combined list', () => {
    const usage = domainUsage(listsResponse({ generation_id: 'not-in-history' }), null, []);
    expect(usage).toMatchObject({ domains: 3000, exact: true, over: false });
  });

  it('falls back to an open review when the build is not in the history', () => {
    const lists = listsResponse({ generation_id: 'not-in-history' });
    expect(domainUsage(lists, openReview, [])).toMatchObject({
      domains: 5200,
      exact: false,
      over: true,
    });
    expect(domainUsage(lists, { ...openReview, status: 'resolved' }, []).domains).toBe(3000);
  });
});

describe('sources', () => {
  const sources = completedProgress.sources;

  it('counts current, stale and failed sources from the shared fixture', () => {
    const summary = sourceSummary(sources);
    expect(summary).toEqual({ total: 3, current: 1, stale: 1, failed: 1 });
    expect(describeSourceSummary(summary)).toBe('1 current · 1 older copy · 1 failed');
    expect(describeSourceSummary({ total: 4, current: 2, stale: 2, failed: 0 })).toBe(
      '2 current · 2 older copies',
    );
  });

  it('lists what needs attention with the cause in plain words', () => {
    expect(attentionItems(sources)).toEqual([
      {
        id: sources[1].id,
        name: sources[1].name,
        kind: 'stale',
        detail: 'Source returned HTTP 503. The build used an older copy.',
      },
      {
        id: sources[2].id,
        name: sources[2].name,
        kind: 'failed',
        detail: 'Source request timed out. No usable earlier copy exists, so it was left out.',
      },
    ]);
    expect(attentionItems([sources[0]])).toEqual([]);
  });

  it('summarises attention in one sentence', () => {
    expect(describeAttention({ total: 3, current: 1, stale: 1, failed: 1 })).toBe(
      '2 sources need attention: one used an older copy and one was left out.',
    );
    expect(describeAttention({ total: 3, current: 0, stale: 0, failed: 3 })).toBe(
      '3 sources need attention: 3 were left out.',
    );
    expect(describeAttention({ total: 3, current: 3, stale: 0, failed: 0 })).toBe('');
  });

  it('falls back when the worker gives no reason', () => {
    expect(sourceProblemCause(null)).toBe('');
    expect(sourceProblemCause('Connection refused; no cache')).toBe('Connection refused.');
    const silent: SourceProgress = { ...sources[2], error: null };
    expect(attentionItems([silent])[0].detail).toBe(
      'The download failed. No usable earlier copy exists, so it was left out.',
    );
  });
});

describe('list files', () => {
  it('finds the compressed size of one file', () => {
    expect(compressedSize(published, 'advertising', 'hosts')).toBe(5200);
    expect(compressedSize(published, 'missing', 'hosts')).toBeNull();
    expect(compressedSize(null, 'advertising', 'hosts')).toBeNull();
  });
});

describe('manual builds', () => {
  const now = new Date('2026-11-14T20:41:00Z');

  it('says how many builds are left', () => {
    expect(describeManualBuilds(2, 3, false, now)).toBe('2 of 3 manual builds left this week');
    expect(describeManualBuilds(0, 3, false, now)).toMatch(
      /^No manual builds left this week\. More on /,
    );
    expect(describeManualBuilds(0, 3, true, now)).toBe(
      'Admin builds do not count towards a weekly limit',
    );
  });

  function refusal(status: number, body: Record<string, unknown>): ApiError {
    return new ApiError({ kind: 'http', status, message: String(body.error), body });
  }

  it('explains each refusal the server can send', () => {
    expect(
      describeBuildRefusal(
        refusal(429, { error: 'Please wait', code: 'cooldown', cooldown_remaining: 252 }),
        now,
      ),
    ).toBe('A build finished recently. You can start another in 4 min 12 s.');
    expect(
      describeBuildRefusal(
        refusal(429, {
          error: 'Weekly manual update limit reached',
          code: 'weekly_limit',
          resets_at: '2026-11-15T00:00:00.000Z',
        }),
        now,
      ),
    ).toMatch(/^You have used all of this week's manual builds\. More on /);
    expect(
      describeBuildRefusal(
        refusal(409, { error: 'A build is already in progress', code: 'build_active' }),
      ),
    ).toBe('A build is already running, so a new one was not started.');
    expect(
      describeBuildRefusal(
        refusal(400, { error: 'No blocklist configuration found', code: 'no_config' }),
      ),
    ).toBe(
      'There are no saved sources to build from yet. Add one on the Configuration page first.',
    );
    expect(
      describeBuildRefusal(
        refusal(400, {
          error: 'Blocklist configuration is invalid',
          code: 'invalid_config',
          errors: ['Line 3: not a URL'],
        }),
      ),
    ).toBe(
      'Your saved sources have a problem, so the build was not started: Line 3: not a URL. Fix it on the Configuration page, then build again.',
    );
  });

  it('is honest when the server could not be reached', () => {
    const offline = new ApiError({ kind: 'network', message: 'Could not reach the server.' });
    expect(describeBuildRefusal(offline)).toBe(
      'Could not reach the server. The build was not started.',
    );
  });
});
