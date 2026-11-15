import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { JOBS_PAGE_SIZE, jobsHistoryQuery, jobsQuery } from '../../api/jobs';
import { BuildHistoryTable } from '../../components/builds/BuildHistoryTable';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { LoadingRegion, PageHeader, Skeleton, Stack } from '../../components/ui/Layout';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { EmptyState, ErrorState } from '../../components/ui/States';
import { useNow } from '../../lib/useNow';
import {
  HISTORY_FILTERS,
  activeBuilds,
  combineHistory,
  finishedBuilds,
  historyFilterFrom,
  historyPaging,
  legacyBuildPath,
  type HistoryFilter,
} from './historyFacts';
import { RunningBuild } from './RunningBuild';
import { useMarkFailuresRead, useUpdatesPaused } from './useBuildPageState';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';

const FILTER_PARAM = 'result';

const EMPTY_FILTER_TITLES: Record<HistoryFilter, string> = {
  all: 'No finished builds yet',
  completed: 'No completed builds',
  failed: 'No failed builds',
  skipped: 'No skipped builds',
};

function HistorySkeleton() {
  return (
    <LoadingRegion label="Loading your builds…">
      <Card>
        <CardBody className="grid gap-4">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-6 w-full" />
          ))}
        </CardBody>
      </Card>
    </LoadingRegion>
  );
}

export default function BuildHistoryPage() {
  useDocumentMeta('Builds');
  const location = useLocation();
  const now = useNow();
  const paused = useUpdatesPaused();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = historyFilterFrom(searchParams.get(FILTER_PARAM));
  const setFilter = (next: HistoryFilter) => {
    setSearchParams(next === 'all' ? {} : { [FILTER_PARAM]: next }, { replace: true });
  };
  const [limit, setLimit] = useState<number>(JOBS_PAGE_SIZE);

  const recent = useQuery(jobsQuery());
  const extended = limit > JOBS_PAGE_SIZE;
  const older = useQuery({ ...jobsHistoryQuery(limit), enabled: extended });

  useMarkFailuresRead(recent.data?.has_unread_failures ?? false);

  const legacyPath = legacyBuildPath(location.search);
  if (legacyPath) return <Navigate to={legacyPath} replace />;

  const jobs = recent.data ? combineHistory(recent.data.jobs, older.data?.jobs ?? []) : [];
  const running = activeBuilds(jobs);
  const finished = finishedBuilds(jobs, filter);
  const paging = historyPaging({
    limit,
    recentCount: recent.data?.jobs.length ?? 0,
    olderCount: extended && older.data ? older.data.jobs.length : null,
    olderIsForThisLimit: !older.isPlaceholderData,
  });
  const nextLimit = paging.nextLimit;

  return (
    <>
      <PageHeader
        title="Builds"
        description="Every build of your lists, with what it published and how long it took."
      />
      {recent.data ? (
        jobs.length === 0 ? (
          <Card>
            <EmptyState
              title="No builds yet"
              headingLevel="h2"
              icon="bolt"
              action={
                <Button to="/dashboard" variant="primary">
                  Go to the dashboard
                </Button>
              }
            >
              Start a build from the dashboard once you have added sources. Builds you start, and
              the weekly rebuild, are listed here with their results.
            </EmptyState>
          </Card>
        ) : (
          <Stack>
            {running.map((job) => (
              <RunningBuild key={job.job_id} job={job} paused={paused} />
            ))}
            <Card as="section" aria-labelledby="build-history">
              <CardHeader
                title="Finished builds"
                titleId="build-history"
                className="flex-wrap"
                actions={
                  <SegmentedControl
                    label="Show builds by result"
                    options={HISTORY_FILTERS}
                    value={filter}
                    onChange={setFilter}
                  />
                }
              />
              {finished.length === 0 ? (
                <EmptyState title={EMPTY_FILTER_TITLES[filter]}>
                  {filter === 'all'
                    ? 'The build in progress moves here when it finishes.'
                    : 'None of the builds loaded so far ended this way.'}
                </EmptyState>
              ) : (
                <BuildHistoryTable
                  jobs={finished}
                  allJobs={jobs}
                  now={now}
                  caption="Finished builds, newest first"
                />
              )}
              {older.isError ? (
                <ErrorState
                  title="Older builds could not be loaded"
                  error={older.error}
                  onRetry={() => void older.refetch()}
                  retrying={older.isFetching}
                  className="border-t border-border"
                />
              ) : paging.loadingOlder || nextLimit !== null ? (
                <div className="flex flex-wrap items-center gap-3 border-t border-border px-[18px] py-3">
                  <Button
                    size="sm"
                    loading={paging.loadingOlder}
                    onClick={() => {
                      if (nextLimit !== null) setLimit(nextLimit);
                    }}
                  >
                    Show older builds
                  </Button>
                  <span className="text-[13px] text-text-tertiary">
                    Showing the latest {paging.shown}.
                  </span>
                </div>
              ) : (
                <p className="border-t border-border px-[18px] py-3 text-[13px] text-text-tertiary">
                  {paging.showsEveryBuild
                    ? 'Showing every build. '
                    : `Showing the latest ${paging.shown} builds, which is the most this page lists. `}
                  Finished builds are deleted after 30 days.
                </p>
              )}
            </Card>
          </Stack>
        )
      ) : recent.isError ? (
        <Card>
          <ErrorState
            title="Your builds could not be loaded"
            headingLevel="h2"
            error={recent.error}
            onRetry={() => void recent.refetch()}
            retrying={recent.isFetching}
          />
        </Card>
      ) : (
        <HistorySkeleton />
      )}
    </>
  );
}
