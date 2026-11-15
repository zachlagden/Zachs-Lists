import { describe, expect, it } from 'vitest';
import domainLimit from '../../../../tests/fixtures/domain-limit.json';
import fixture from '../../../../tests/fixtures/job-progress.json';
import type { EnhancedJobProgress, Job, JobResult, JobStatus, SourceProgress } from '../../types';
import { attemptSeconds, isUnreadFailure, requestedBy, sourceProblemCause } from '../../lib/builds';
import {
  buildPhase,
  buildSources,
  buildSteps,
  buildSummary,
  formatRatio,
  hasStageProgress,
  outputLists,
  queueWaitSeconds,
} from './buildFacts';
import { ERROR_CODES, buildFailure } from './failureFacts';
import {
  combineHistory,
  finishedBuilds,
  historyFilterFrom,
  historyPaging,
  legacyBuildPath,
  nextHistoryLimit,
} from './historyFacts';
import {
  downloadRatio,
  largestSources,
  nameParts,
  sortSources,
  sourceNote,
  sourceTally,
} from './sourceFacts';
import { describeSeconds } from '../../lib/text';

type FixtureName = keyof typeof fixture;

const EMPTY_PROGRESS = {
  stage: 'queue',
  sources: [],
  whitelist: null,
  generation: null,
  stages: { downloading: null, whitelist: null, generation: null },
} as unknown as EnhancedJobProgress;

const EMPTY_RESULT: JobResult = {
  sources_processed: 0,
  sources_failed: 0,
  sources_stale: 0,
  total_domains: 0,
  unique_domains: 0,
  whitelisted_removed: 0,
  output_files: [],
  categories: {},
  errors: [],
  warnings: [],
  error_code: null,
  skip_reason: null,
  generation_id: null,
  limit: null,
};

function job(status: JobStatus, overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    job_id: 'job-1',
    user_id: 'user-1',
    username: 'alex',
    type: 'manual',
    status,
    progress: EMPTY_PROGRESS,
    created_at: '2026-03-04T05:06:00.000Z',
    rev: 1,
    ...overrides,
  };
}

function fromFixture(name: FixtureName, status: JobStatus, overrides: Partial<Job> = {}): Job {
  return job(status, {
    progress: fixture[name].progress as unknown as EnhancedJobProgress,
    result: fixture[name].result as JobResult | null,
    started_at: '2026-03-04T05:06:05.000Z',
    attempt_started_at: '2026-03-04T05:06:06.500Z',
    ...overrides,
  });
}

function failed(code: string | null, message: string, overrides: Partial<Job> = {}): Job {
  return job('failed', {
    result: { ...EMPTY_RESULT, error_code: code, errors: [message] },
    completed_at: '2026-03-04T05:06:20.000Z',
    ...overrides,
  });
}

