import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { JobStatusPill, StatusPill } from '../../components/ui/StatusPill';
import type { Job } from '../../types';
import { attemptStartedAt } from '../../lib/builds';
import { buildSources, buildSummary } from './buildFacts';
import { LiveDuration } from './Durations';
import { sourceTally } from './sourceFacts';

export function RunningBuild({ job, paused }: { job: Job; paused: boolean }) {
  const summary = buildSummary(job, 'owner');
  const tally = sourceTally(buildSources(job));
  const queued = job.status === 'queued';
  const since = queued ? job.created_at : attemptStartedAt(job);
  return (
    <Card as="section" aria-label="Build in progress">
      <CardBody className="grid gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <JobStatusPill status={job.status} />
          {paused ? (
            <StatusPill tone="warn" icon="offline">
              Updates paused
            </StatusPill>
          ) : null}
          <h2 className="text-base font-semibold">{summary.heading}</h2>
          {since ? (
            <span className="num text-text-secondary">
              {queued ? 'Waiting for ' : 'Elapsed '}
              <LiveDuration since={since} />
            </span>
          ) : null}
          <Button
            to={`/jobs/${encodeURIComponent(job.job_id)}`}
            variant="primary"
            size="sm"
            icon="bolt"
            className="ml-auto"
          >
            View build
          </Button>
        </div>
        <p className="text-text-secondary">
          {[summary.detail, summary.publication].filter(Boolean).join(' ')}
        </p>
        {queued ? null : (
          <ProgressBar
            value={tally.finished}
            max={Math.max(tally.total, 1)}
            label="Sources finished"
            valueText={`${tally.finished} of ${tally.total} sources finished`}
          />
        )}
      </CardBody>
    </Card>
  );
}
