import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { limitRequestsQuery } from '../../api/account';
import { toApiError } from '../../api/errors';
import { jobQuery, jobsKeys, type JobsResponse } from '../../api/jobs';
import { userListsQuery } from '../../api/lists';
import LimitRequestModal from '../../components/LimitRequestModal';
import { BuildProblem } from './BuildProblem';
import { BuildView, BuildViewSkeleton } from './BuildView';
import { useMarkFailuresRead, useUpdatesPaused } from './useBuildPageState';
import { isUnreadFailure } from '../../lib/builds';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';
import { buildSummary } from './buildFacts';

export default function BuildPage() {
  const { jobId = '' } = useParams<{ jobId: string }>();
  const client = useQueryClient();
  const paused = useUpdatesPaused();
  const [requestingLimit, setRequestingLimit] = useState(false);

  const build = useQuery({
    ...jobQuery(jobId),
    initialData: () =>
      client.getQueryData<JobsResponse>(jobsKeys.list())?.jobs.find((job) => job.job_id === jobId),
    initialDataUpdatedAt: () => client.getQueryState(jobsKeys.list())?.dataUpdatedAt,
  });
  const job = build.data;
  const overLimit = job?.result?.error_code === 'domain_limit_exceeded';
  const limitRequests = useQuery({ ...limitRequestsQuery(), enabled: overLimit });
  const lists = useQuery({ ...userListsQuery(), enabled: overLimit });

  useMarkFailuresRead(job !== undefined && isUnreadFailure(job), jobId);
  const notFound = build.isError && toApiError(build.error).status === 404;
  useDocumentMeta(
    job ? buildSummary(job, 'owner').heading : notFound ? 'Build not found' : 'Build',
  );

  if (!job) {
    if (build.isError) {
      return (
        <BuildProblem
          notFound={notFound}
          error={build.error}
          onRetry={() => void build.refetch()}
          retrying={build.isFetching}
          backTo="/jobs"
          backLabel="All builds"
        />
      );
    }
    return <BuildViewSkeleton />;
  }

  const tiers = limitRequests.data?.available_tiers ?? [];
  return (
    <>
      <BuildView
        job={job}
        viewer="owner"
        paused={paused}
        backTo="/jobs"
        backLabel="All builds"
        limitRequest={
          overLimit && limitRequests.data
            ? {
                pending: limitRequests.data.has_pending,
                available: tiers.length > 0 && lists.data !== undefined,
                onRequest: () => setRequestingLimit(true),
              }
            : null
        }
      />
      {requestingLimit && lists.data && tiers.length > 0 ? (
        <LimitRequestModal
          isOpen
          onClose={() => setRequestingLimit(false)}
          currentLimit={lists.data.limits.max_domains}
          availableTiers={tiers}
        />
      ) : null}
    </>
  );
}
