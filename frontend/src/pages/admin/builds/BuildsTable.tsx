import { Link } from 'react-router-dom';
import { ProgressBar } from '../../../components/ui/ProgressBar';
import { JobStatusPill } from '../../../components/ui/StatusPill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui/Table';
import { BUILD_TYPE_LABELS, attemptSeconds } from '../../../lib/builds';
import { formatDateTime } from '../../../lib/format';
import { describeSeconds } from '../../../lib/text';
import type { Job } from '../../../types';
import { ownerLabel, progressSummary } from './buildFacts';
import { CELL_LINK } from '../../../components/ui/linkClasses';
import { cn } from '../../../lib/cn';

function describeTook(job: Job, now: Date): string {
  const seconds = attemptSeconds(job, now);
  return seconds === null ? '' : describeSeconds(seconds);
}

function Progress({ job }: { job: Job }) {
  const summary = progressSummary(job);
  return (
    <div className="grid max-w-[340px] min-w-[150px] gap-1.5">
      <span className="line-clamp-2 break-words text-text-secondary">{summary.text}</span>
      {summary.percent === null ? null : (
        <ProgressBar
          thin
          tone="info"
          value={summary.percent}
          label={`Progress of the build for ${ownerLabel(job)}`}
          valueText={summary.text}
        />
      )}
    </div>
  );
}

export interface BuildsTableProps {
  jobs: Job[];
  now: Date;
  caption: string;
  showOwner?: boolean;
}

export function BuildsTable({ jobs, now, caption, showOwner = true }: BuildsTableProps) {
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Queued</TableHeaderCell>
          {showOwner ? <TableHeaderCell>For</TableHeaderCell> : null}
          <TableHeaderCell>Result</TableHeaderCell>
          <TableHeaderCell hideOnNarrow>Type</TableHeaderCell>
          <TableHeaderCell hideOnNarrow>Progress</TableHeaderCell>
          <TableHeaderCell align="right" hideOnNarrow>
            Took
          </TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.job_id}>
            <TableCell>
              <Link
                to={`/admin/jobs/${encodeURIComponent(job.job_id)}`}
                className={cn(CELL_LINK, 'whitespace-nowrap')}
                aria-label={`Build for ${ownerLabel(job)} queued ${formatDateTime(job.created_at, { now })}`}
              >
                {formatDateTime(job.created_at, { now })}
              </Link>
            </TableCell>
            {showOwner ? (
              <TableCell>
                {job.user_id ? (
                  <Link
                    to={`/admin/users/${encodeURIComponent(job.user_id)}`}
                    className={cn(CELL_LINK, 'break-all')}
                  >
                    {job.username}
                  </Link>
                ) : (
                  ownerLabel(job)
                )}
              </TableCell>
            ) : null}
            <TableCell>
              <JobStatusPill status={job.status} />
            </TableCell>
            <TableCell hideOnNarrow className="whitespace-nowrap text-text-secondary">
              {BUILD_TYPE_LABELS[job.type] ?? job.type}
            </TableCell>
            <TableCell hideOnNarrow className="text-[13px]">
              <Progress job={job} />
            </TableCell>
            <TableCell align="right" hideOnNarrow className="whitespace-nowrap">
              {describeTook(job, now)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function BuildsTableSkeleton() {
  return (
    <div className="grid gap-3 p-[18px]">
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          aria-hidden="true"
          className="block h-5 animate-skeleton rounded-md bg-surface-raised"
        />
      ))}
    </div>
  );
}
