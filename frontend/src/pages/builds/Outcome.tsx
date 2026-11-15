import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { KeyValueList } from '../../components/ui/Layout';
import { formatInteger } from '../../lib/format';
import type { Job } from '../../types';
import { buildSources, type Viewer } from './buildFacts';
import type { BuildFailure } from './failureFacts';
import { largestSources } from './sourceFacts';
import { sentence } from '../../lib/text';

const LARGEST_SOURCES_SHOWN = 5;

export interface LimitRequestOption {
  pending: boolean;
  available: boolean;
  onRequest: () => void;
}

function LimitFigures({ failure, job }: { failure: BuildFailure; job: Job }) {
  if (!failure.limit) return null;
  const largest = largestSources(buildSources(job), LARGEST_SOURCES_SHOWN);
  const items = [
    { label: 'Domains in this build', value: formatInteger(failure.limit.actual) },
    {
      label: 'Domain limit',
      value: failure.limit.max === null ? 'None' : formatInteger(failure.limit.max),
    },
  ];
  if (failure.limit.over !== null) {
    items.push({ label: 'Over the limit by', value: formatInteger(failure.limit.over) });
  }
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-4 narrow:grid-cols-1">
      <KeyValueList items={items} className="content-start" />
      {largest.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-medium text-text-tertiary">
            Largest sources in this build
          </h3>
          <KeyValueList
            items={largest.map((source) => ({
              label: source.name,
              value: `${formatInteger(source.domain_count ?? 0)} domains`,
            }))}
          />
        </div>
      ) : null}
    </div>
  );
}

export interface FailureCardProps {
  job: Job;
  failure: BuildFailure;
  viewer: Viewer;
  limitRequest: LimitRequestOption | null;
}

export function FailureCard({ job, failure, viewer, limitRequest }: FailureCardProps) {
  const owner = viewer === 'owner';
  const steps = owner ? failure.nextSteps : [];
  const canRequest = steps.includes('request-limit') && limitRequest !== null;
  return (
    <Card as="section" aria-labelledby="build-next-steps">
      <CardHeader title="What to do next" titleId="build-next-steps" />
      <CardBody className="grid gap-4">
        <p className="max-w-[70ch] text-text-secondary">{failure.advice}</p>
        <LimitFigures failure={failure} job={job} />
        {canRequest && limitRequest.pending ? (
          <p className="text-[13px] text-text-secondary">
            A request for a higher limit is already waiting for review.
          </p>
        ) : null}
        {steps.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {canRequest && limitRequest.available && !limitRequest.pending ? (
              <Button onClick={limitRequest.onRequest}>Request a higher limit</Button>
            ) : null}
            {steps.includes('build-again') ? (
              <Button to="/dashboard" icon="bolt">
                Build again from the dashboard
              </Button>
            ) : null}
            {steps.includes('edit-sources') ? (
              <Button to="/config" icon="sliders" variant="primary">
                Edit sources
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function CompletionWarnings({ job }: { job: Job }) {
  if (job.status !== 'completed' || !job.result) return null;
  const notes = [...job.result.errors, ...job.result.warnings];
  if (notes.length === 0) return null;
  return (
    <Alert
      tone="warn"
      live={false}
      title={
        notes.length === 1
          ? 'The build completed with one warning'
          : `The build completed with ${notes.length} warnings`
      }
    >
      <ul className="m-0 grid list-none gap-1 p-0">
        {notes.map((note) => (
          <li key={note}>{sentence(note)}</li>
        ))}
      </ul>
    </Alert>
  );
}
