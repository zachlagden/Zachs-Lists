import { describe, expect, it } from 'vitest';
import type { Job } from '../types';
import {
  OFFLINE_AFTER_FAILURES,
  RECONNECT_MAX_MS,
  reconnectDelay,
  stateAfterFailures,
} from './backoff';
import { belongsTo, mergeFetchedList, mergeJob, mergeJobs } from './jobMerge';
import { planResync, resyncJobs } from './resync';

function job(id: string, rev: number, status: Job['status'] = 'processing', minute = 0): Job {
  return {
    id,
    job_id: id,
    user_id: 'user-1',
    username: 'sam',
    type: 'manual',
    status,
    progress: { stage: 'downloading' } as Job['progress'],
    created_at: new Date(Date.UTC(2026, 0, 1, 12, minute)).toISOString(),
    rev,
  };
}

describe('reconnect backoff', () => {
  it('doubles from one second and stops at the cap', () => {
    const longest = (failures: number) => reconnectDelay(failures, () => 1);
    expect([1, 2, 3, 4, 5, 6, 7, 50].map(longest)).toEqual([
      1000,
      2000,
      4000,
      8000,
      16000,
      RECONNECT_MAX_MS,
      RECONNECT_MAX_MS,
      RECONNECT_MAX_MS,
    ]);
  });

  it('spreads each delay over the upper half of its window', () => {
    expect(reconnectDelay(3, () => 0)).toBe(2000);
    expect(reconnectDelay(3, () => 0.5)).toBe(3000);
    for (let failures = 0; failures < 40; failures += 1) {
      const delay = reconnectDelay(failures);
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(RECONNECT_MAX_MS);
    }
  });

  it('reports offline after repeated failures or when the browser is offline', () => {
    expect(stateAfterFailures(1, true)).toBe('reconnecting');
    expect(stateAfterFailures(OFFLINE_AFTER_FAILURES - 1, true)).toBe('reconnecting');
    expect(stateAfterFailures(OFFLINE_AFTER_FAILURES, true)).toBe('offline');
    expect(stateAfterFailures(1, false)).toBe('offline');
  });
});

describe('job merge', () => {
  it('ignores a payload older than the stored revision', () => {
    const stored = [job('a', 5)];
    expect(mergeJob(stored, job('a', 4, 'queued'))).toBe(stored);
    expect(mergeJob(stored, job('a', 5, 'completed'))[0].status).toBe('completed');
    expect(mergeJob(stored, job('a', 6, 'completed'))[0].rev).toBe(6);
  });

  it('adds an unknown job in creation order and trims to the limit', () => {
    const stored = [job('c', 1, 'completed', 3), job('a', 1, 'completed', 1)];
    const merged = mergeJob(stored, job('b', 0, 'queued', 2));
    expect(merged.map((item) => item.job_id)).toEqual(['c', 'b', 'a']);
    expect(mergeJobs(stored, [job('d', 0, 'queued', 4)], 2).map((item) => item.job_id)).toEqual([
      'd',
      'c',
    ]);
  });

  it('keeps newer socket state when a fetched list arrives', () => {
    const stored = [job('new', 0, 'queued', 9), job('b', 7, 'completed', 2), job('old', 1)];
    const fetched = [job('b', 3, 'processing', 2), job('a', 2, 'completed', 1)];
    const merged = mergeFetchedList(stored, fetched);
    expect(merged.map((item) => [item.job_id, item.rev, item.status])).toEqual([
      ['new', 0, 'queued'],
      ['b', 7, 'completed'],
      ['a', 2, 'completed'],
    ]);
  });

  it('replaces the list when nothing stored is newer', () => {
    const fetched = [job('b', 3, 'completed', 2)];
    expect(mergeFetchedList([job('gone', 9, 'completed', 1)], fetched)).toEqual(fetched);
  });
});

describe('job ownership', () => {
  it("accepts only the signed-in account's jobs", () => {
    expect(belongsTo(job('a', 1), 'user-1')).toBe(true);
    expect(belongsTo(job('a', 1), 'user-2')).toBe(false);
    expect(belongsTo({ user_id: null }, 'user-1')).toBe(false);
    expect(belongsTo(job('a', 1), undefined)).toBe(false);
  });
});

describe('resync after connecting', () => {
  it('merges the active jobs and fetches the ones that ended unseen', () => {
    const known = [job('running', 4), job('ended', 6, 'queued'), job('done', 9, 'completed')];
    const plan = planResync(known, [job('running', 7), job('fresh', 0, 'queued')]);
    expect(plan.merge.map((item) => item.job_id)).toEqual(['running', 'fresh']);
    expect(plan.fetchIds).toEqual(['ended']);
  });

  it('applies the acknowledgement, then each fetched job once', async () => {
    const applied: Job[][] = [];
    const fetchedIds: string[] = [];
    const unresolved = await resyncJobs({
      known: [job('ended', 6), job('lost', 2)],
      subscription: { success: true, jobs: [job('fresh', 0, 'queued')] },
      apply: (jobs) => applied.push(jobs),
      fetchJob: async (jobId) => {
        fetchedIds.push(jobId);
        if (jobId === 'lost') throw new Error('not found');
        return job(jobId, 8, 'completed');
      },
    });
    expect(fetchedIds).toEqual(['ended', 'lost']);
    expect(applied).toEqual([[job('fresh', 0, 'queued')], [job('ended', 8, 'completed')]]);
    expect(unresolved).toEqual(['lost']);
  });

  it('does nothing when the server sent no job snapshot', async () => {
    const applied: Job[][] = [];
    const unresolved = await resyncJobs({
      known: [job('running', 4)],
      subscription: { success: true, jobs: null },
      apply: (jobs) => applied.push(jobs),
      fetchJob: async () => {
        throw new Error('must not fetch');
      },
    });
    expect(applied).toEqual([]);
    expect(unresolved).toEqual([]);
  });
});
