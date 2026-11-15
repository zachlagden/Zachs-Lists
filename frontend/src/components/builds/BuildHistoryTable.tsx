import { Link } from 'react-router-dom';
import {
  attemptSeconds,
  domainChange,
  domainsAfter,
  isUnreadFailure,
  requestedBy,
} from '../../lib/builds';
import { cn } from '../../lib/cn';
import { formatDateTime, formatInteger, formatSignedChange } from '../../lib/format';
import { describeSeconds } from '../../lib/text';
import { isActive } from '../../realtime/jobMerge';
import type { Job } from '../../types';
import { CELL_LINK } from '../ui/linkClasses';
import { JobStatusPill, StatusPill } from '../ui/StatusPill';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui/Table';

function DomainsCell({ jobs, job }: { jobs: Job[]; job: Job }) {
  if (isActive(job)) {
    return <span className="whitespace-nowrap text-text-tertiary">in progress</span>;
  }
  if (job.status === 'failed') {
    return <span className="whitespace-nowrap text-text-tertiary">not published</span>;
  }
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

export interface BuildHistoryTableProps {
  jobs: Job[];
  allJobs: Job[];
  now: Date;
  caption: string;
}

export function BuildHistoryTable({ jobs, allJobs, now, caption }: BuildHistoryTableProps) {
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Started</TableHeaderCell>
          <TableHeaderCell>Result</TableHeaderCell>
          <TableHeaderCell hideOnNarrow>Type</TableHeaderCell>
          <TableHeaderCell align="right">Domains</TableHeaderCell>
          <TableHeaderCell align="right" hideOnNarrow>
            Change
          </TableHeaderCell>
          <TableHeaderCell align="right" hideOnNarrow>
            Took
          </TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {jobs.map((job) => {
          const seconds = attemptSeconds(job, now);
          return (
            <TableRow key={job.job_id}>
              <TableCell>
                <Link
                  to={`/jobs/${encodeURIComponent(job.job_id)}`}
                  className={cn(CELL_LINK, 'whitespace-nowrap')}
                >
                  {formatDateTime(job.created_at, { now })}
                </Link>
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap items-center gap-1.5">
                  <JobStatusPill status={job.status} />
                  {isUnreadFailure(job) ? <StatusPill tone="info">New</StatusPill> : null}
                </span>
              </TableCell>
              <TableCell hideOnNarrow className="text-text-secondary">
                {requestedBy(job, 'owner')}
              </TableCell>
              <TableCell align="right">
                <DomainsCell jobs={allJobs} job={job} />
              </TableCell>
              <TableCell align="right" hideOnNarrow>
                <ChangeCell jobs={allJobs} job={job} />
              </TableCell>
              <TableCell align="right" hideOnNarrow className="whitespace-nowrap">
                {seconds === null ? '' : describeSeconds(seconds)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
