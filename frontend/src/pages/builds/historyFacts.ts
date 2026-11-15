import { isActive } from '../../realtime/jobMerge';
import type { Job, JobStatus } from '../../types';

export type HistoryFilter = 'all' | 'completed' | 'failed' | 'skipped';

export const HISTORY_FILTERS: ReadonlyArray<{ value: HistoryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
];

export function historyFilterFrom(value: string | null): HistoryFilter {
  return HISTORY_FILTERS.find((option) => option.value === value)?.value ?? 'all';
}

export function finishedBuilds(jobs: Job[], filter: HistoryFilter): Job[] {
  return jobs.filter(
    (job) => !isActive(job) && (filter === 'all' || job.status === (filter as JobStatus)),
  );
}

export function activeBuilds(jobs: Job[]): Job[] {
  return jobs.filter(isActive);
}

export function combineHistory(live: Job[], older: Job[]): Job[] {
  const byId = new Map<string, Job>();
  for (const job of older) byId.set(job.job_id, job);
  for (const job of live) {
    const known = byId.get(job.job_id);
    if (!known || (job.rev ?? 0) >= (known.rev ?? 0)) byId.set(job.job_id, job);
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export const HISTORY_LIMITS = [20, 50, 100] as const;

export function nextHistoryLimit(limit: number, shown: number): number | null {
  if (shown < limit) return null;
  return HISTORY_LIMITS.find((candidate) => candidate > limit) ?? null;
}

export interface HistoryRequest {
  limit: number;
  recentCount: number;
  olderCount: number | null;
  olderIsForThisLimit: boolean;
}

export interface HistoryPaging {
  shown: number;
  loadingOlder: boolean;
  nextLimit: number | null;
  showsEveryBuild: boolean;
}

export function historyPaging(request: HistoryRequest): HistoryPaging {
  const extended = request.limit > HISTORY_LIMITS[0];
  if (extended && !(request.olderIsForThisLimit && request.olderCount !== null)) {
    return {
      shown: Math.max(request.recentCount, request.olderCount ?? 0),
      loadingOlder: true,
      nextLimit: null,
      showsEveryBuild: false,
    };
  }
  const returned = extended ? (request.olderCount ?? 0) : request.recentCount;
  return {
    shown: returned,
    loadingOlder: false,
    nextLimit: nextHistoryLimit(request.limit, returned),
    showsEveryBuild: returned < request.limit,
  };
}

export function legacyBuildPath(search: string): string | null {
  const params = new URLSearchParams(search);
  const jobId = params.get('job') ?? params.get('jobId') ?? params.get('id');
  return jobId ? `/jobs/${encodeURIComponent(jobId)}` : null;
}
