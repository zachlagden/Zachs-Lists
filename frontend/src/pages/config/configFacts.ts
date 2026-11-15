import type { LibraryEntry, UrlMetadataResponse, ValidationResponse } from '../../api/config';
import {
  lineAtReportedNumber,
  parseDraft,
  type LineDraft,
  type LineNumbering,
} from '../../components/config/lineDraft';
import {
  analyseSources,
  type ParsedSource,
  type SourceEntry,
} from '../../components/config/sourceLines';
import { whitelistEntries } from '../../components/config/whitelistLines';
import { sourceOutcome } from '../../components/ui/status';
import { pluralise } from '../../lib/format';
import type { Job } from '../../types';

export const TOKEN_LIFETIME_MS = 9 * 60 * 1000;

export type IssueSeverity = 'error' | 'warning';

export interface LineIssue {
  lineId: number | null;
  raw: string | null;
  severity: IssueSeverity;
  message: string;
}

export interface LocatedIssue {
  severity: IssueSeverity;
  message: string;
  lineNumber: number | null;
}

function issueAt(
  draft: LineDraft,
  reported: number | null,
  numbering: LineNumbering,
  severity: IssueSeverity,
  message: string,
): LineIssue {
  const line = reported === null ? null : lineAtReportedNumber(draft, reported, numbering);
  return { lineId: line?.id ?? null, raw: line?.raw ?? null, severity, message };
}

export function issuesFromValidation(
  draft: LineDraft,
  issues: ValidationResponse['issues'],
): LineIssue[] {
  return issues.map((issue) => issueAt(draft, issue.line, 'python', issue.severity, issue.message));
}

const LINE_PREFIX = /^Line (\d+): ([\s\S]*)$/;

export function issuesFromWhitelistDetails(draft: LineDraft, details: string[]): LineIssue[] {
  return details.map((detail) => {
    const match = LINE_PREFIX.exec(detail);
    return match
      ? issueAt(draft, Number.parseInt(match[1], 10), 'rust', 'error', match[2])
      : issueAt(draft, null, 'rust', 'error', detail);
  });
}

export function locateIssues(draft: LineDraft, issues: readonly LineIssue[]): LocatedIssue[] {
  const located: LocatedIssue[] = [];
  for (const issue of issues) {
    if (issue.lineId === null) {
      located.push({ severity: issue.severity, message: issue.message, lineNumber: null });
      continue;
    }
    const index = draft.lines.findIndex((line) => line.id === issue.lineId);
    if (index === -1 || draft.lines[index].raw !== issue.raw) continue;
    located.push({ severity: issue.severity, message: issue.message, lineNumber: index + 1 });
  }
  return located.sort(
    (a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0) || (a.severity === 'error' ? -1 : 1),
  );
}

export interface SourceCheck {
  text: string;
  at: number;
  issues: LineIssue[];
  hasErrors: boolean;
  checkedCount: number;
  token: string | null;
  revision: number;
}

export function sourceCheckFrom(
  draft: LineDraft,
  text: string,
  response: ValidationResponse,
  at: number,
): SourceCheck {
  return {
    text,
    at,
    issues: issuesFromValidation(draft, response.issues),
    hasErrors: response.has_errors,
    checkedCount: response.validated_count,
    token: response.validation_token,
    revision: response.revision,
  };
}

export function checkIsCurrent(check: SourceCheck | null, text: string): check is SourceCheck {
  return check !== null && check.text === text;
}

export function reusableToken(check: SourceCheck | null, text: string, now: number): string | null {
  if (!checkIsCurrent(check, text) || check.hasErrors) return null;
  return now - check.at < TOKEN_LIFETIME_MS ? check.token : null;
}

export type BuildSourceState = 'failed' | 'stale';

export function lastBuildSourceStates(jobs: Job[]): Map<string, BuildSourceState> {
  const states = new Map<string, BuildSourceState>();
  const job = jobs.find((candidate) => candidate.status === 'completed');
  for (const source of job?.progress.sources ?? []) {
    const outcome = sourceOutcome(source);
    if (outcome === 'failed' || outcome === 'stale') states.set(source.url, outcome);
  }
  return states;
}

export function savedSourceLines(savedText: string): Set<string> {
  return new Set(parseDraft(savedText).lines.map((line) => line.raw.trim()));
}

export type SourceRowState =
  | { kind: 'unsaved' }
  | { kind: 'failed' }
  | { kind: 'stale' }
  | { kind: 'domains'; count: number }
  | { kind: 'unknown' };

