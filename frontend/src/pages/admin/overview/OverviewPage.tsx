import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { adminJobsQuery, adminStatsQuery } from '../../../api/admin';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { Card, CardHeader } from '../../../components/ui/Card';
import { LoadingRegion, PageHeader, Stack } from '../../../components/ui/Layout';
import { EmptyState, ErrorState } from '../../../components/ui/States';
import { useNow } from '../../../lib/useNow';
import { BuildsTable, BuildsTableSkeleton } from '../builds/BuildsTable';
import { RebuildDefaultLists } from '../shared/RebuildDefaultLists';
import { legacyTabPath } from '../shared/sections';
import { ActivityCharts } from './ActivityCharts';
import { recentFailedBuilds } from './overviewFacts';
import { SystemFigures, SystemFiguresSkeleton } from './SystemFigures';
import { useDocumentMeta } from '../../../hooks/useDocumentMeta';
import { adminTitle } from '../shared/sections';

function FailedBuilds({ now }: { now: Date }) {
  const jobs = useQuery(adminJobsQuery());
  const failed = jobs.data ? recentFailedBuilds(jobs.data.jobs) : [];
  return (
    <Card as="section" aria-labelledby="admin-failed-builds">
      <CardHeader
        title="Recent failed builds"
        titleId="admin-failed-builds"
        actions={
          <Button to="/admin/builds?status=failed" variant="ghost" size="sm">
            All failed builds
          </Button>
        }
      />
      {jobs.data ? (
        failed.length === 0 ? (
          <EmptyState title="No recent build has failed">
            Failed builds from every account are listed here with the reason.
          </EmptyState>
        ) : (
          <BuildsTable jobs={failed} now={now} caption="Recent failed builds" />
        )
      ) : jobs.isError ? (
        <ErrorState
          title="Builds could not be loaded"
          error={jobs.error}
          onRetry={() => void jobs.refetch()}
          retrying={jobs.isFetching}
        />
      ) : (
        <LoadingRegion label="Loading builds…">
          <BuildsTableSkeleton />
        </LoadingRegion>
      )}
    </Card>
  );
}

export default function OverviewPage() {
  useDocumentMeta(adminTitle('Overview'));
  const location = useLocation();
  const now = useNow();
  const stats = useQuery(adminStatsQuery());
  const legacyPath = legacyTabPath(location.search);

  if (legacyPath) return <Navigate to={legacyPath} replace />;

  return (
    <>
      <PageHeader
        title="Admin"
        description="Accounts, builds and the default lists across the whole site."
        actions={<RebuildDefaultLists />}
      />
      <Stack>
        {stats.data ? (
          <>
            {stats.data.limits.enforce_domain_limit ? null : (
              <Alert tone="info" live={false} title="The domain limit is not enforced">
                Builds over the limit complete with a warning. Accounts over their limit are listed
                under Limits.
              </Alert>
            )}
            <SystemFigures stats={stats.data} />
          </>
        ) : stats.isError ? (
          <Card>
            <ErrorState
              title="System figures could not be loaded"
              headingLevel="h2"
              error={stats.error}
              onRetry={() => void stats.refetch()}
              retrying={stats.isFetching}
            />
          </Card>
        ) : (
          <LoadingRegion label="Loading system figures…">
            <SystemFiguresSkeleton />
          </LoadingRegion>
        )}
        <ActivityCharts now={now} />
        <FailedBuilds now={now} />
      </Stack>
    </>
  );
}
