import { describe, expect, it } from 'vitest';
import type { AdminSystemStats, LibraryEntry } from '../../api/admin';
import { ApiError } from '../../api/errors';
import type { Job, LimitRequest } from '../../types';
import { announcementState, draftSubmission } from './announcements/announcementFacts';
import { activeFirst, filterBuilds, ownerLabel, progressSummary } from './builds/buildFacts';
import {
  addFeaturedFailure,
  draftErrors as featuredDraftErrors,
  planFeaturedMove,
} from './featured/featuredFacts';
import {
  draftErrors as libraryDraftErrors,
  entryDraft,
  filterLibrary,
  groupByCategory,
  saveFailure,
} from './library/libraryFacts';
import {
  commitUrl,
  countEntries,
  matchingLines,
  numberedLines,
  repositoryUrl,
  shortSha,
  syncOutcomeMessage,
} from './default-lists/defaultListFacts';
import {
  customLimitError,
  customLimitRange,
  methodLabel,
  orderRequests,
  percentOverText,
  requestUsage,
} from './limits/limitFacts';
import {
  barSummary,
  buildBars,
  fillDays,
  recentFailedBuilds,
  workerState,
} from './overview/overviewFacts';
import { withEdit } from '../../lib/editOverlay';
import {
  NO_LIMIT_EDITS,
  changedLimits,
  describeChangedUnderneath,
  hasEdits,
  isOverride,
  limitErrors,
  limitValues,
  limitsChangedUnderneath,
  shownLimits,
} from './users/detail/limitsForm';
import {
  apiFilters,
  banEnd,
  lastSeen,
  roleDescription,
  stateDescription,
  userListState,
} from './users/userFacts';

function job(overrides: Partial<Job>): Job {
  return {
    id: overrides.job_id ?? 'j',
    job_id: 'j',
    user_id: 'u1',
    username: 'alex',
    type: 'manual',
    status: 'completed',
    created_at: '2026-11-10T10:00:00Z',
    progress: {
      stage: 'completed',
      total_sources: 0,
      processed_sources: 0,
      sources: [],
      generation: null,
    },
    ...overrides,
  } as Job;
}

const LIMITS = {
  max_domains: 6_000_000,
  max_source_lists: 50,
  max_config_size_mb: 10,
  manual_updates_per_week: 3,
};
const LIMIT_SUBJECT = {
  limits: { ...LIMITS, max_domains: 10_000_000 },
  default_limits: LIMITS,
  limit_maximums: {
    max_domains: 20_000_000,
    max_source_lists: 1000,
    max_config_size_mb: 10,
    manual_updates_per_week: 100,
  },
};

describe('overview facts', () => {
  const stats = {
    jobs: { today: 3, processing: 1, queued: 2 },
    workers: { alive: 0 },
  } as AdminSystemStats;

  it('says builds wait when no worker is alive', () => {
    expect(workerState(stats)).toMatchObject({
      tone: 'fail',
      label: 'No worker running',
      detail: '3 builds will wait until a worker starts',
    });
    expect(workerState({ ...stats, workers: { alive: 2 } })).toMatchObject({
      tone: 'ok',
      detail: '1 building, 2 queued',
    });
  });

  it('fills days without builds so the chart covers the whole period', () => {
    const days = fillDays(
      [{ date: '2026-11-14', total: 4, completed: 3, failed: 1 }],
      new Date('2026-11-15T12:00:00Z'),
      3,
    );
    expect(days.map((day) => [day.date, day.total])).toEqual([
      ['2026-11-13', 0],
      ['2026-11-14', 4],
      ['2026-11-15', 0],
    ]);
    expect(barSummary(buildBars(days), 'build')).toMatch(
      /^4 builds over 3 days, 1 failed\. Busiest day: .*14.*: 4 builds, 1 failed\.$/,
    );
    expect(barSummary([], 'download')).toBe('No downloads recorded.');
  });

  it('lists only failed builds', () => {
    const jobs = [job({ job_id: 'a', status: 'failed' }), job({ job_id: 'b' })];
    expect(recentFailedBuilds(jobs).map((item) => item.job_id)).toEqual(['a']);
  });
});

