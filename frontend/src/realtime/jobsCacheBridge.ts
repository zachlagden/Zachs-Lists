import type { QueryClient } from '@tanstack/react-query';
import { JOBS_PAGE_SIZE, jobsKeys, type JobsResponse } from '../api/jobs';
import type { Job } from '../types';
import { isStale, mergeJobs } from './jobMerge';

export function cachedJobs(client: QueryClient): Job[] {
  return client.getQueryData<JobsResponse>(jobsKeys.list())?.jobs ?? [];
}

export function applyJobsToCache(client: QueryClient, incoming: Job[]): void {
  if (incoming.length === 0) return;
  client.setQueryData<JobsResponse>(jobsKeys.list(), (current) => {
    if (!current) return current;
    const jobs = mergeJobs(current.jobs, incoming, JOBS_PAGE_SIZE);
    if (jobs === current.jobs) return current;
    const failedUnread = incoming.some((job) => job.status === 'failed' && !job.read);
    return {
      ...current,
      jobs,
      has_unread_failures: current.has_unread_failures || failedUnread,
    };
  });
  for (const job of incoming) {
    client.setQueryData<Job>(jobsKeys.detail(job.job_id), (current) =>
      current && isStale(job, current) ? current : job,
    );
  }
}

export function applyJobToCache(client: QueryClient, job: Job): void {
  applyJobsToCache(client, [job]);
}
