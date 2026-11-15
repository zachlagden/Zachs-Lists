import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ADMIN_CHART_DAYS, jobsPerDayQuery } from '../../../api/admin';
import { adminAnalyticsQuery } from '../../../api/analytics';
import { Card, CardBody, CardHeader } from '../../../components/ui/Card';
import { KeyValueList, LoadingRegion, Skeleton } from '../../../components/ui/Layout';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { EmptyState, ErrorState } from '../../../components/ui/States';
import { formatBytes, formatInteger } from '../../../lib/format';
import { BarChart } from '../shared/BarChart';
import {
  ANALYTICS_SCOPES,
  barSummary,
  buildBars,
  downloadBars,
  fillDays,
  scopedReport,
  type AnalyticsScope,
} from './overviewFacts';

function ChartSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="grid gap-3 p-[18px]">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-3 w-48" />
    </LoadingRegion>
  );
}

function Downloads() {
  const [scope, setScope] = useState<AnalyticsScope>('overall');
  const analytics = useQuery(adminAnalyticsQuery(ADMIN_CHART_DAYS));
  const report = analytics.data ? scopedReport(analytics.data, scope) : null;
  const bars = report ? downloadBars(report.daily) : [];
  return (
    <Card as="section" aria-labelledby="admin-downloads">
      <CardHeader
        title={`Downloads, ${ADMIN_CHART_DAYS} days`}
        titleId="admin-downloads"
        actions={
          <SegmentedControl
            label="Which lists to count"
            options={ANALYTICS_SCOPES}
            value={scope}
            onChange={setScope}
          />
        }
        className="flex-wrap"
      />
      {report ? (
        <CardBody className="grid gap-4">
          {report.totals.requests === 0 ? (
            <EmptyState title="No downloads recorded" compact>
              Downloads appear here once a device fetches a list.
            </EmptyState>
          ) : (
            <BarChart summary={barSummary(bars, 'download')} bars={bars} />
          )}
          <KeyValueList
            items={[
              { label: 'Downloads', value: formatInteger(report.totals.requests) },
              { label: 'Unique visitors', value: formatInteger(report.totals.unique_visitors) },
              { label: 'Data served', value: formatBytes(report.totals.bandwidth_bytes) },
            ]}
          />
        </CardBody>
      ) : analytics.isError ? (
        <ErrorState
          title="Download figures could not be loaded"
          error={analytics.error}
          onRetry={() => void analytics.refetch()}
          retrying={analytics.isFetching}
        />
      ) : (
        <ChartSkeleton label="Loading download figures…" />
      )}
    </Card>
  );
}

function BuildsPerDay({ now }: { now: Date }) {
  const builds = useQuery(jobsPerDayQuery());
  const bars = builds.data
    ? buildBars(fillDays(builds.data.jobs_per_day, now, ADMIN_CHART_DAYS))
    : [];
  const daysWithBuilds = bars.filter((bar) => bar.value > 0).length;
  const total = bars.reduce((sum, bar) => sum + bar.value, 0);
  const failed = bars.reduce((sum, bar) => sum + bar.marked, 0);
  return (
    <Card as="section" aria-labelledby="admin-builds-per-day">
      <CardHeader title={`Builds, ${ADMIN_CHART_DAYS} days`} titleId="admin-builds-per-day" />
      {builds.data ? (
        <CardBody className="grid gap-4">
          {total === 0 ? (
            <EmptyState title="No builds in this period" compact>
              Builds are counted here by the day they were queued.
            </EmptyState>
          ) : (
            <BarChart summary={barSummary(bars, 'build')} bars={bars} />
          )}
          <KeyValueList
            items={[
              { label: 'Builds', value: formatInteger(total) },
              { label: 'Failed', value: formatInteger(failed) },
              { label: 'Days with a build', value: formatInteger(daysWithBuilds) },
            ]}
          />
        </CardBody>
      ) : builds.isError ? (
        <ErrorState
          title="Build figures could not be loaded"
          error={builds.error}
          onRetry={() => void builds.refetch()}
          retrying={builds.isFetching}
        />
      ) : (
        <ChartSkeleton label="Loading build figures…" />
      )}
    </Card>
  );
}

export function ActivityCharts({ now }: { now: Date }) {
  return (
    <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4 compact:grid-cols-[minmax(0,1fr)]">
      <Downloads />
      <BuildsPerDay now={now} />
    </div>
  );
}
