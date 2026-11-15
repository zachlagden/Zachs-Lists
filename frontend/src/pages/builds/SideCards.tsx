import { Link } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { KeyValueList, type KeyValueItem } from '../../components/ui/Layout';
import { formatDate, formatDateTime, formatInteger, pluralise } from '../../lib/format';
import type { Job } from '../../types';
import { attemptStartedAt, isDefaultListsBuild, requestedBy } from '../../lib/builds';
import { buildSources, queueWaitSeconds, type Viewer } from './buildFacts';
import { ClockTime, Duration, LiveDuration } from './Durations';
import { sourceTally } from './sourceFacts';
import { describeSeconds } from '../../lib/text';
import { CELL_LINK } from '../../components/ui/linkClasses';
import { cn } from '../../lib/cn';

function Moment({ at }: { at: string }) {
  const today = formatDateTime(at).startsWith('Today');
  return (
    <>
      {today ? '' : `${formatDate(at)}, `}
      <ClockTime at={at} />
    </>
  );
}

function adminItems(job: Job): KeyValueItem[] {
  return [
    {
      label: 'Lists built',
      value: isDefaultListsBuild(job) ? (
        'Default lists'
      ) : (
        <Link to={`/admin/users/${job.user_id}`} className={cn(CELL_LINK, 'justify-end')}>
          {job.username}
        </Link>
      ),
    },
    { label: 'Worker', value: job.worker_id ?? 'None' },
    {
      label: 'Build ID',
      value: (
        <span className="inline-flex flex-wrap items-center justify-end gap-1">
          <span className="font-mono text-xs break-all">{job.job_id}</span>
          <CopyButton text={job.job_id} subject="the build ID" variant="ghost" />
        </span>
      ),
    },
  ];
}

export function ThisBuildCard({ job, viewer }: { job: Job; viewer: Viewer }) {
  const queued = job.status === 'queued';
  const waited = queued ? null : queueWaitSeconds(job, new Date());
  const firstStart = job.started_at ?? null;
  const attemptStart = attemptStartedAt(job);
  const attempts = job.attempts ?? 0;
  const items: KeyValueItem[] = [
    { label: 'Requested', value: requestedBy(job, viewer) },
    { label: 'Queued', value: <Moment at={job.created_at} /> },
  ];
  if (queued) {
    items.push({ label: 'Waiting for', value: <LiveDuration since={job.created_at} /> });
    if (job.queue_info) {
      items.push(
        {
          label: 'Position in queue',
          value: `${formatInteger(job.queue_info.position)} of ${formatInteger(job.queue_info.total_queued)}`,
        },
        {
          label: 'Builds running now',
          value: formatInteger(job.queue_info.jobs_processing),
        },
        {
          label: 'Workers online',
          value: formatInteger(job.queue_info.workers_alive ?? job.queue_info.active_workers),
        },
      );
    }
  } else {
    if (firstStart) items.push({ label: 'Started', value: <Moment at={firstStart} /> });
    if (waited !== null) items.push({ label: 'Waited in queue', value: describeSeconds(waited) });
    if (attempts > 1 && attemptStart) {
      items.push({ label: 'This attempt started', value: <Moment at={attemptStart} /> });
    }
    if (job.completed_at) {
      items.push({ label: 'Finished', value: <Moment at={job.completed_at} /> });
    }
  }
  if (attempts > 0) items.push({ label: 'Attempt', value: formatInteger(attempts) });
  return (
    <Card as="section" aria-labelledby="this-build">
      <CardHeader title="This build" titleId="this-build" />
      <CardBody>
        <KeyValueList items={viewer === 'admin' ? [...items, ...adminItems(job)] : items} />
      </CardBody>
    </Card>
  );
}

export function FiguresCard({ job }: { job: Job }) {
  const tally = sourceTally(buildSources(job));
  const result = job.status === 'completed' ? job.result : null;
  const whitelist = job.progress.whitelist;
  const started = attemptStartedAt(job);
  const items: KeyValueItem[] = result
    ? [
        { label: 'Unique domains published', value: formatInteger(result.unique_domains) },
        { label: 'Domains read from sources', value: formatInteger(result.total_domains) },
        { label: 'Removed by the whitelist', value: formatInteger(result.whitelisted_removed) },
        { label: 'Sources used', value: formatInteger(result.sources_processed) },
      ]
    : [{ label: 'Domains read', value: formatInteger(tally.domainsRead) }];
  if (!result && whitelist) {
    items.push({
      label: 'Removed by the whitelist',
      value: formatInteger(whitelist.total_removed),
    });
  }
  items.push({ label: 'From cache, unchanged', value: pluralise(tally.cached, 'source') });
  if (tally.stale > 0 || !result) {
    items.push({ label: 'Older copy used', value: pluralise(tally.stale, 'source') });
  }
  if (tally.failed > 0 || !result) {
    items.push({ label: 'Failed', value: pluralise(tally.failed, 'source') });
  }
  if (result && started && job.completed_at) {
    items.push({
      label: 'Time taken',
      value: <Duration since={started} until={job.completed_at} />,
    });
  }
  const categories = result ? Object.entries(result.categories) : [];
  const titleId = 'build-figures';
  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader
        title={result ? 'Result' : job.status === 'failed' ? 'Before it stopped' : 'So far'}
        titleId={titleId}
      />
      <CardBody>
        <KeyValueList items={items} />
        {categories.length > 0 ? (
          <>
            <h3 className="mt-4 mb-2 text-xs font-medium text-text-tertiary">
              Domains in each category
            </h3>
            <KeyValueList
              items={categories.map(([name, count]) => ({
                label: name,
                value: formatInteger(count),
              }))}
            />
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
