import { Link } from 'react-router-dom';
import { JobStatusPill, StatusPill } from '../../components/ui/StatusPill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../components/ui/Table';
import { cn } from '../../lib/cn';
import { formatDateTime, formatInteger, formatSignedChange } from '../../lib/format';
import type { Job } from '../../types';
import { attemptSeconds, domainChange, domainsAfter } from '../../lib/builds';
import { requestedBy } from './buildFacts';
import { isUnreadFailure } from './historyFacts';
import { describeSeconds } from '../../lib/text';

function DomainsCell({ jobs, job }: { jobs: Job[]; job: Job }) {
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

export interface HistoryTableProps {
  jobs: Job[];
  allJobs: Job[];
  now: Date;
}

export function HistoryTable({ jobs, allJobs, now }: HistoryTableProps) {
  return (
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
                  className="inline-flex min-h-6 items-center whitespace-nowrap underline hover:text-accent-text narrow:min-h-11"
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