describe('build facts', () => {
  const jobs = [
    job({ job_id: 'done' }),
    job({ job_id: 'queued', status: 'queued', username: 'jo', user_id: 'u2' }),
    job({ job_id: 'default', username: '__default__', user_id: null, type: 'scheduled' }),
    job({ job_id: 'running', status: 'processing', type: 'admin' }),
  ];

  it('pins running then queued builds and keeps the rest in order', () => {
    expect(activeFirst(jobs).map((item) => item.job_id)).toEqual([
      'running',
      'queued',
      'done',
      'default',
    ]);
  });

  it('filters by result, type and owner', () => {
    const all = { status: 'all', type: 'all', search: '' } as const;
    expect(filterBuilds(jobs, { ...all, status: 'queued' })).toHaveLength(1);
    expect(filterBuilds(jobs, { ...all, type: 'admin' })[0].job_id).toBe('running');
    expect(filterBuilds(jobs, { ...all, search: ' JO ' })[0].job_id).toBe('queued');
    expect(filterBuilds(jobs, { ...all, search: 'default' })[0].job_id).toBe('default');
    expect(ownerLabel(jobs[2])).toBe('Default lists');
  });

  it('summarises progress for each state', () => {
    expect(
      progressSummary(
        job({
          status: 'queued',
          queue_info: { position: 2, total_queued: 5, active_workers: 1, jobs_processing: 1 },
        }),
      ).text,
    ).toBe('Position 2 of 5 in the queue');
    const downloading = job({ status: 'processing' });
    downloading.progress = {
      ...downloading.progress,
      stage: 'downloading',
      total_sources: 8,
      processed_sources: 2,
    };
    expect(progressSummary(downloading)).toEqual({
      text: 'Downloading sources, 2 of 8',
      percent: 25,
    });
    expect(
      progressSummary(
        job({ status: 'failed', result: { errors: ['Over the limit'] } as Job['result'] }),
      ).text,
    ).toBe('Over the limit');
    expect(
      progressSummary(job({ result: { unique_domains: 1234567 } as Job['result'] })).text,
    ).toBe('1,234,567 domains');
  });
});

describe('user facts', () => {
  it('reads the list state from the address and turns it into API filters', () => {
    const state = userListState(
      new URLSearchParams('q=al&role=admins&state=disabled&banned=1&page=2'),
    );
    expect(state).toEqual({
      search: 'al',
      role: 'admins',
      state: 'disabled',
      bannedOnly: true,
      page: 2,
    });
    expect(apiFilters(state, ' al ')).toEqual({
      page: 2,
      search: 'al',
      showAdmins: true,
      showRegular: false,
      showEnabled: false,
      showDisabled: true,
      bannedOnly: true,
    });
    expect(userListState(new URLSearchParams('role=root')).role).toBe('all');
  });

  it('describes role and state in words', () => {
    expect(roleDescription({ is_root: true, is_admin: true }).label).toBe('Root');
    expect(roleDescription({ is_root: false, is_admin: false }).label).toBe('Member');
    expect(stateDescription({ is_banned: true, is_enabled: true }).label).toBe('Banned');
    expect(stateDescription({ is_banned: false, is_enabled: false }).label).toBe('Disabled');
  });

  it('takes the latest sighting as last seen', () => {
    const log = [
      { ip_hash: 'a', first_seen: null, last_seen: '2026-11-01T00:00:00Z', access_count: 1 },
      { ip_hash: 'b', first_seen: null, last_seen: '2026-11-09T00:00:00Z', access_count: 1 },
      { ip_hash: 'c', first_seen: null, last_seen: null, access_count: 1 },
    ];
    expect(lastSeen({ ip_log: log })?.toISOString()).toBe('2026-11-09T00:00:00.000Z');
    expect(lastSeen({ ip_log: [] })).toBeNull();
  });

  it('calls a ban a century long permanent', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    expect(banEnd('2126-10-22T12:00:00Z', now)).toBe('Permanent');
    expect(banEnd('2026-11-22T12:00:00Z', now)).toMatch(/^Until .*22/);
    expect(banEnd(null, now)).toBe('No end recorded');
  });
});

