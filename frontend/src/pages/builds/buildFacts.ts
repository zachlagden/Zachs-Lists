import { durationBetween, formatInteger, pluralise } from '../../lib/format';
import { isActive } from '../../realtime/jobMerge';
import type { FormatProgress, Job, OutputFile, SourceProgress, StageTiming } from '../../types';
import { UNKNOWN_FAILURE_TITLE, buildFailure } from './failureFacts';
import { sourceTally } from './sourceFacts';
import { sentence } from '../../lib/text';
import type { BuildViewer } from '../../lib/builds';

export type BuildPhase =
  | 'queued'
  | 'starting'
  | 'downloading'
  | 'whitelist'
  | 'generation'
  | 'publishing'
  | 'completed'
  | 'failed'
  | 'skipped';

export function buildPhase(job: Pick<Job, 'status' | 'progress'>): BuildPhase {
  if (job.status !== 'processing') return job.status;
  switch (job.progress.stage) {
    case 'downloading':
    case 'whitelist':
    case 'generation':
      return job.progress.stage;
    case 'completed':
      return 'publishing';
    default:
      return 'starting';
  }
}

export function isRunning(phase: BuildPhase): boolean {
  return phase !== 'completed' && phase !== 'failed' && phase !== 'skipped';
}

export function buildSources(job: Pick<Job, 'status' | 'progress'>): SourceProgress[] {
  return job.status === 'queued' ? [] : (job.progress.sources ?? []);
}

export type StepKey = 'download' | 'whitelist' | 'generate' | 'publish';
export type StepState = 'done' | 'current' | 'waiting' | 'stopped';

export interface BuildStep {
  key: StepKey;
  label: string;
  state: StepState;
  startedAt: string | null;
  endedAt: string | null;
}

const STEP_LABELS: Record<StepKey, string> = {
  download: 'Download',
  whitelist: 'Whitelist',
  generate: 'Generate',
  publish: 'Publish',
};

function stageStep(
  key: StepKey,
  timing: StageTiming | null | undefined,
  ended: boolean,
  endedAt: string | null,
): BuildStep {
  const label = STEP_LABELS[key];
  if (!timing) return { key, label, state: 'waiting', startedAt: null, endedAt: null };
  if (timing.completed_at) {
    return {
      key,
      label,
      state: 'done',
      startedAt: timing.started_at,
      endedAt: timing.completed_at,
    };
  }
  return {
    key,
    label,
    state: ended ? 'stopped' : 'current',
    startedAt: timing.started_at,
    endedAt: ended ? endedAt : null,
  };
}

export function buildSteps(job: Job): BuildStep[] {
  const queued = job.status === 'queued';
  const stages = queued ? null : job.progress.stages;
  const ended = !isActive(job);
  const endedAt = job.completed_at ?? null;
  const steps = [
    stageStep('download', stages?.downloading, ended, endedAt),
    stageStep('whitelist', stages?.whitelist, ended, endedAt),
    stageStep('generate', stages?.generation, ended, endedAt),
  ];
  const generated = stages?.generation?.completed_at ?? null;
  let publishState: StepState = 'waiting';
  if (generated) {
    if (job.status === 'completed') publishState = 'done';
    else if (job.status === 'processing') publishState = 'current';
    else publishState = 'stopped';
  }
  steps.push({
    key: 'publish',
    label: STEP_LABELS.publish,
    state: publishState,
    startedAt: generated,
    endedAt: generated && ended ? endedAt : null,
  });
  return steps;
}

export function hasStageProgress(job: Job): boolean {
  return job.status !== 'queued' && Boolean(job.progress.stages?.downloading);
}

export function queueWaitSeconds(job: Job, now: Date): number | null {
  if (job.status === 'queued') return durationBetween(job.created_at, now);
  const started = job.started_at ?? job.attempt_started_at;
  if (!started) return null;
  return durationBetween(job.created_at, started);
}

export type Viewer = BuildViewer;

function publishedLists(viewer: Viewer, capital: boolean): string {
  if (viewer === 'owner') return capital ? 'Your published lists' : 'your published lists';
  return capital ? 'The published lists' : 'the published lists';
}

export interface BuildSummary {
  heading: string;
  detail: string;
  publication: string;
}

