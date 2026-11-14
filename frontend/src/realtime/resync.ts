import type { Job } from '../types';
import { isActive } from './jobMerge';

export interface JobsSubscription {
  success?: boolean;
  error?: string;
  jobs?: Job[] | null;
  server_time?: string;
}

export interface ResyncPlan {
  merge: Job[];
  fetchIds: string[];
}

export interface ResyncOptions {
  known: Job[];
  subscription: JobsSubscription;
  apply: (jobs: Job[]) => void;
  fetchJob: (jobId: string) => Promise<Job>;
}

export function planResync(known: Job[], activeOnServer: Job[]): ResyncPlan {
  const activeIds = new Set(activeOnServer.map((job) => job.job_id));
  return {
    merge: activeOnServer,
    fetchIds: known
      .filter((job) => isActive(job) && !activeIds.has(job.job_id))
      .map((job) => job.job_id),
  };
}

export async function resyncJobs({
  known,
  subscription,
  apply,
  fetchJob,
}: ResyncOptions): Promise<string[]> {
  if (!Array.isArray(subscription.jobs)) return [];
  const plan = planResync(known, subscription.jobs);
  if (plan.merge.length > 0) apply(plan.merge);
  const outcomes = await Promise.allSettled(plan.fetchIds.map((jobId) => fetchJob(jobId)));
  const fetched = outcomes.flatMap((outcome) =>
    outcome.status === 'fulfilled' ? [outcome.value] : [],
  );
  if (fetched.length > 0) apply(fetched);
  return plan.fetchIds.filter((_, index) => outcomes[index].status === 'rejected');
}