describe('limits form', () => {
  it('marks only values that differ from the default as overrides', () => {
    expect(isOverride(LIMIT_SUBJECT, 'max_domains')).toBe(true);
    expect(isOverride(LIMIT_SUBJECT, 'max_source_lists')).toBe(false);
  });

  it('checks each value against the bounds the server sends', () => {
    const values = {
      ...limitValues(LIMIT_SUBJECT.limits),
      max_domains: '20000001',
      max_source_lists: '0',
      max_config_size_mb: '1.5',
    };
    expect(limitErrors(LIMIT_SUBJECT, values)).toEqual({
      max_domains: 'Enter a number between 1 and 20,000,000.',
      max_source_lists: 'Enter a number between 1 and 1,000.',
      max_config_size_mb: 'Enter a whole number.',
    });
  });

  it('sends only the limits that changed, including a reset to the default', () => {
    const saved = limitValues(LIMIT_SUBJECT.limits);
    const edits = withEdit(saved, NO_LIMIT_EDITS, 'max_domains', '6000000');
    expect(changedLimits(LIMIT_SUBJECT, edits)).toEqual({ max_domains: 6_000_000 });
    expect(changedLimits(LIMIT_SUBJECT, NO_LIMIT_EDITS)).toEqual({});
    expect(hasEdits(LIMIT_SUBJECT, NO_LIMIT_EDITS)).toBe(false);
  });

  it('never sends back a limit the admin did not edit after it changes on the server', () => {
    const saved = limitValues(LIMIT_SUBJECT.limits);
    const edits = withEdit(saved, NO_LIMIT_EDITS, 'max_source_lists', '80');
    const approved = {
      ...LIMIT_SUBJECT,
      limits: { ...LIMIT_SUBJECT.limits, max_domains: 12_000_000 },
    };
    expect(shownLimits(approved, edits).max_domains).toBe('12000000');
    expect(changedLimits(approved, edits)).toEqual({ max_source_lists: 80 });
    expect(hasEdits(approved, NO_LIMIT_EDITS)).toBe(false);
    expect(limitsChangedUnderneath(approved, edits)).toEqual([]);
  });

  it('says when a limit the admin is editing changed on the server', () => {
    const saved = limitValues(LIMIT_SUBJECT.limits);
    const edits = withEdit(saved, NO_LIMIT_EDITS, 'max_domains', '9000000');
    const approved = {
      ...LIMIT_SUBJECT,
      limits: { ...LIMIT_SUBJECT.limits, max_domains: 12_000_000 },
    };
    expect(limitsChangedUnderneath(approved, edits)).toEqual(['max_domains']);
    expect(describeChangedUnderneath(approved, ['max_domains'])).toBe(
      'Domains across all lists is now 12,000,000 domains on the server.',
    );
  });
});

describe('limit facts', () => {
  const request = (overrides: Partial<LimitRequest>): LimitRequest =>
    ({
      id: 'r',
      user_id: 'u1',
      status: 'pending',
      current_limit: 6_000_000,
      current_usage: 5_000_000,
      created_at: '2026-11-10T00:00:00Z',
      ...overrides,
    }) as LimitRequest;

  it('lists waiting requests first, oldest first, then the latest decisions', () => {
    const ordered = orderRequests([
      request({ id: 'approved-old', status: 'approved', reviewed_at: '2026-11-01T00:00:00Z' }),
      request({ id: 'pending-new', created_at: '2026-11-12T00:00:00Z' }),
      request({ id: 'denied-new', status: 'denied', reviewed_at: '2026-11-11T00:00:00Z' }),
      request({ id: 'pending-old', created_at: '2026-11-02T00:00:00Z' }),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      'pending-old',
      'pending-new',
      'denied-new',
      'approved-old',
    ]);
  });

  it('prefers a measured figure over the stored count and says which it is', () => {
    const measuredJob = job({
      result: { limit: { max_domains: 6_000_000, actual_domains: 6_100_000 } } as Job['result'],
    });
    expect(
      requestUsage(request({}), [{ user_id: 'u1', actual_domains: 6_275_209 }], [measuredJob]),
    ).toEqual({
      domains: 6_275_209,
      source: 'review',
    });
    expect(requestUsage(request({}), [], [job({ user_id: 'u9' }), measuredJob])).toEqual({
      domains: 6_100_000,
      source: 'build',
    });
    expect(requestUsage(request({}), [], [])).toEqual({ domains: 5_000_000, source: 'stored' });
  });

  it('checks a custom limit against the allowed range', () => {
    const range = customLimitRange(request({}), 20_000_000);
    expect(customLimitError('10000000', range)).toBeNull();
    expect(customLimitError('5999999', range)).toMatch(/at least 6,000,000/);
    expect(customLimitError('20000001', range)).toMatch(/at most 20,000,000/);
    expect(customLimitError('ten', range)).toMatch(/whole number/);
    expect(customLimitError('99999999', customLimitRange(request({}), null))).toBeNull();
  });

  it('labels how a review was measured, including a missing method', () => {
    expect(methodLabel('build')).toBe('Counted by a build');
    expect(methodLabel(null)).toBe('Not recorded');
    expect(percentOverText(4.6)).toBe('4.6%');
  });
});

