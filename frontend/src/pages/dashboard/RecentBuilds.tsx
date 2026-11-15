import { BuildHistoryTable } from '../../components/builds/BuildHistoryTable';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/States';
import type { Job } from '../../types';
import { RECENT_BUILDS_SHOWN } from './dashboardFacts';

export function RecentBuilds({ jobs, now }: { jobs: Job[]; now: Date }) {
  const recent = jobs.slice(0, RECENT_BUILDS_SHOWN);
  return (
    <Card as="section" aria-labelledby="recent-builds">
      <CardHeader
        title="Recent builds"
        titleId="recent-builds"
        actions={
          <Button to="/jobs" variant="ghost" size="sm">
            All builds
          </Button>
        }
      />
      {recent.length === 0 ? (
        <EmptyState title="No builds yet">
          Builds you start, and the weekly rebuild, are listed here with their results.
        </EmptyState>
      ) : (
        <BuildHistoryTable
          jobs={recent}
          allJobs={jobs}
          now={now}
          caption="Your most recent builds, newest first"
        />
      )}
    </Card>
  );
}
