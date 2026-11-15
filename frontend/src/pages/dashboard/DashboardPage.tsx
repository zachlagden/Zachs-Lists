import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { limitRequestsQuery } from '../../api/account';
import { userAnalyticsQuery } from '../../api/analytics';
import { configQuery } from '../../api/config';
import { toApiError } from '../../api/errors';
import { jobsKeys, jobsQuery, startBuild } from '../../api/jobs';
import { listsKeys, userListsQuery, type UserListsResponse } from '../../api/lists';
import { countSourcesInText } from '../../components/config/sourceLines';
import { BuildNowLabel } from '../../components/builds/BuildWait';
import LimitRequestModal from '../../components/LimitRequestModal';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { LoadingRegion, PageHeader, Stack } from '../../components/ui/Layout';
import { ErrorState } from '../../components/ui/States';
import { useBuildCooldown } from '../../hooks/useBuildCooldown';
import { buildRefusalTitle, describeBuildRefusal } from '../../lib/builds';
import { useNow } from '../../lib/useNow';
import { useAuthStore } from '../../store';
import { openLimitReview } from '../../utils/limitReview';
import { activeJob, publicationState, publishedJob } from './dashboardFacts';
import { Figures, FiguresSkeleton } from './Figures';
import { ListAddress } from './ListAddress';
import { NeedsAttention } from './NeedsAttention';
import { DashboardNotices, OverLimitNotice } from './Notices';
import { PublishedState, PublishedStateSkeleton } from './PublishedState';
import { RecentBuilds } from './RecentBuilds';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';

const HIDDEN_WITH_A_REVIEW: readonly string[] = ['domain_limit_exceeded'];
const NOTHING_HIDDEN: readonly string[] = [];

export default function DashboardPage() {
  useDocumentMeta('Dashboard');
  const user = useAuthStore((state) => state.user);
  const client = useQueryClient();
  const now = useNow();
  const [requestingLimit, setRequestingLimit] = useState(false);

  const lists = useQuery(userListsQuery());
  const jobs = useQuery(jobsQuery());
  const config = useQuery(configQuery());
  const analytics = useQuery(userAnalyticsQuery());
  const limitRequests = useQuery(limitRequestsQuery());
  const cooldown = useBuildCooldown();

  const build = useMutation({
    mutationFn: startBuild,
    onSuccess: (started) => {
      client.setQueryData<UserListsResponse>(listsKeys.mine(), (current) =>
        current ? { ...current, remaining_updates: started.remaining_updates } : current,
      );
      return client.invalidateQueries({ queryKey: jobsKeys.list() });
    },
    onError: (error) => {
      cooldown.noteRefusal(toApiError(error));
      const remaining = toApiError(error).body.remaining_updates;
      if (typeof remaining !== 'number') return;
      client.setQueryData<UserListsResponse>(listsKeys.mine(), (current) =>
        current ? { ...current, remaining_updates: remaining } : current,
      );
    },
  });

  if (!user) return null;

  const jobList = jobs.data?.jobs ?? [];
  const configSourceCount = countSourcesInText(config.data?.config ?? '');
  const review = user.is_admin ? null : openLimitReview(user.limit_review);
  const running = activeJob(jobList);
  const core = lists.data && jobs.data && config.data ? lists.data : null;
  const coreError = lists.error ?? jobs.error ?? config.error;
  const state = core ? publicationState(configSourceCount > 0, core, jobList) : null;
  const outOfBuilds = !user.is_admin && core !== null && core.remaining_updates <= 0;
  const published = core ? publishedJob(jobList, core.generation_id) : null;

  const retryCore = () => {
    void lists.refetch();
    void jobs.refetch();
    void config.refetch();
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your list, its sources and its recent builds."
        actions={
          <>
            <Button to="/config" icon="sliders">
              Edit sources
            </Button>
            {running ? (
              <Button
                to={`/jobs/${encodeURIComponent(running.job_id)}`}
                variant="primary"
                icon="bolt"
              >
                View build
              </Button>
            ) : (
              <Button
                variant="primary"
                icon="bolt"
                loading={build.isPending}
                disabled={!core || state === 'no-config' || outOfBuilds || cooldown.endsAt !== null}
                onClick={() => build.mutate()}
              >
                <BuildNowLabel endsAt={cooldown.endsAt} />
              </Button>
            )}
          </>
        }
      />
      <Stack>
        {build.isError ? (
          <Alert
            tone="warn"
            title={buildRefusalTitle(toApiError(build.error), false)}
            onDismiss={() => build.reset()}
          >
            {describeBuildRefusal(toApiError(build.error), now)}
          </Alert>
        ) : null}
        <DashboardNotices
          hiddenNotificationTypes={review ? HIDDEN_WITH_A_REVIEW : NOTHING_HIDDEN}
        />
        {review && core ? (
          <OverLimitNotice
            review={review}
            enforcing={core.enforce_domain_limit}
            hasPendingRequest={limitRequests.data?.has_pending ?? false}
            canRequest={(limitRequests.data?.available_tiers.length ?? 0) > 0}
            onRequest={() => setRequestingLimit(true)}
          />
        ) : null}
        {core && state ? (
          <>
            <PublishedState
              state={state}
              lists={core}
              jobs={jobList}
              configSourceCount={configSourceCount}
              isAdmin={user.is_admin}
              now={now}
            />
            {state === 'no-config' ? null : (
              <>
                <Figures
                  lists={core}
                  jobs={jobList}
                  review={review}
                  configSourceCount={configSourceCount}
                  isAdmin={user.is_admin}
                  analytics={analytics}
                />
                <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-4 compact:grid-cols-[minmax(0,1fr)]">
                  <ListAddress
                    username={user.username}
                    lists={core.lists}
                    publishedBuild={published}
                  />
                  <NeedsAttention publishedBuild={published} />
                </div>
                <RecentBuilds jobs={jobList} now={now} />
              </>
            )}
          </>
        ) : coreError ? (
          <Card>
            <ErrorState
              title="Your dashboard could not be loaded"
              headingLevel="h2"
              error={coreError}
              onRetry={retryCore}
              retrying={lists.isFetching || jobs.isFetching || config.isFetching}
            />
          </Card>
        ) : (
          <LoadingRegion label="Loading your dashboard…" className="grid gap-4">
            <PublishedStateSkeleton />
            <FiguresSkeleton />
          </LoadingRegion>
        )}
      </Stack>
      {requestingLimit && core && limitRequests.data ? (
        <LimitRequestModal
          isOpen
          onClose={() => setRequestingLimit(false)}
          currentLimit={core.limits.max_domains}
          availableTiers={limitRequests.data.available_tiers}
        />
      ) : null}
    </>
  );
}