describe('default list facts', () => {
  it('counts entries without comments and blank lines', () => {
    expect(countEntries('# note\n\nhttps://lists.example.org/a.txt|a|ads\n  \nexample.com\n')).toBe(
      2,
    );
  });

  it('links only a well-formed repository and commit', () => {
    expect(repositoryUrl('acme/lists')).toBe('https://github.com/acme/lists');
    expect(repositoryUrl('acme/lists/../x')).toBeNull();
    expect(commitUrl('acme/lists', 'abcdef1234567890')).toBe(
      'https://github.com/acme/lists/commit/abcdef1234567890',
    );
    expect(commitUrl('acme/lists', 'not a sha')).toBeNull();
    expect(shortSha('abcdef1234567890')).toBe('abcdef1');
  });

  it('keeps line numbers when searching', () => {
    const lines = numberedLines('one\ntwo.example.com\nthree\n');
    expect(lines).toHaveLength(3);
    expect(matchingLines(lines, 'EXAMPLE')).toEqual([{ number: 2, text: 'two.example.com' }]);
    expect(matchingLines(lines, ' ')).toHaveLength(3);
  });

  it('explains each sync outcome', () => {
    const base = { sync_enabled: true, repo: 'acme/lists', revision: 1, source: null };
    const outcome = {
      status: 'failed' as const,
      changed: false,
      commit_changed: false,
      commit_sha: null,
      source_count: null,
      error: 'blocklists.conf has 2 sources',
      can_force: true,
    };
    expect(
      syncOutcomeMessage({ ...base, sync: outcome, job_id: null, build_refusal: null }),
    ).toMatchObject({
      tone: 'fail',
      detail: 'blocklists.conf has 2 sources',
      canForce: true,
    });
    expect(
      syncOutcomeMessage({
        ...base,
        sync: { ...outcome, status: 'updated', error: null, can_force: false, source_count: 6 },
        job_id: 'job-1',
        build_refusal: null,
      }),
    ).toMatchObject({ tone: 'ok', jobId: 'job-1' });
    expect(
      syncOutcomeMessage({
        ...base,
        sync: { ...outcome, status: 'unchanged', error: null, can_force: false },
        job_id: null,
        build_refusal: 'A build is already running',
      }).detail,
    ).toMatch(/No build was queued: A build is already running/);
  });
});

describe('announcement facts', () => {
  const now = new Date('2026-11-15T12:00:00Z');

  it('tells showing, turned off and expired apart', () => {
    expect(announcementState({ is_active: true, expires_at: null }, now)).toBe('showing');
    expect(announcementState({ is_active: false, expires_at: null }, now)).toBe('off');
    expect(announcementState({ is_active: true, expires_at: '2026-11-15T11:00:00Z' }, now)).toBe(
      'expired',
    );
  });

  it('sends a local end time as UTC and an empty one as null', () => {
    const draft = {
      title: ' Hello ',
      message: ' Text ',
      type: 'warning' as const,
      expiresLocal: '',
    };
    expect(draftSubmission(draft)).toEqual({
      title: 'Hello',
      message: 'Text',
      type: 'warning',
      expires_at: null,
    });
    const sent = draftSubmission({ ...draft, expiresLocal: '2026-12-01T09:30' }).expires_at;
    expect(sent).toBe(new Date(2026, 11, 1, 9, 30).toISOString());
    expect(sent).toMatch(/Z$/);
  });
});

