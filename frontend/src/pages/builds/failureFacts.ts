import type { Job } from '../../types';
import { sentence } from '../../lib/text';
import { statesNothingPublished } from '../../lib/builds';

export const ERROR_CODES = [
  'invalid_config',
  'no_sources',
  'all_sources_failed',
  'no_domains',
  'domain_limit_exceeded',
  'worker_abandoned',
  'superseded',
  'target_missing',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type NextStep = 'edit-sources' | 'request-limit' | 'build-again';

interface FailureCopy {
  title: string;
  advice: string;
  nextSteps: NextStep[];
}

const FAILURES: Record<ErrorCode, FailureCopy> = {
  invalid_config: {
    title: 'The configuration could not be used',
    advice: 'Fix the problem on the Configuration page, then build again.',
    nextSteps: ['edit-sources'],
  },
  no_sources: {
    title: 'There were no sources to build from',
    advice: 'Add at least one source on the Configuration page, then build again.',
    nextSteps: ['edit-sources'],
  },
  all_sources_failed: {
    title: 'Every source failed to download',
    advice:
      'Check that the source addresses are still right. If they are, the sources may be down for now, so build again later. A manual build that fails this way is not counted against the weekly allowance.',
    nextSteps: ['edit-sources', 'build-again'],
  },
  no_domains: {
    title: 'The sources contained no domains',
    advice:
      'The downloads worked, but no domains could be read from them. Check that each source is a hosts, plain or adblock list.',
    nextSteps: ['edit-sources'],
  },
  domain_limit_exceeded: {
    title: 'The build is over the domain limit',
    advice: 'Remove some sources, or ask for a higher limit, then build again.',
    nextSteps: ['edit-sources', 'request-limit'],
  },
  worker_abandoned: {
    title: 'The build was abandoned',
    advice:
      'The build worker stopped several times before it could finish. This is a fault on the server, not in the configuration. Build again later. A manual build that fails this way is not counted against the weekly allowance.',
    nextSteps: ['build-again'],
  },
  superseded: {
    title: 'The build was cancelled',
    advice:
      'Another build of the same lists was already active, so this one was cancelled. Nothing needs doing. A manual build cancelled this way is not counted against the weekly allowance.',
    nextSteps: [],
  },
  target_missing: {
    title: 'The account for this build no longer exists',
    advice: 'The build stopped because its account was removed while it was running.',
    nextSteps: [],
  },
  internal: {
    title: 'The build failed because of a server error',
    advice:
      'This is a fault on the server, not in the configuration. Build again later. A manual build that fails this way is not counted against the weekly allowance.',
    nextSteps: ['build-again'],
  },
};

export const UNKNOWN_FAILURE_TITLE = 'The build failed';

const UNKNOWN_FAILURE: FailureCopy = {
  title: UNKNOWN_FAILURE_TITLE,
  advice: 'Build again later. If it keeps failing, check the sources on the Configuration page.',
  nextSteps: ['edit-sources', 'build-again'],
};

export interface BuildFailure {
  code: string | null;
  title: string;
  serverMessage: string;
  statesNothingPublished: boolean;
  advice: string;
  nextSteps: NextStep[];
  limit: { max: number | null; actual: number; over: number | null } | null;
}

function isErrorCode(code: string | null | undefined): code is ErrorCode {
  return ERROR_CODES.includes(code as ErrorCode);
}

export function buildFailure(job: Job): BuildFailure | null {
  if (job.status !== 'failed') return null;
  const code = job.result?.error_code ?? null;
  const copy = isErrorCode(code) ? FAILURES[code] : UNKNOWN_FAILURE;
  const serverMessage = sentence(job.result?.errors[0]);
  const measured = code === 'domain_limit_exceeded' ? (job.result?.limit ?? null) : null;
  return {
    code,
    title: copy.title,
    serverMessage,
    statesNothingPublished: statesNothingPublished(serverMessage),
    advice: copy.advice,
    nextSteps: copy.nextSteps,
    limit: measured
      ? {
          max: measured.max_domains,
          actual: measured.actual_domains,
          over:
            measured.max_domains === null
              ? null
              : Math.max(0, measured.actual_domains - measured.max_domains),
        }
      : null,
  };
}