function queuedDetail(job: Job): string {
  const queue = job.queue_info;
  if (!queue) return 'This build is waiting for a build worker.';
  const ahead = Math.max(0, queue.position - 1);
  const place =
    ahead === 0
      ? 'This build is next in the queue.'
      : `This build is number ${formatInteger(queue.position)} in the queue, with ${formatInteger(ahead)} ahead of it.`;
  const workers = queue.workers_alive ?? queue.active_workers;
  if (workers === 0) return `${place} No build worker is online, so it starts when one returns.`;
  return `${place} ${pluralise(workers, 'build worker')} online.`;
}

function completedDetail(job: Job): string {
  const result = job.result;
  if (!result) return 'The build finished and the new lists were published.';
  const lists = new Set(result.output_files.map((file) => outputListName(file))).size;
  const from = pluralise(result.sources_processed, 'source');
  const into = lists > 0 ? ` in ${pluralise(lists, 'list')}` : '';
  return `Published ${formatInteger(result.unique_domains)} unique domains${into}, from ${from}.`;
}

export function buildSummary(job: Job, viewer: Viewer): BuildSummary {
  const phase = buildPhase(job);
  const tally = sourceTally(buildSources(job));
  const untilFinished = `${publishedLists(viewer, true)} stay as they are until this build finishes.`;
  const unchanged = `${publishedLists(viewer, true)} were left unchanged.`;
  switch (phase) {
    case 'queued':
      return {
        heading: 'Waiting in the queue',
        detail: queuedDetail(job),
        publication: untilFinished,
      };
    case 'starting':
      return {
        heading: 'Starting the build',
        detail: 'A build worker has picked this build up and is reading the configuration.',
        publication: untilFinished,
      };
    case 'downloading':
      return {
        heading: 'Downloading sources',
        detail: `${formatInteger(tally.finished)} of ${pluralise(tally.total, 'source')} finished.`,
        publication: untilFinished,
      };
    case 'whitelist':
      return {
        heading: 'Applying the whitelist',
        detail: 'Every source is in. Whitelisted domains are being removed.',
        publication: untilFinished,
      };
    case 'generation':
      return {
        heading: 'Writing the list files',
        detail: 'The lists are being written in hosts, plain and adblock formats.',
        publication: untilFinished,
      };
    case 'publishing':
      return {
        heading: 'Publishing',
        detail: `The files are written and are being swapped in for ${publishedLists(viewer, false)}.`,
        publication: untilFinished,
      };
    case 'completed':
      return {
        heading: 'Build completed',
        detail: completedDetail(job),
        publication: `This build replaced ${publishedLists(viewer, false)}.`,
      };
    case 'failed': {
      const failure = buildFailure(job);
      return {
        heading: failure?.title ?? UNKNOWN_FAILURE_TITLE,
        detail: failure?.serverMessage ?? '',
        publication: failure?.statesNothingPublished ? '' : `Nothing was published. ${unchanged}`,
      };
    }
    case 'skipped':
      return {
        heading: 'Build skipped',
        detail: sentence(job.result?.skip_reason) || 'Nothing has changed since the last build.',
        publication: `Nothing needed rebuilding. ${unchanged}`,
      };
  }
}

const OUTPUT_NAME = /^(.*)_(hosts|plain|adblock)\.txt(\.gz)?$/;

export function outputListName(file: Pick<OutputFile, 'name'>): string {
  return OUTPUT_NAME.exec(file.name)?.[1] ?? file.name;
}

export interface OutputList {
  name: string;
  domains: number;
  files: Array<{ format: string; sizeBytes: number }>;
}

export function outputLists(files: OutputFile[]): OutputList[] {
  const lists = new Map<string, OutputList>();
  for (const file of files) {
    const name = outputListName(file);
    const list = lists.get(name) ?? { name, domains: file.domain_count, files: [] };
    list.domains = Math.max(list.domains, file.domain_count);
    list.files.push({ format: file.format, sizeBytes: file.size_bytes });
    lists.set(name, list);
  }
  return [...lists.values()];
}

export function formatRatio(
  format: Pick<FormatProgress, 'domains_written' | 'total_domains'>,
): number {
  if (format.total_domains <= 0) return 0;
  return Math.min(1, format.domains_written / format.total_domains);
}
