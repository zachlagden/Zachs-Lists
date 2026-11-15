import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { isStale, mergeFetchedList } from '../realtime/jobMerge';
import type { Job, JobStatus } from '../types';
import type { ApiError } from './errors';
import { get, post } from './http';

export const JOBS_PAGE_SIZE = 20;
export const JOBS_HISTORY_MAX = 100;

export interface JobsResponse {
  jobs: Job[];
  has_unread_failures: boolean;
}

export interface BuildStarted {
  job_id: string;
  status: JobStatus;
  remaining_updates: number;
}

export type BuildRefusalCode =
  | 'no_config'
  | 'invalid_config'
  | 'weekly_limit'
  | 'build_active'
  | 'user_not_found'
  | 'cooldown';

export interface BuildRefusalBody {
  error: string;
  code: BuildRefusalCode;
  remaining_updates?: number;
  remaining?: number;
  cooldown_remaining?: number;
  resets_at?: string;
  job_id?: string;
  errors?: string[];
}

export const jobsKeys = {
  all: ['jobs'] as const,
  list: () => [...jobsKeys.all, 'list'] as const,
  detail: (jobId: string) => [...jobsKeys.all, 'detail', jobId] as const,
  history: (limit: number) => [...jobsKeys.all, 'history', limit] as const,
};

export function fetchJobs(limit: number = JOBS_PAGE_SIZE): Promise<JobsResponse> {
  return get<JobsResponse>('/api/user/jobs', { limit });
}

export function fetchJob(jobId: string): Promise<Job> {
  return get<Job>(`/api/user/jobs/${encodeURIComponent(jobId)}`);
}

export function startBuild(): Promise<BuildStarted> {
  return post<BuildStarted>('/api/user/build');
}

export function markFailedJobsRead(): Promise<{ success: boolean }> {
  return post<{ success: boolean }>('/api/user/jobs/mark-read');
}

export function buildRefusal(error: ApiError): BuildRefusalBody | null {
  return typeof error.body.code === 'string' && typeof error.body.error === 'string'
    ? (error.body as unknown as BuildRefusalBody)
    : null;
}

export const jobsQuery = () =>
  queryOptions({
    queryKey: jobsKeys.list(),
    queryFn: async ({ client }): Promise<JobsResponse> => {
      const fetched = await fetchJobs();
      const stored = client.getQueryData<JobsResponse>(jobsKeys.list());
      if (!stored) return fetched;
      return {
        ...fetched,
        jobs: mergeFetchedList(stored.jobs, fetched.jobs).slice(0, JOBS_PAGE_SIZE),
      };
    },
  });

export const jobQuery = (jobId: string) =>
  queryOptions({
    queryKey: jobsKeys.detail(jobId),
    queryFn: async ({ client }): Promise<Job> => {
      const fetched = await fetchJob(jobId);
      const stored = client.getQueryData<Job>(jobsKeys.detail(jobId));
      return stored && isStale(fetched, stored) ? stored : fetched;
    },
  });

export const jobsHistoryQuery = (limit: number) =>
  queryOptions({
    queryKey: jobsKeys.history(limit),
    queryFn: () => fetchJobs(Math.min(limit, JOBS_HISTORY_MAX)),
    placeholderData: keepPreviousData,
  });
