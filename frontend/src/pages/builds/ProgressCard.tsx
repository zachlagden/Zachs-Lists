import { Card, CardBody } from '../../components/ui/Card';
import { Icon } from '../../components/ui/Icon';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../lib/cn';
import { formatBytes, formatInteger, pluralise } from '../../lib/format';
import type { Job } from '../../types';
import { attemptStartedAt } from '../../lib/builds';
import {
  buildSources,
  buildSteps,
  type BuildStep,
  type StepKey,
  type StepState,
} from './buildFacts';
import { ClockTime, Duration } from './Durations';
import { sourceTally, type SourceTally } from './sourceFacts';

const MARKERS: Record<StepState, string> = {
  done: 'bg-ok-soft text-ok',
  current: 'bg-accent-soft text-accent-text',
  waiting: 'bg-surface-raised text-text-tertiary',
  stopped: 'bg-fail-soft text-fail',
};

const STATE_WORDS: Record<StepState, string> = {
  done: 'done',
  current: 'in progress',
  waiting: 'not started',
  stopped: 'stopped',
};

function waitingHint(key: StepKey, job: Job, tally: SourceTally): string {
  switch (key) {
    case 'download':
      return tally.total > 0 ? pluralise(tally.total, 'source') : 'Fetches every source';
    case 'whitelist':
      return 'Removes whitelisted domains';
    case 'generate':
      return 'Hosts, plain and adblock files';
    case 'publish':
      return job.status === 'failed' ? 'Nothing was published' : 'Swaps in when complete';
  }
}

function StepDetail({ step, job, tally }: { step: BuildStep; job: Job; tally: SourceTally }) {
  if (step.state === 'waiting' || !step.startedAt) return <>{waitingHint(step.key, job, tally)}</>;
  if (step.key === 'publish' && step.state === 'done' && step.endedAt) {
    return (
      <>
        Published <ClockTime at={step.endedAt} />
      </>
    );
  }
  const verb =
    step.state === 'done' ? 'took' : step.state === 'stopped' ? 'stopped after' : 'running for';
  return (
    <>
      Started <ClockTime at={step.startedAt} />, {verb}{' '}
      <Duration since={step.startedAt} until={step.endedAt} />
    </>
  );
}

function Stepper({ job, tally }: { job: Job; tally: SourceTally }) {
  const steps = buildSteps(job);
  return (
    <ol className="m-0 grid list-none grid-cols-4 border-t border-border p-0 narrow:grid-cols-2">
      {steps.map((step, index) => (
        <li
          key={step.key}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className={cn(
            'border-r border-border px-[18px] py-3.5 last:border-r-0 narrow:px-3',
            'narrow:[&:nth-child(2)]:border-r-0 narrow:[&:nth-child(-n+2)]:border-b',
          )}
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'inline-grid size-5 flex-none place-items-center rounded-full font-mono text-[11px] font-medium',
                MARKERS[step.state],
              )}
            >
              {step.state === 'done' ? (
                <Icon name="tick" size={12} />
              ) : step.state === 'stopped' ? (
                <Icon name="close" size={12} />
              ) : (
                index + 1
              )}
            </span>
            <span className={cn('font-medium', step.state === 'waiting' && 'text-text-tertiary')}>
              {step.label}
            </span>
            <span className="sr-only">, {STATE_WORDS[step.state]}</span>
          </div>
          <p className="num mt-1 ml-7 text-xs text-text-tertiary">
            <StepDetail step={step} job={job} tally={tally} />
          </p>
        </li>
      ))}
    </ol>
  );
}

export function ProgressCard({ job }: { job: Job }) {
  const tally = sourceTally(buildSources(job));
  const started = attemptStartedAt(job);
  const running = job.status === 'processing';
  return (
    <Card as="section" aria-label="Progress">
      <CardBody className="grid gap-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <b className="num text-base font-semibold">
            {tally.total > 0
              ? `${formatInteger(tally.finished)} of ${pluralise(tally.total, 'source')} finished`
              : 'Reading the configuration'}
          </b>
          {tally.bytesDownloaded > 0 ? (
            <span className="num text-text-secondary">
              {formatBytes(tally.bytesDownloaded)} downloaded
            </span>
          ) : null}
          {started ? (
            <span className="num ml-auto text-text-secondary">
              {running ? 'Elapsed ' : 'Took '}
              <Duration since={started} until={running ? null : (job.completed_at ?? started)} />
            </span>
          ) : null}
        </div>
        <ProgressBar
          value={tally.finished}
          max={Math.max(tally.total, 1)}
          label="Sources finished"
          valueText={`${tally.finished} of ${tally.total} sources finished`}
          tone={running ? 'accent' : job.status === 'completed' ? 'ok' : 'idle'}
        />
      </CardBody>
      <Stepper job={job} tally={tally} />
    </Card>
  );
}
