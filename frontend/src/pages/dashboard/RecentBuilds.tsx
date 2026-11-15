import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { JobStatusPill } from '../../components/ui/StatusPill';
import { EmptyState } from '../../components/ui/States';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../components/ui/Table';
import { attemptSeconds, domainChange, domainsAfter } from '../../lib/builds';
import { cn } from '../../lib/cn';
import {
  formatDateTime,
  formatDuration,
  formatInteger,
  formatSignedChange,
} from '../../lib/format';
import { isActive } from '../../realtime/jobMerge';
import type { Job, JobType } from '../../types';
import { RECENT_BUILDS_SHOWN } from './dashboardFacts';

const TYPE_LABELS: Record<JobType, string> = {
  manual: 'Manual',
  scheduled: 'Scheduled',
  admin: 'Started by an admin',
};

function DomainsCell({ jobs, job }: { jobs: Job[]; job: Job }) {
  if (isActive(job))
    return <span className="whitespace-nowrap text-text-tertiary">in progress</span>;
  if (job.status === 'failed')
    return <span className="whitespace-nowrap text-text-tertiary">not published</span>;
  const domains = domainsAfter(jobs, job);
  if (domains === null) return <span className="text-text-tertiary">unchanged</span>;
  return <>{formatInteger(domains)}</>;
}

function ChangeCell({ jobs, job }: { jobs: Job[]; job: Job }) {
  const change = domainChange(jobs, job);
  if (change === null) return null;
  return (
    <span
      className={cn(
        change > 0 && 'text-ok',
        change < 0 && 'text-fail',
        change === 0 && 'text-text-tertiary',
      )}
    >
      {formatSignedChange(change)}
    </span>
  );
}

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
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Started</TableHeaderCell>
              <TableHeaderCell>Result</TableHeaderCell>
              <TableHeaderCell hideOnNarrow>Type</TableHeaderCell>
              <TableHeaderCell align="right">Domains</TableHeaderCell>
              <TableHeaderCell align="right" hideOnNarrow>
                Change
              </TableHeaderCell>
              <TableHeaderCell align="right">Took</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {recent.map((job) => {
              const seconds = attemptSeconds(job, now);
              return (
                <TableRow key={job.job_id}>
                  <TableCell>
                    <Link to="/jobs" className="whitespace-nowrap underline hover:text-accent-text">
                      {formatDateTime(job.created_at, { now })}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <JobStatusPill status={job.status} />
                  </TableCell>
                  <TableCell hideOnNarrow className="text-text-secondary">
                    {TYPE_LABELS[job.type] ?? job.type}
                  </TableCell>
                  <TableCell align="right">
                    <DomainsCell jobs={jobs} job={job} />
                  </TableCell>
                  <TableCell align="right" hideOnNarrow>
                    <ChangeCell jobs={jobs} job={job} />
                  </TableCell>
                  <TableCell align="right" className="whitespace-nowrap">
                    {seconds === null ? '' : formatDuration(seconds)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
