import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { jobsKeys } from '../api/jobs';
import { listsKeys } from '../api/lists';
import { useJobSocket } from '../hooks/useSocket';
import { refreshSession } from '../session';
import type { Job } from '../types';
import { applyJobToCache, applyJobsToCache, cachedJobs } from './jobsCacheBridge';

export function useJobsLiveSync(userId: string | undefined): void {
  const client = useQueryClient();

  const apply = useCallback((job: Job) => applyJobToCache(client, job), [client]);
  const applyMany = useCallback((jobs: Job[]) => applyJobsToCache(client, jobs), [client]);
  const known = useCallback(() => cachedJobs(client), [client]);

  const handleCompleted = useCallback(
    (job: Job) => {
      applyJobToCache(client, job);
      void client.invalidateQueries({ queryKey: listsKeys.mine() });
      void refreshSession();
    },
    [client],
  );

  const refetchJobs = useCallback(() => {
    void client.invalidateQueries({ queryKey: jobsKeys.all });
  }, [client]);

  useJobSocket({
    userId,
    onJobCreated: apply,
    onJobProgress: apply,
    onJobCompleted: handleCompleted,
    onReconnect: refetchJobs,
    knownJobs: known,
    onJobsSynced: applyMany,
    onResyncFailed: refetchJobs,
  });
}
