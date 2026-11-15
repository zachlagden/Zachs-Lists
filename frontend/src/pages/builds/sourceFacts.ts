import { sourceOutcome, type SourceOutcome } from '../../components/ui/status';
import type { SourceProgress } from '../../types';
import { sourceProblemCause } from '../../lib/builds';
import { sentence } from '../../lib/text';

export interface SourceTally {
  total: number;
  finished: number;
  active: number;
  waiting: number;
  problems: number;
  cached: number;
  stale: number;
  failed: number;
  bytesDownloaded: number;
  domainsRead: number;
}

export function sourceTally(sources: SourceProgress[]): SourceTally {
  const tally: SourceTally = {
    total: sources.length,
    finished: 0,
    active: 0,
    waiting: 0,
    problems: 0,
    cached: 0,
    stale: 0,
    failed: 0,
    bytesDownloaded: 0,
    domainsRead: 0,
  };
  for (const source of sources) {
    const outcome = sourceOutcome(source);
    tally.bytesDownloaded += source.bytes_downloaded ?? 0;
    if (outcome !== 'failed') tally.domainsRead += source.domain_count ?? 0;
    if (outcome === 'pending') tally.waiting += 1;
    else if (outcome === 'downloading' || outcome === 'processing') tally.active += 1;
    else tally.finished += 1;
    if (outcome === 'failed') tally.failed += 1;
    if (outcome === 'stale') tally.stale += 1;
    if (outcome === 'cached') tally.cached += 1;
  }
  tally.problems = tally.failed + tally.stale;
  return tally;
}

const SOURCE_GROUP: Record<SourceOutcome, number> = {
  failed: 0,
  stale: 0,
  downloading: 1,
  processing: 1,
  current: 2,
  cached: 2,
  pending: 3,
};

export function sortSources(sources: SourceProgress[]): SourceProgress[] {
  return sources
    .map((source, index) => ({ source, index, group: SOURCE_GROUP[sourceOutcome(source)] }))
    .sort((a, b) => a.group - b.group || a.index - b.index)
    .map((entry) => entry.source);
}

export interface SourceNote {
  tone: 'fail' | 'warn';
  text: string;
}

export function sourceNote(source: SourceProgress): SourceNote | null {
  const outcome = sourceOutcome(source);
  if (outcome === 'failed') {
    const cause = sourceProblemCause(source.error) || 'The download failed.';
    return {
      tone: 'fail',
      text: `${cause} No usable earlier copy exists, so this source was left out.`,
    };
  }
  if (outcome === 'stale') {
    const cause = sourceProblemCause(source.warnings[0]) || 'The source could not be checked.';
    return { tone: 'warn', text: `${cause} The build used an older copy.` };
  }
  if (source.warnings.length > 0) return { tone: 'warn', text: sentence(source.warnings[0]) };
  return null;
}

const NAME_BREAKS = /(?<=[_\-./])/;

export function nameParts(name: string): string[] {
  return name.split(NAME_BREAKS).filter(Boolean);
}

export function downloadRatio(source: SourceProgress): number | null {
  if (!source.bytes_total || source.bytes_total <= 0) return null;
  return Math.min(1, source.bytes_downloaded / source.bytes_total);
}

export function largestSources(sources: SourceProgress[], count: number): SourceProgress[] {
  return sources
    .filter((source) => (source.domain_count ?? 0) > 0 && source.status !== 'failed')
    .sort((a, b) => (b.domain_count ?? 0) - (a.domain_count ?? 0))
    .slice(0, count);
}
