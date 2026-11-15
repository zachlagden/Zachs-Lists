import type { Job } from '../types';

export function isActive(job: Job): boolean {
  return job.status === 'queued' || job.status === 'processing';
}

export function belongsTo(job: Pick<Job, 'user_id'>, userId: string | undefined): boolean {
  return userId !== undefined && job.user_id === userId;
}

export function isStale(incoming: Job, stored: Job | null | undefined): boolean {
  return !!stored && (incoming.rev ?? 0) < (stored.rev ?? 0);
}

function newestFirst(a: Job, b: Job): number {
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}

export function mergeJob(jobs: Job[], incoming: Job, limit?: number): Job[] {
  const stored = jobs.find((job) => job.job_id === incoming.job_id);
  if (isStale(incoming, stored)) return jobs;
  const merged = stored
    ? jobs.map((job) => (job.job_id === incoming.job_id ? incoming : job))
    : [incoming, ...jobs].sort(newestFirst);
  return limit === undefined ? merged : merged.slice(0, limit);
}

export function mergeJobs(jobs: Job[], incoming: Job[], limit?: number): Job[] {
  return incoming.reduce((merged, job) => mergeJob(merged, job, limit), jobs);
}

export function mergeFetchedList(stored: Job[], fetched: Job[]): Job[] {
  const storedById = new Map(stored.map((job) => [job.job_id, job]));
  const fetchedIds = new Set(fetched.map((job) => job.job_id));
  const newestFetched = Math.max(-Infinity, ...fetched.map((job) => Date.parse(job.created_at)));
  const current = fetched.map((job) => {
    const known = storedById.get(job.job_id);
    return known && isStale(job, known) ? known : job;
  });
  const createdSinceFetch = stored.filter(
    (job) => !fetchedIds.has(job.job_id) && Date.parse(job.created_at) > newestFetched,
  );
  return [...createdSinceFetch, ...current].sort(newestFirst);
}
