import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { adminKeys, fetchAdminJob } from '../../api/admin';
import { toApiError } from '../../api/errors';
import { useJobSocket } from '../../hooks/useSocket';
import { isStale } from '../../realtime/jobMerge';
import type { Job } from '../../types';
import { BuildProblem } from './BuildProblem';
import { BuildView, BuildViewSkeleton } from './BuildView';
import { useUpdatesPaused } from './useBuildPageState';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';
import { adminTitle } from '../admin/shared/sections';
import { buildSummary } from './buildFacts';

function newest(jobId: string, current: Job | undefined, incoming: Job[]): Job | undefined {
  return incoming.reduce<Job | undefined>(
    (latest, candidate) =>
      candidate.job_id === jobId && !isStale(candidate, latest) ? candidate : latest,
    current,
  );
}

export default function AdminBuildPage() {
  const { jobId = '' } = useParams<{ jobId: string }>();
  const client = useQueryClient();
  const paused = useUpdatesPaused();

  const build = useQuery({
    queryKey: adminKeys.job(jobId),
    queryFn: async (): Promise<Job> => {
      const fetched = await fetchAdminJob(jobId);
      return newest(jobId, client.getQueryData<Job>(adminKeys.job(jobId)), [fetched]) ?? fetched;
    },
  });

  const applyMany = useCallback(
    (incoming: Job[]) => {
      client.setQueryData<Job>(adminKeys.job(jobId), (current) => newest(jobId, current, incoming));
    },
    [client, jobId],
  );
  const apply = useCallback((incoming: Job) => applyMany([incoming]), [applyMany]);
  const known = useCallback((): Job[] => {
    const current = client.getQueryData<Job>(adminKeys.job(jobId));
    return current ? [current] : [];
  }, [client, jobId]);
  const refetch = useCallback(() => {
    void client.invalidateQueries({ queryKey: adminKeys.job(jobId) });
  }, [client, jobId]);

  useJobSocket({
    isAdmin: true,
    onJobCreated: apply,
    onJobProgress: apply,
    onJobCompleted: apply,
    onReconnect: refetch,
    knownJobs: known,
    fetchJob: fetchAdminJob,
    onJobsSynced: applyMany,
    onResyncFailed: refetch,
  });

  const notFound = build.isError && toApiError(build.error).status === 404;
  useDocumentMeta(
    adminTitle(
      build.data
        ? buildSummary(build.data, 'admin').heading
        : notFound
          ? 'Build not found'
          : 'Build',
    ),
  );

  if (!build.data) {
    if (build.isError) {
      return (
        <BuildProblem
          notFound={notFound}
          error={build.error}
          onRetry={() => void build.refetch()}
          retrying={build.isFetching}
          backTo="/admin"
          backLabel="Admin"
        />
      );
    }
    return <BuildViewSkeleton />;
  }

  return (
    <BuildView job={build.data} viewer="admin" paused={paused} backTo="/admin" backLabel="Admin" />
  );
}