describe('library facts', () => {
  const entry = (overrides: Partial<LibraryEntry>): LibraryEntry => ({
    id: 'e',
    url: 'https://lists.example.org/ads.txt',
    name: 'Acme Ads',
    category: 'advertising',
    description: 'Common advertising hosts',
    recommended: true,
    aggressiveness: 2,
    domain_count: 1000,
    added_by: 'sam',
    created_at: null,
    updated_at: null,
    ...overrides,
  });

  it('groups entries in the fixed category order and drops empty groups', () => {
    const groups = groupByCategory([
      entry({ id: 'a', category: 'tracking' }),
      entry({ id: 'b', category: 'comprehensive' }),
      entry({ id: 'c', category: 'tracking' }),
    ]);
    expect(groups.map((group) => [group.category, group.entries.length])).toEqual([
      ['comprehensive', 1],
      ['tracking', 2],
    ]);
  });

  it('searches the name, address and description within a category', () => {
    const entries = [
      entry({ id: 'a' }),
      entry({
        id: 'b',
        name: 'Sample Malware',
        category: 'malicious',
        url: 'https://lists.example.org/m.txt',
        description: '',
      }),
    ];
    expect(filterLibrary(entries, 'MALWARE', 'all').map((item) => item.id)).toEqual(['b']);
    expect(filterLibrary(entries, 'example.org', 'advertising').map((item) => item.id)).toEqual([
      'a',
    ]);
    expect(filterLibrary(entries, 'advertising hosts', 'all')).toHaveLength(1);
  });

  it('checks a draft with the bounds the server uses', () => {
    const draft = {
      ...entryDraft(null),
      url: 'ftp://example.org/x',
      aggressiveness: '6',
      domainCount: '-1',
    };
    expect(libraryDraftErrors(draft)).toEqual({
      url: 'The address must start with http:// or https://.',
      name: 'Enter a name.',
      aggressiveness: 'Enter a whole number from 1 to 5.',
      domain_count: 'Enter a whole number from 0 to 1,000,000,000.',
    });
    expect(libraryDraftErrors(entryDraft(entry({})))).toEqual({});
  });

  it('puts a duplicate address on the address field', () => {
    const duplicate = new ApiError({
      kind: 'http',
      status: 409,
      message: 'URL already exists in library',
    });
    expect(saveFailure(duplicate).fields.url).toMatch(/already uses this address/);
  });
});

describe('featured facts', () => {
  it('puts a missing account or list on the matching field', () => {
    const missing = (message: string) => new ApiError({ kind: 'http', status: 404, message });
    expect(addFeaturedFailure(missing('User not found')).fields.username).toBeDefined();
    expect(addFeaturedFailure(missing('List not found')).fields.list_name).toBeDefined();
    const featured = new ApiError({
      kind: 'http',
      status: 409,
      message: 'This list is already featured',
      code: 'already_featured',
      body: { error: 'This list is already featured' },
    });
    expect(addFeaturedFailure(featured).form).toBe('This list is already featured.');
  });

  it('requires a username and a list name', () => {
    expect(
      Object.keys(featuredDraftErrors({ username: ' ', listName: '', description: '' })),
    ).toEqual(['username', 'list_name']);
  });
});

describe('reordering featured lists', () => {
  const featured = [
    { id: 'a', order: 1 },
    { id: 'b', order: 2 },
    { id: 'c', order: 5 },
  ];

  it('swaps the order of the two lists that change places', () => {
    expect(planFeaturedMove(featured, 1, 'up')).toEqual([
      { id: 'b', order: 1 },
      { id: 'a', order: 2 },
    ]);
    expect(planFeaturedMove(featured, 1, 'down')).toEqual([
      { id: 'b', order: 5 },
      { id: 'c', order: 2 },
    ]);
  });

  it('does nothing at either end', () => {
    expect(planFeaturedMove(featured, 0, 'up')).toEqual([]);
    expect(planFeaturedMove(featured, 2, 'down')).toEqual([]);
    expect(planFeaturedMove(featured, 9, 'up')).toEqual([]);
  });

  it('renumbers the whole sequence when the two lists share an order', () => {
    const tied = [
      { id: 'a', order: 0 },
      { id: 'b', order: 0 },
      { id: 'c', order: 3 },
    ];
    expect(planFeaturedMove(tied, 1, 'up')).toEqual([
      { id: 'b', order: 1 },
      { id: 'a', order: 2 },
    ]);
    expect(planFeaturedMove(tied, 0, 'down')).toEqual([
      { id: 'b', order: 1 },
      { id: 'a', order: 2 },
    ]);
  });
});
