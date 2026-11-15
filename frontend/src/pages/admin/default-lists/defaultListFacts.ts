import type { AlertTone } from '../../../components/ui/Alert';
import { formatInteger, pluralise } from '../../../lib/format';
import type { DefaultSyncRun } from '../../../types';

const SHORT_SHA_LENGTH = 7;

export function countEntries(text: string): number {
  return text.split('\n').filter((line) => {
    const entry = line.trim();
    return entry !== '' && !entry.startsWith('#');
  }).length;
}

export function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}

const REPOSITORY_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;

export function repositoryUrl(repo: string | null | undefined): string | null {
  return repo && REPOSITORY_NAME.test(repo) ? `https://github.com/${repo}` : null;
}

export function commitUrl(
  repo: string | null | undefined,
  sha: string | null | undefined,
): string | null {
  const repository = repositoryUrl(repo);
  return repository && sha && COMMIT_SHA.test(sha) ? `${repository}/commit/${sha}` : null;
}

export interface NumberedLine {
  number: number;
  text: string;
}

export function numberedLines(text: string): NumberedLine[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line, index) => ({ number: index + 1, text: line }));
}

export function matchingLines(lines: NumberedLine[], query: string): NumberedLine[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return lines;
  return lines.filter((line) => line.text.toLowerCase().includes(wanted));
}

export interface SyncOutcomeMessage {
  tone: AlertTone;
  title: string;
  detail: string;
  jobId: string | null;
  canForce: boolean;
}

export function syncOutcomeMessage(run: DefaultSyncRun): SyncOutcomeMessage {
  const outcome = run.sync;
  const build = run.job_id
    ? ' A build of the default lists is queued.'
    : run.build_refusal
      ? ` No build was queued: ${run.build_refusal}`
      : '';
  if (!outcome) {
    return {
      tone: 'warn',
      title: 'The sync did not run',
      detail: 'Try again in a moment.',
      jobId: null,
      canForce: false,
    };
  }
  if (outcome.status === 'failed') {
    return {
      tone: 'fail',
      title: 'The sync failed',
      detail: outcome.error ?? 'The repository could not be read.',
      jobId: null,
      canForce: outcome.can_force,
    };
  }
  const sources =
    outcome.source_count === null ? '' : ` It lists ${pluralise(outcome.source_count, 'source')}.`;
  if (outcome.status === 'updated') {
    return {
      tone: 'ok',
      title: 'The default configuration was updated',
      detail: `The stored sources and whitelist now match the repository.${sources}${build}`,
      jobId: run.job_id,
      canForce: false,
    };
  }
  return {
    tone: 'info',
    title: 'Already up to date',
    detail: `The repository has not changed since the last sync.${sources}${build}`,
    jobId: run.job_id,
    canForce: false,
  };
}

export function lineCountLabel(shown: number, total: number): string {
  return shown === total
    ? pluralise(total, 'line')
    : `${formatInteger(shown)} of ${pluralise(total, 'line')} match`;
}