export function sourceRowState(
  entry: SourceEntry<ParsedSource>,
  saved: ReadonlySet<string>,
  buildStates: ReadonlyMap<string, BuildSourceState>,
  metadata: UrlMetadataResponse | undefined,
): SourceRowState {
  if (!saved.has(entry.line.raw.trim())) return { kind: 'unsaved' };
  const buildState = buildStates.get(entry.parsed.url);
  if (buildState) return { kind: buildState };
  const count = metadata?.[entry.parsed.url]?.domain_count;
  return typeof count === 'number' ? { kind: 'domains', count } : { kind: 'unknown' };
}

export function metadataUrls(entries: SourceEntry[]): string[] {
  const urls = new Set<string>();
  for (const entry of entries) {
    if (entry.parsed.kind === 'source') urls.add(entry.parsed.url);
  }
  return [...urls].sort();
}

function countByKey(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

function surplus(from: Map<string, number>, against: Map<string, number>): string[] {
  const extra: string[] = [];
  for (const [key, count] of from) {
    for (let left = count - (against.get(key) ?? 0); left > 0; left -= 1) extra.push(key);
  }
  return extra;
}

export interface SourceChanges {
  added: number;
  removed: number;
  changed: number;
  otherLines: boolean;
}

function sourceLineKeys(text: string): string[] {
  return analyseSources(parseDraft(text), [])
    .filter((entry) => entry.parsed.kind === 'source' || entry.parsed.kind === 'unrecognised')
    .map((entry) => entry.line.raw.trim());
}

function firstField(line: string): string {
  return line.split('|')[0].trim();
}

export function sourceChanges(savedText: string, currentText: string): SourceChanges {
  const saved = countByKey(sourceLineKeys(savedText));
  const current = countByKey(sourceLineKeys(currentText));
  const addedLines = surplus(current, saved);
  const removedLines = surplus(saved, current);
  const removedUrls = countByKey(removedLines.map(firstField));
  let changed = 0;
  for (const line of addedLines) {
    const url = firstField(line);
    const left = removedUrls.get(url) ?? 0;
    if (left > 0) {
      removedUrls.set(url, left - 1);
      changed += 1;
    }
  }
  const added = addedLines.length - changed;
  const removed = removedLines.length - changed;
  return {
    added,
    removed,
    changed,
    otherLines: savedText !== currentText && added + removed + changed === 0,
  };
}

export interface WhitelistChanges {
  added: number;
  removed: number;
  otherLines: boolean;
}

function whitelistKeys(text: string): string[] {
  return whitelistEntries(parseDraft(text)).map((entry) => entry.pattern);
}

export function whitelistChanges(savedText: string, currentText: string): WhitelistChanges {
  const saved = countByKey(whitelistKeys(savedText));
  const current = countByKey(whitelistKeys(currentText));
  const added = surplus(current, saved).length;
  const removed = surplus(saved, current).length;
  return { added, removed, otherLines: savedText !== currentText && added + removed === 0 };
}

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function describeChanges(sources: SourceChanges, whitelist: WhitelistChanges): string {
  const sentences: string[] = [];
  const sourceParts: string[] = [];
  if (sources.added > 0) sourceParts.push(`${pluralise(sources.added, 'source')} added`);
  if (sources.removed > 0) {
    sourceParts.push(
      sourceParts.length > 0
        ? `${sources.removed} removed`
        : `${pluralise(sources.removed, 'source')} removed`,
    );
  }
  if (sources.changed > 0) {
    sourceParts.push(
      sourceParts.length > 0
        ? `${sources.changed} changed`
        : `${pluralise(sources.changed, 'source')} changed`,
    );
  }
  if (sourceParts.length > 0) sentences.push(`${joinParts(sourceParts)}.`);
  else if (sources.otherLines) sentences.push('Comments or spacing changed in the sources.');

  const whitelistParts: string[] = [];
  if (whitelist.added > 0) {
    whitelistParts.push(`${pluralise(whitelist.added, 'whitelist line')} added`);
  }
  if (whitelist.removed > 0) {
    whitelistParts.push(
      whitelistParts.length > 0
        ? `${whitelist.removed} removed`
        : `${pluralise(whitelist.removed, 'whitelist line')} removed`,
    );
  }
  if (whitelistParts.length > 0) sentences.push(`${joinParts(whitelistParts)}.`);
  else if (whitelist.otherLines) sentences.push('Comments or spacing changed in the whitelist.');
  return sentences.join(' ');
}

export function describeSourceLimit(count: number, limit: number): string | null {
  if (count < limit) return null;
  return count === limit
    ? `You have ${count} of ${limit} sources, which is your limit. Remove one to add another.`
    : `You have ${count} sources and your limit is ${limit}. Remove ${count - limit} before saving.`;
}

export function filterLibrary(
  entries: readonly LibraryEntry[],
  search: string,
  category: string,
): LibraryEntry[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (category && entry.category !== category) return false;
    const haystack = `${entry.name} ${entry.description} ${entry.url}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
