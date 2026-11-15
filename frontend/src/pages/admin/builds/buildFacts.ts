import { DEFAULT_LISTS_USERNAME } from '../../../lib/builds';
import { formatInteger } from '../../../lib/format';
import { isActive } from '../../../realtime/jobMerge';
import type { Job, JobStage, JobStatus, JobType } from '../../../types';

export const BUILD_STATUSES: ReadonlyArray<JobStatus> = [
  'queued',
  'processing',
  'completed',
  'failed',
  'skipped',
];

export const BUILD_TYPES: ReadonlyArray<JobType> = ['manual', 'scheduled', 'admin'];

export interface BuildFilters {
  status: JobStatus | 'all';
  type: JobType | 'all';
  search: string;
}

export function ownerLabel(job: Pick<Job, 'username'>): string {
  return job.username === DEFAULT_LISTS_USERNAME ? 'Default lists' : job.username;
}

export function filterBuilds(jobs: Job[], filters: BuildFilters): Job[] {
  const search = filters.search.trim().toLowerCase();
  return jobs.filter(
    (job) =>
      (filters.status === 'all' || job.status === filters.status) &&
      (filters.type === 'all' || job.type === filters.type) &&
      (search === '' || ownerLabel(job).toLowerCase().includes(search)),
  );
}

function activeRank(job: Job): number {
  if (job.status === 'processing') return 0;
  if (job.status === 'queued') return 1;
  return 2;
}

export function activeFirst(jobs: Job[]): Job[] {
  return jobs
    .map((job, index) => ({ job, index }))
    .sort((a, b) => activeRank(a.job) - activeRank(b.job) || a.index - b.index)
    .map(({ job }) => job);
}

const STAGE_LABELS: Record<JobStage, string> = {
  queue: 'Waiting to start',
  downloading: 'Downloading sources',
  whitelist: 'Applying the whitelist',
  generation: 'Writing the lists',
  completed: 'Finishing',
};

export interface ProgressSummary {
  text: string;
  percent: number | null;
}

export function progressSummary(job: Job): ProgressSummary {
  if (job.status === 'queued') {
    const queue = job.queue_info;
    return {
      text: queue
        ? `Position ${formatInteger(queue.position)} of ${formatInteger(queue.total_queued)} in the queue`
        : 'Waiting in the queue',
      percent: null,
    };
  }
  if (job.status === 'processing') {
    const { stage, processed_sources: done, total_sources: total, generation } = job.progress;
    if (stage === 'downloading' && total > 0) {
      return {
        text: `${STAGE_LABELS.downloading}, ${formatInteger(done)} of ${formatInteger(total)}`,
        percent: (done / total) * 100,
      };
    }
    if (stage === 'generation' && generation && generation.files_total > 0) {
      return {
        text: `${STAGE_LABELS.generation}, ${formatInteger(generation.files_completed)} of ${formatInteger(generation.files_total)}`,
        percent: (generation.files_completed / generation.files_total) * 100,
      };
    }
    return { text: STAGE_LABELS[stage] ?? 'Building', percent: null };
  }
  if (job.status === 'failed') {
    return { text: job.result?.errors[0] ?? 'No reason was recorded', percent: null };
  }
  if (job.status === 'skipped') {
    return { text: job.result?.skip_reason ?? 'Nothing to build', percent: null };
  }
  const domains = job.result?.unique_domains;
  return {
    text: typeof domains === 'number' ? `${formatInteger(domains)} domains` : 'Published',
    percent: null,
  };
}

export function countActive(jobs: Job[]): number {
  return jobs.filter(isActive).length;
}
