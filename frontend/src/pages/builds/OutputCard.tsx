import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { formatBytes, formatInteger, formatPercent } from '../../lib/format';
import type { FormatProgress, GenerationProgress, Job } from '../../types';
import { formatRatio, outputLists, type Viewer } from './buildFacts';

const FORMAT_LABELS: Record<string, string> = {
  hosts: 'Hosts',
  plain: 'Plain',
  adblock: 'Adblock',
};

type FormatFigures = Pick<
  FormatProgress,
  'format' | 'status' | 'domains_written' | 'total_domains' | 'gz_size'
>;

const PLACEHOLDER_FORMATS: FormatFigures[] = (['hosts', 'plain', 'adblock'] as const).map(
  (format) => ({
    format,
    status: 'pending',
    domains_written: 0,
    total_domains: 0,
    gz_size: null,
  }),
);

function formatState(format: FormatFigures): string {
  const size = format.gz_size === null ? '' : `, ${formatBytes(format.gz_size)} compressed`;
  if (format.status === 'pending') return 'not started';
  if (format.status === 'completed') return `written${size}`;
  return `${formatPercent(formatRatio(format))} written${size}`;
}

function FormatBars({ generation }: { generation: GenerationProgress | null }) {
  const formats: FormatFigures[] = generation?.formats.length
    ? generation.formats
    : PLACEHOLDER_FORMATS;
  return (
    <div className="grid gap-3">
      {formats.map((format) => {
        const label = FORMAT_LABELS[format.format] ?? format.format;
        const state = formatState(format);
        return (
          <div key={format.format}>
            <div className="mb-1.5 flex justify-between gap-3 text-[13px]">
              <span>{label}</span>
              <span className="num text-text-tertiary">{state}</span>
            </div>
            <ProgressBar
              thin
              tone={
                format.status === 'completed' ? 'ok' : format.status === 'pending' ? 'idle' : 'info'
              }
              value={formatRatio(format) * 100}
              label={`${label} files`}
              valueText={state}
            />
          </div>
        );
      })}
    </div>
  );
}

function OutputFiles({ job, viewer }: { job: Job; viewer: Viewer }) {
  const lists = outputLists(job.result?.output_files ?? []);
  return (
    <>
      <ul className="m-0 list-none p-0">
        {lists.map((list) => (
          <li key={list.name} className="border-b border-border py-2 first:pt-0 last:border-b-0">
            <div className="flex items-baseline gap-3 text-[13px]">
              <span className="min-w-0 font-medium break-words">{list.name}</span>
              <span className="num ml-auto flex-none">{formatInteger(list.domains)} domains</span>
            </div>
            <p className="num mt-0.5 text-xs text-text-tertiary">
              {list.files
                .map(
                  (file) =>
                    `${(FORMAT_LABELS[file.format] ?? file.format).toLowerCase()} ${formatBytes(file.sizeBytes)}`,
                )
                .join(' · ')}
            </p>
          </li>
        ))}
      </ul>
      {viewer === 'owner' ? (
        <div className="pt-3">
          <Button to="/lists" size="sm" icon="list">
            View my lists
          </Button>
        </div>
      ) : null}
    </>
  );
}

export interface OutputCardProps {
  job: Job;
  viewer: Viewer;
  running: boolean;
}

export function OutputCard({ job, viewer, running }: OutputCardProps) {
  const generation = job.status === 'queued' ? null : job.progress.generation;
  const published = job.status === 'completed' && (job.result?.output_files.length ?? 0) > 0;
  const state = published
    ? `${formatInteger(job.result?.output_files.length ?? 0)} files`
    : generation
      ? `${formatInteger(generation.files_completed)} of ${formatInteger(generation.files_total)} files`
      : running
        ? 'Waiting'
        : 'Not reached';
  return (
    <Card as="section" aria-labelledby="build-output">
      <CardHeader title="Output" titleId="build-output" actions={state} />
      <CardBody>
        {published ? (
          <OutputFiles job={job} viewer={viewer} />
        ) : !generation && !running ? (
          <p className="text-[13px] text-text-secondary">
            The build ended before any list files were written.
          </p>
        ) : (
          <FormatBars generation={generation} />
        )}
      </CardBody>
    </Card>
  );
}