function source(id: string, overrides: Partial<SourceProgress> = {}): SourceProgress {
  return {
    id,
    name: id,
    url: `https://lists.example.org/${id}.txt`,
    category: null,
    status: 'pending',
    cache_hit: null,
    stale: false,
    bytes_downloaded: 0,
    bytes_total: null,
    download_percent: null,
    download_time_ms: null,
    domain_count: null,
    domain_change: null,
    format_breakdown: null,
    detected_formats: [],
    error: null,
    warnings: [],
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

const midDownload = fromFixture('mid_download', 'processing');
const midGeneration = fromFixture('mid_generation', 'processing');
const completed = fromFixture('completed', 'completed', {
  completed_at: '2026-03-04T05:06:10.400Z',
});

describe('build phase', () => {
  it('follows the status, then the stage of a processing build', () => {
    expect(buildPhase(job('queued'))).toBe('queued');
    expect(buildPhase(job('processing'))).toBe('starting');
    expect(buildPhase(midDownload)).toBe('downloading');
    expect(buildPhase(midGeneration)).toBe('generation');
    expect(buildPhase(fromFixture('completed', 'processing'))).toBe('publishing');
    expect(buildPhase(completed)).toBe('completed');
    expect(buildPhase(fromFixture('mid_download', 'failed'))).toBe('failed');
    expect(buildPhase(job('skipped'))).toBe('skipped');
  });

  it('shows no leftover sources or stages for a build that is back in the queue', () => {
    const requeued = fromFixture('mid_download', 'queued');
    expect(buildSources(requeued)).toEqual([]);
    expect(hasStageProgress(requeued)).toBe(false);
    expect(buildSteps(requeued).map((step) => step.state)).toEqual([
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ]);
  });
});

describe('build summary', () => {
  it('never tells a processing build it is waiting for a worker', () => {
    const summary = buildSummary(job('processing'), 'owner');
    expect(summary.heading).toBe('Starting the build');
    expect(summary.detail).not.toMatch(/waiting/i);
  });

  it('describes the place in the queue and the workers online', () => {
    const next = job('queued', {
      queue_info: {
        position: 1,
        total_queued: 1,
        workers_alive: 2,
        active_workers: 2,
        jobs_processing: 1,
      },
    });
    expect(buildSummary(next, 'owner').detail).toBe(
      'This build is next in the queue. 2 build workers online.',
    );
    const third = job('queued', {
      queue_info: {
        position: 3,
        total_queued: 4,
        workers_alive: 0,
        active_workers: 0,
        jobs_processing: 0,
      },
    });
    expect(buildSummary(third, 'owner').detail).toBe(
      'This build is number 3 in the queue, with 2 ahead of it. No build worker is online, so it starts when one returns.',
    );
    expect(buildSummary(job('queued'), 'owner').detail).toBe(
      'This build is waiting for a build worker.',
    );
  });

  it('counts finished sources while downloading', () => {
    const summary = buildSummary(midDownload, 'owner');
    expect(summary.heading).toBe('Downloading sources');
    expect(summary.detail).toBe('1 of 3 sources finished.');
    expect(summary.publication).toBe(
      'Your published lists stay as they are until this build finishes.',
    );
  });

  it('says what a completed build published', () => {
    const summary = buildSummary(completed, 'owner');
    expect(summary.heading).toBe('Build completed');
    expect(summary.detail).toBe('Published 3,000 unique domains in 3 lists, from 2 sources.');
    expect(summary.publication).toBe('This build replaced your published lists.');
  });

  it('says a failed or skipped build left the published lists alone', () => {
    const failure = buildSummary(failed('internal', 'The build failed'), 'owner');
    expect(failure.publication).toBe(
      'Nothing was published. Your published lists were left unchanged.',
    );
    const overLimit = buildSummary(
      failed('domain_limit_exceeded', domainLimit.over_limit.error),
      'owner',
    );
    expect(overLimit.detail).toBe(domainLimit.over_limit.error);
    expect(overLimit.publication).toBe('');
    const skipped = buildSummary(
      job('skipped', {
        result: { ...EMPTY_RESULT, skip_reason: 'Nothing changed since the last build' },
      }),
      'owner',
    );
    expect(skipped.heading).toBe('Build skipped');
    expect(skipped.detail).toBe('Nothing changed since the last build.');
    expect(skipped.publication).toBe(
      'Nothing needed rebuilding. Your published lists were left unchanged.',
    );
  });

  it('does not call the lists "yours" for an admin looking at another build', () => {
    expect(buildSummary(midDownload, 'admin').publication).toBe(
      'The published lists stay as they are until this build finishes.',
    );
  });

  it('never gives a failed build the completed wording, even with a result', () => {
    const withResult = fromFixture('completed', 'failed', {
      result: { ...(fixture.completed.result as JobResult), error_code: 'internal' },
    });
    const summary = buildSummary(withResult, 'owner');
    expect(summary.heading).not.toMatch(/completed/i);
    expect(summary.detail).not.toMatch(/published/i);
  });
});

describe('build failure', () => {
  it('has a title, advice and a next step rule for every error code', () => {
    for (const code of ERROR_CODES) {
      const failure = buildFailure(failed(code, 'The server sentence'));
      expect(failure?.code).toBe(code);
      expect(failure?.title).not.toBe('The build failed');
      expect(failure?.advice.length).toBeGreaterThan(20);
      expect(failure?.serverMessage).toBe('The server sentence.');
    }
  });

  it('sends each code to the right next step', () => {
    const steps = (code: string) => buildFailure(failed(code, 'x'))?.nextSteps;
    expect(steps('invalid_config')).toEqual(['edit-sources']);
    expect(steps('no_sources')).toEqual(['edit-sources']);
    expect(steps('all_sources_failed')).toEqual(['edit-sources', 'build-again']);
    expect(steps('no_domains')).toEqual(['edit-sources']);
    expect(steps('domain_limit_exceeded')).toEqual(['edit-sources', 'request-limit']);
    expect(steps('worker_abandoned')).toEqual(['build-again']);
    expect(steps('internal')).toEqual(['build-again']);
    expect(steps('superseded')).toEqual([]);
  });

  it('carries both numbers for a build over the domain limit', () => {
    const over = failed('domain_limit_exceeded', 'Over the limit', {
      result: {
        ...EMPTY_RESULT,
        error_code: 'domain_limit_exceeded',
        errors: ['Over the limit'],
        limit: { max_domains: 2_000_000, actual_domains: 2_150_000 },
      },
    });
    expect(buildFailure(over)?.limit).toEqual({ max: 2_000_000, actual: 2_150_000, over: 150_000 });
  });

  it('falls back to plain wording for a code it does not know or a missing one', () => {
    expect(buildFailure(failed('brand_new_code', 'Something else'))?.title).toBe(
      'The build failed',
    );
    expect(buildFailure(job('failed'))?.serverMessage).toBe('');
    expect(buildFailure(completed)).toBeNull();
  });
});

describe('build steps', () => {
  it('marks the download step current with its real start time', () => {
    const steps = buildSteps(midDownload);
    expect(steps.map((step) => step.state)).toEqual(['current', 'waiting', 'waiting', 'waiting']);
    expect(steps[0].startedAt).toBe('2026-03-04T05:06:07.000Z');
    expect(steps[0].endedAt).toBeNull();
  });

  it('marks finished stages done with their own start and end', () => {
    const steps = buildSteps(midGeneration);
    expect(steps.map((step) => step.state)).toEqual(['done', 'done', 'current', 'waiting']);
    expect(steps[1]).toMatchObject({
      startedAt: '2026-03-04T05:06:09.200Z',
      endedAt: '2026-03-04T05:06:09.500Z',
    });
  });

  it('shows publishing between the last file and the completed status', () => {
    const publishing = buildSteps(fromFixture('completed', 'processing'));
    expect(publishing.map((step) => step.state)).toEqual(['done', 'done', 'done', 'current']);
    expect(publishing[3].startedAt).toBe('2026-03-04T05:06:10.300Z');
    const done = buildSteps(completed);
    expect(done.map((step) => step.state)).toEqual(['done', 'done', 'done', 'done']);
    expect(done[3].endedAt).toBe('2026-03-04T05:06:10.400Z');
  });

  it('marks the stage a failed build stopped in', () => {
    const stopped = buildSteps(
      fromFixture('mid_generation', 'failed', { completed_at: '2026-03-04T05:06:12.000Z' }),
    );
    expect(stopped.map((step) => step.state)).toEqual(['done', 'done', 'stopped', 'waiting']);
    expect(stopped[2].endedAt).toBe('2026-03-04T05:06:12.000Z');
  });
});

describe('build times', () => {
  it('measures the current attempt, not earlier ones', () => {
    const now = new Date('2026-03-04T05:06:36.500Z');
    expect(attemptSeconds(midDownload, now)).toBe(30);
    expect(attemptSeconds(completed, now)).toBeCloseTo(3.9);
    expect(
      attemptSeconds(job('queued', { attempt_started_at: '2026-03-04T05:06:06.500Z' }), now),
    ).toBeNull();
  });

  it('reads timestamps as UTC instants', () => {
    const now = new Date('2026-03-04T06:06:06.500+01:00');
    expect(attemptSeconds(midDownload, now)).toBe(0);
  });

  it('measures the wait from being queued to the first start', () => {
    expect(queueWaitSeconds(midDownload, new Date())).toBe(5);
    expect(queueWaitSeconds(job('queued'), new Date('2026-03-04T05:06:09.000Z'))).toBe(9);
  });

  it('words durations under a second', () => {
    expect(describeSeconds(0.3)).toBe('less than 1 s');
    expect(describeSeconds(0)).toBe('0 s');
    expect(describeSeconds(42)).toBe('42 s');
  });
});

describe('sources', () => {
  const sources = fixture.mid_download.progress.sources as unknown as SourceProgress[];

  it('counts finished, active and waiting sources, bytes and domains', () => {
    expect(sourceTally(sources)).toMatchObject({
      total: 3,
      finished: 1,
      active: 2,
      waiting: 0,
      problems: 1,
      stale: 1,
      failed: 0,
      bytesDownloaded: 57344,
      domainsRead: 2324,
    });
  });

  it('puts problems first, then active, finished and waiting, in configuration order', () => {
    const list = [
      source('a', { status: 'completed', cache_hit: false }),
      source('b'),
      source('c', { status: 'downloading' }),
      source('d', { status: 'failed' }),
      source('e', { status: 'processing' }),
      source('f', { status: 'completed', cache_hit: true, stale: true }),
      source('g', { status: 'completed', cache_hit: true }),
    ];
    expect(sortSources(list).map((item) => item.id)).toEqual(['d', 'f', 'c', 'e', 'a', 'g', 'b']);
  });

  it('keeps every row in place when a tick only moves bytes and counts', () => {
    const before = [
      source('a', { status: 'downloading', bytes_downloaded: 10 }),
      source('b', { status: 'processing', domain_count: 5 }),
      source('c', { status: 'downloading', bytes_downloaded: 1 }),
      source('d'),
    ];
    const after = [
      source('a', { status: 'processing', bytes_downloaded: 900, domain_count: 3 }),
      source('b', { status: 'processing', domain_count: 500 }),
      source('c', { status: 'downloading', bytes_downloaded: 400 }),
      source('d'),
    ];
    const order = (list: SourceProgress[]) => sortSources(list).map((item) => item.id);
    expect(order(after)).toEqual(order(before));
  });

  it('does not reorder the input', () => {
    const list = [source('a'), source('b', { status: 'failed' })];
    sortSources(list);
    expect(list.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('explains a failed source and an older copy from the worker report', () => {
    const stale = sources[1];
    expect(sourceNote(stale)).toEqual({
      tone: 'warn',
      text: 'Source returned HTTP 503. The build used an older copy.',
    });
    const failedSource = fixture.mid_generation.progress.sources[2] as unknown as SourceProgress;
    expect(sourceNote(failedSource)).toEqual({
      tone: 'fail',
      text: 'Source request timed out. No usable earlier copy exists, so this source was left out.',
    });
    expect(sourceNote(sources[0])).toBeNull();
    expect(sourceProblemCause('Plain failure; with detail')).toBe('Plain failure.');
  });

  it('lets a long name wrap after its separators', () => {
    expect(nameParts('acme_ads-extended.v2')).toEqual(['acme_', 'ads-', 'extended.', 'v2']);
    expect(nameParts('plain')).toEqual(['plain']);
  });

  it('gives a download ratio only when the total size is known', () => {
    expect(downloadRatio(sources[2])).toBe(0.25);
    expect(downloadRatio(sources[1])).toBeNull();
  });

  it('lists the largest usable sources for an over-limit build', () => {
    const list = [
      source('small', { status: 'completed', domain_count: 10 }),
      source('big', { status: 'completed', domain_count: 900 }),
      source('broken', { status: 'failed', domain_count: 5000 }),
      source('middle', { status: 'completed', domain_count: 300 }),
      source('waiting'),
    ];
    expect(largestSources(list, 2).map((item) => item.id)).toEqual(['big', 'middle']);
  });
});

describe('output', () => {
  it('groups the output files by list', () => {
    const lists = outputLists((fixture.completed.result as JobResult).output_files);
    expect(lists[0]).toEqual({
      name: 'advertising',
      domains: 1780,
      files: [
        { format: 'hosts', sizeBytes: 5200 },
        { format: 'plain', sizeBytes: 4300 },
        { format: 'adblock', sizeBytes: 4700 },
      ],
    });
    expect(lists.map((list) => list.name)).toEqual(['advertising', 'tracking', 'all_domains']);
  });

  it('takes the share written from domains written over the total', () => {
    const formats = fixture.mid_generation.progress.generation.formats;
    expect(formatRatio(formats[1])).toBeCloseTo(0.425);
    expect(formatRatio({ domains_written: 5, total_domains: 0 })).toBe(0);
  });
});

describe('who asked for the build', () => {
  it('names the account only to an admin', () => {
    expect(requestedBy({ type: 'manual', username: 'alex' }, 'owner')).toBe('Manual');
    expect(requestedBy({ type: 'manual', username: 'alex' }, 'admin')).toBe('Manual, by alex');
    expect(requestedBy({ type: 'scheduled', username: 'alex' }, 'admin')).toBe('Scheduled');
    expect(requestedBy({ type: 'admin', username: '__default__' }, 'admin')).toBe(
      'Started by an admin',
    );
  });
});

describe('build history', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 2, 4, 5, minute)).toISOString();
  const entry = (id: string, status: JobStatus, minute: number, rev = 1): Job =>
    job(status, { id, job_id: id, created_at: at(minute), rev });

  it('filters finished builds by result and leaves active builds out', () => {
    const jobs = [
      entry('run', 'processing', 9),
      entry('ok', 'completed', 8),
      entry('bad', 'failed', 7),
      entry('skip', 'skipped', 6),
    ];
    expect(finishedBuilds(jobs, 'all').map((item) => item.job_id)).toEqual(['ok', 'bad', 'skip']);
    expect(finishedBuilds(jobs, 'failed').map((item) => item.job_id)).toEqual(['bad']);
    expect(finishedBuilds(jobs, 'skipped').map((item) => item.job_id)).toEqual(['skip']);
  });

  it('reads the filter from the address and ignores anything else', () => {
    expect(historyFilterFrom('failed')).toBe('failed');
    expect(historyFilterFrom('processing')).toBe('all');
    expect(historyFilterFrom(null)).toBe('all');
  });

  it('joins the live list to an older page, keeping the newer revision', () => {
    const live = [entry('new', 'queued', 9), entry('b', 'completed', 5, 7)];
    const older = [entry('b', 'processing', 5, 3), entry('a', 'completed', 1)];
    expect(combineHistory(live, older).map((item) => [item.job_id, item.status])).toEqual([
      ['new', 'queued'],
      ['b', 'completed'],
      ['a', 'completed'],
    ]);
  });

  it('offers a larger page only while the last one came back full', () => {
    expect(nextHistoryLimit(20, 20)).toBe(50);
    expect(nextHistoryLimit(20, 12)).toBeNull();
    expect(nextHistoryLimit(50, 50)).toBe(100);
    expect(nextHistoryLimit(100, 100)).toBeNull();
  });

  it('keeps the older-builds button loading until the larger page arrives', () => {
    const waitingForFirstOlderPage = historyPaging({
      limit: 50,
      recentCount: 20,
      olderCount: null,
      olderIsForThisLimit: false,
    });
    expect(waitingForFirstOlderPage).toEqual({
      shown: 20,
      loadingOlder: true,
      nextLimit: null,
      showsEveryBuild: false,
    });
    const waitingWithThePreviousPage = historyPaging({
      limit: 100,
      recentCount: 20,
      olderCount: 50,
      olderIsForThisLimit: false,
    });
    expect(waitingWithThePreviousPage.loadingOlder).toBe(true);
    expect(waitingWithThePreviousPage.showsEveryBuild).toBe(false);
    expect(waitingWithThePreviousPage.shown).toBe(50);
  });

  it('says every build is shown only when the server returned fewer than asked for', () => {
    const page = (limit: number, recentCount: number, olderCount: number | null) =>
      historyPaging({ limit, recentCount, olderCount, olderIsForThisLimit: olderCount !== null });
    expect(page(20, 12, null)).toMatchObject({ showsEveryBuild: true, nextLimit: null });
    expect(page(20, 20, null)).toMatchObject({ showsEveryBuild: false, nextLimit: 50 });
    expect(page(50, 20, 31)).toMatchObject({ showsEveryBuild: true, nextLimit: null, shown: 31 });
    expect(page(50, 20, 50)).toMatchObject({ showsEveryBuild: false, nextLimit: 100 });
    expect(page(100, 20, 100)).toMatchObject({ showsEveryBuild: false, nextLimit: null });
  });

  it('marks only failures that have not been read', () => {
    expect(isUnreadFailure({ status: 'failed', read: false })).toBe(true);
    expect(isUnreadFailure({ status: 'failed', read: true })).toBe(false);
    expect(isUnreadFailure({ status: 'failed' })).toBe(false);
    expect(isUnreadFailure({ status: 'completed', read: false })).toBe(false);
  });

  it('turns an older query-string link into the build address', () => {
    expect(legacyBuildPath('?job=abc-1')).toBe('/jobs/abc-1');
    expect(legacyBuildPath('?jobId=a/b')).toBe('/jobs/a%2Fb');
    expect(legacyBuildPath('?page=2')).toBeNull();
    expect(legacyBuildPath('')).toBeNull();
  });
});
