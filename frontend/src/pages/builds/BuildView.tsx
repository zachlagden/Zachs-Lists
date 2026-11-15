import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { LoadingRegion, PageHeader, Skeleton, Stack } from '../../components/ui/Layout';
import { JobStatusPill, StatusPill } from '../../components/ui/StatusPill';
import { formatClockTime } from '../../lib/format';
import type { Job } from '../../types';
import {
  buildPhase,
  buildSources,
  buildSummary,
  hasStageProgress,
  isRunning,
  type Viewer,
} from './buildFacts';
import { buildFailure } from './failureFacts';
import { CompletionWarnings, FailureCard, type LimitRequestOption } from './Outcome';
import { OutputCard } from './OutputCard';
import { ProgressCard } from './ProgressCard';
import { FiguresCard, ThisBuildCard } from './SideCards';
import { SourcesTable } from './SourcesTable';
import { WhitelistCard } from './WhitelistCard';

export interface BuildViewProps {
  job: Job;
  viewer: Viewer;
  paused: boolean;
  backTo: string;
  backLabel: string;
  limitRequest?: LimitRequestOption | null;
}

export function BuildView({
  job,
  viewer,
  paused,
  backTo,
  backLabel,
  limitRequest = null,
}: BuildViewProps) {
  const phase = buildPhase(job);
  const running = isRunning(phase);
  const summary = buildSummary(job, viewer);
  const failure = buildFailure(job);
  const sources = buildSources(job);
  const staged = hasStageProgress(job);
  const showPipeline = phase !== 'queued' && phase !== 'skipped' && (running || staged);
  const showSources = running || sources.length > 0;
  return (
    <>
      <PageHeader
        title={summary.heading}
        eyebrow={
          <div className="grid justify-items-start gap-2">
            <Button to={backTo} variant="ghost" size="sm" icon="arrow-left" className="-ml-2.5">
              {backLabel}
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <JobStatusPill status={job.status} />
              {running && paused ? (
                <StatusPill tone="warn" icon="offline">
                  Updates paused
                </StatusPill>
              ) : null}
            </div>
          </div>
        }
        description={
          <>
            {summary.detail ? <span className="block">{summary.detail}</span> : null}
            {summary.publication ? <span className="block">{summary.publication}</span> : null}
            {running && paused && job.updated_at ? (
              <span className="block text-warn">
                Showing the state at {formatClockTime(job.updated_at)}. It catches up when the
                connection returns.
              </span>
            ) : null}
          </>
        }
      />
      <p role="status" className="sr-only">
        {summary.heading}
      </p>
      <Stack>
        {failure ? (
          <FailureCard job={job} failure={failure} viewer={viewer} limitRequest={limitRequest} />
        ) : null}
        <CompletionWarnings job={job} />
        {showPipeline ? <ProgressCard job={job} /> : null}
        <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-start gap-4 compact:grid-cols-[minmax(0,1fr)]">
          {showSources ? (
            <SourcesTable
              sources={sources}
              emptyMessage={
                phase === 'queued'
                  ? 'Sources are listed here with their progress once a build worker starts this build.'
                  : 'Sources are listed here once the build worker has read the configuration.'
              }
            />
          ) : null}
          <Stack
            className={showSources ? 'content-start' : 'col-span-full max-w-[32rem] content-start'}
          >
            <ThisBuildCard job={job} viewer={viewer} />
            {showPipeline ? (
              <>
                <FiguresCard job={job} />
                <WhitelistCard whitelist={job.progress.whitelist} running={running} />
                <OutputCard job={job} viewer={viewer} running={running} />
              </>
            ) : null}
          </Stack>
        </div>
      </Stack>
    </>
  );
}

export function BuildViewSkeleton() {
  return (
    <LoadingRegion label="Loading the build…">
      <div className="mb-[22px] grid gap-2.5">
        <Skeleton className="h-[22px] w-24 rounded-full" />
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Stack>
        <Card>
          <CardBody className="grid gap-3">
            <Skeleton className="h-5 w-56 max-w-full" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardBody>
        </Card>
        <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-4 compact:grid-cols-[minmax(0,1fr)]">
          <Card>
            <CardBody className="grid gap-4">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardBody className="grid gap-3">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-4 w-full" />
              ))}
            </CardBody>
          </Card>
        </div>
      </Stack>
    </LoadingRegion>
  );
}
