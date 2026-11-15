import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import {
  ADMIN_JOBS_LIMIT,
  ADMIN_STATS_FRESH_MS,
  adminKeys,
  fetchAdminJob,
  type AdminJobsResponse,
} from '../../../api/admin';
import { useJobSocket } from '../../../hooks/useSocket';
import { isStale, mergeJobs } from '../../../realtime/jobMerge';
import type { Job } from '../../../types';
import { createSpacedRunner } from './spacedRunner';

const LIST_KEY = adminKeys.jobList(ADMIN_JOBS_LIMIT);

function cachedAdminJobs(client: QueryClient): Job[] {
  return client.getQueryData<AdminJobsResponse>(LIST_KEY)?.jobs ?? [];
}

export function applyAdminJobsToCache(client: QueryClient, incoming: Job[]): void {
  if (incoming.length === 0) return;
  client.setQueryData<AdminJobsResponse>(LIST_KEY, (current) => {
    if (!current) return current;
    const jobs = mergeJobs(current.jobs, incoming, ADMIN_JOBS_LIMIT);
    return jobs === current.jobs ? current : { jobs };
  });
  for (const job of incoming) {
    client.setQueryData<Job>(adminKeys.job(job.job_id), (current) =>
      current && isStale(job, current) ? current : job,
    );
  }
}

export function useAdminJobsLiveSync(): void {
  const client = useQueryClient();

  const figures = useMemo(
    () =>
      createSpacedRunner(() => {
        void client.invalidateQueries({ queryKey: adminKeys.stats() });
        void client.invalidateQueries({ queryKey: adminKeys.limitReviews() });
        void client.invalidateQueries({ queryKey: adminKeys.userJobs() });
      }, ADMIN_STATS_FRESH_MS),
    [client],
  );

  useEffect(() => figures.cancel, [figures]);

  const apply = useCallback((job: Job) => applyAdminJobsToCache(client, [job]), [client]);
  const applyMany = useCallback((jobs: Job[]) => applyAdminJobsToCache(client, jobs), [client]);
  const known = useCallback(() => cachedAdminJobs(client), [client]);

  const applyAndRefreshFigures = useCallback(
    (job: Job) => {
      applyAdminJobsToCache(client, [job]);
      figures.request();
    },
    [client, figures],
  );

  const refetchJobs = useCallback(() => {
    void client.invalidateQueries({ queryKey: adminKeys.jobs() });
  }, [client]);

  useJobSocket({
    isAdmin: true,
    onJobCreated: applyAndRefreshFigures,
    onJobProgress: apply,
    onJobCompleted: applyAndRefreshFigures,
    onReconnect: refetchJobs,
    knownJobs: known,
    fetchJob: fetchAdminJob,
    onJobsSynced: applyMany,
    onResyncFailed: refetchJobs,
  });
}
