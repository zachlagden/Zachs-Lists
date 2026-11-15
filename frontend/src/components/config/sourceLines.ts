import {
  appendLine,
  insertLine,
  parseDraft,
  replaceLine,
  type DraftLine,
  type LineDraft,
} from './lineDraft';

export const ABP_FLAG = 'abp';
export const MAX_SOURCE_NAME_LENGTH = 100;

const SOURCE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function hasWhitespaceOrControl(text: string): boolean {
  if (/\s/.test(text)) return true;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) < 32) return true;
  }
  return false;
}

export type SourceProblem =
  | 'not-a-url'
  | 'empty-field'
  | 'too-many-fields'
  | 'unknown-flag'
  | 'invalid-name'
  | 'duplicate-name'
  | 'unknown-category';

export interface ParsedSource {
  kind: 'source';
  url: string;
  name: string;
  nameIsWritten: boolean;
  category: string | null;
  abp: boolean;
  problems: SourceProblem[];
}

export interface UnrecognisedLine {
  kind: 'unrecognised';
  text: string;
  problems: SourceProblem[];
}

export type ParsedLine =
  | { kind: 'blank' }
  | { kind: 'comment'; text: string }
  | ParsedSource
  | UnrecognisedLine;

export interface SourceEntry<Parsed extends ParsedLine = ParsedLine> {
  line: DraftLine;
  lineNumber: number;
  parsed: Parsed;
}

export interface SourceFields {
  url: string;
  name: string;
  category: string | null;
  abp: boolean;
}

export function describeUrlProblem(url: string): string | null {
  if (!url) return 'Enter the address of a list.';
  if (hasWhitespaceOrControl(url)) return 'The address cannot contain spaces.';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'This is not a full web address. Start it with https://.';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'The address must start with http:// or https://.';
  }
  if (parsed.username || parsed.password) return 'The address cannot contain a user name.';
  if (parsed.hash) return 'The address cannot contain a # part.';
  if (!parsed.hostname) return 'The address has no host name.';
  return null;
}

export function describeNameProblem(name: string): string | null {
  if (!name) return 'Enter a name.';
  if (name.length > MAX_SOURCE_NAME_LENGTH) {
    return `Use ${MAX_SOURCE_NAME_LENGTH} characters or fewer.`;
  }
  if (!SOURCE_NAME_PATTERN.test(name)) {
    return 'Use only letters, numbers, dashes and underscores.';
  }
  return null;
}

function nameFromHost(url: string): string {
  let host = 'source';
  try {
    host = new URL(url).hostname || 'source';
  } catch {
    host = 'source';
  }
  return host.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function parseSourceLine(raw: string, categories: readonly string[]): ParsedLine {
  const text = raw.trim();
  if (!text) return { kind: 'blank' };
  if (text.startsWith('#')) return { kind: 'comment', text };
  const fields = text.split('|').map((field) => field.trim());
  const structure: SourceProblem[] = [];
  if (fields.length > 4) structure.push('too-many-fields');
  if (fields.some((field) => !field)) structure.push('empty-field');
  if (fields.length === 4 && fields[3] !== ABP_FLAG) structure.push('unknown-flag');
  if (describeUrlProblem(fields[0]) !== null) structure.push('not-a-url');
  if (structure.length > 0) return { kind: 'unrecognised', text, problems: structure };

  const nameIsWritten = fields.length > 1;
  const name = nameIsWritten ? fields[1] : nameFromHost(fields[0]);
  const category = fields.length > 2 ? fields[2] : null;
  const problems: SourceProblem[] = [];
  if (describeNameProblem(name) !== null) problems.push('invalid-name');
  if (category !== null && !categories.includes(category)) problems.push('unknown-category');
  return {
    kind: 'source',
    url: fields[0],
    name,
    nameIsWritten,
    category,
    abp: fields.length === 4,
    problems,
  };
}

export function analyseSources(draft: LineDraft, categories: readonly string[]): SourceEntry[] {
  const writtenNames = new Set<string>();
  return draft.lines.map((line, index) => {
    let parsed = parseSourceLine(line.raw, categories);
    if (parsed.kind === 'source' && parsed.nameIsWritten) {
      const key = parsed.name.toLowerCase();
      if (writtenNames.has(key)) {
        parsed = { ...parsed, problems: [...parsed.problems, 'duplicate-name'] };
      }
      writtenNames.add(key);
    }
    return { line, lineNumber: index + 1, parsed };
  });
}

export function isSourceEntry(entry: SourceEntry): entry is SourceEntry<ParsedSource> {
  return entry.parsed.kind === 'source';
}

function countsAsSource(entry: SourceEntry): boolean {
  return entry.parsed.kind === 'source' || entry.parsed.kind === 'unrecognised';
}

export function countSources(entries: SourceEntry[]): number {
  return entries.filter(countsAsSource).length;
}

export function countSourcesInText(text: string): number {
  return countSources(analyseSources(parseDraft(text), []));
}

export interface SourceGroup {
  category: string;
  entries: SourceEntry<ParsedSource>[];
}

export const UNCATEGORISED_LIST = 'uncategorized';

export interface GroupedSources {
  groups: SourceGroup[];
  uncategorised: SourceEntry<ParsedSource>[];
  attention: SourceEntry<ParsedSource | UnrecognisedLine>[];
}

export function groupSources(
  entries: SourceEntry[],
  categories: readonly string[],
): GroupedSources {
  const byCategory = new Map<string, SourceEntry<ParsedSource>[]>(
    categories.map((category) => [category, []]),
  );
  const uncategorised: GroupedSources['uncategorised'] = [];
  const attention: GroupedSources['attention'] = [];
  for (const entry of entries) {
    const { parsed } = entry;
    if (parsed.kind === 'unrecognised') {
      attention.push(entry as SourceEntry<UnrecognisedLine>);
    } else if (parsed.kind === 'source') {
      const placed =
        parsed.problems.length > 0
          ? null
          : parsed.category === null
            ? uncategorised
            : byCategory.get(parsed.category);
      if (placed) placed.push(entry as SourceEntry<ParsedSource>);
      else attention.push(entry as SourceEntry<ParsedSource>);
    }
  }
  return {
    groups: categories
      .map((category) => ({ category, entries: byCategory.get(category) ?? [] }))
      .filter((group) => group.entries.length > 0),
    uncategorised,
    attention,
  };
}

const PROBLEM_TEXT: Record<SourceProblem, string> = {
  'not-a-url': 'The first field is not a web address starting with http:// or https://.',
  'empty-field': 'A field between the | separators is empty.',
  'too-many-fields': 'The line has more than four fields.',
  'unknown-flag': 'The fourth field can only be abp.',
  'invalid-name': 'The name can only use letters, numbers, dashes and underscores.',
  'duplicate-name': 'Another source already uses this name.',
  'unknown-category': 'The category is not one this site knows.',
};

export function describeProblem(problem: SourceProblem): string {
  return PROBLEM_TEXT[problem];
}

const CATEGORY_LABELS: Record<string, string> = { nsfw: 'NSFW' };

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? `${category.charAt(0).toUpperCase()}${category.slice(1)}`;
}

export function formatSourceLine(fields: SourceFields): string {
  const parts = [fields.url, fields.name];
  if (fields.category !== null) {
    parts.push(fields.category);
    if (fields.abp) parts.push(ABP_FLAG);
  }
  return parts.join('|');
}

export interface AddedSource {
  draft: LineDraft;
  lineId: number;
}

export function addSource(
  draft: LineDraft,
  fields: SourceFields,
  categories: readonly string[],
): AddedSource {
  const raw = formatSourceLine(fields);
  const lineId = draft.nextId;
  let lastOfCategory = -1;
  draft.lines.forEach((line, index) => {
    const parsed = parseSourceLine(line.raw, categories);
    if (parsed.kind === 'source' && parsed.category === fields.category) lastOfCategory = index;
  });
  return {
    draft:
      lastOfCategory === -1 ? appendLine(draft, raw) : insertLine(draft, lastOfCategory + 1, raw),
    lineId,
  };
}

export function updateSource(draft: LineDraft, lineId: number, fields: SourceFields): LineDraft {
  const line = draft.lines.find((candidate) => candidate.id === lineId);
  if (!line) return draft;
  const leading = line.raw.match(/^\s*/)?.[0] ?? '';
  const trailing = line.raw.trim() ? (line.raw.match(/\s*$/)?.[0] ?? '') : '';
  return replaceLine(draft, lineId, `${leading}${formatSourceLine(fields)}${trailing}`);
}

export function writtenNames(entries: SourceEntry[], exceptLineId?: number): Set<string> {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.line.id === exceptLineId) continue;
    if (entry.parsed.kind === 'source' && entry.parsed.nameIsWritten) {
      names.add(entry.parsed.name.toLowerCase());
    }
  }
  return names;
}

export function sourceUrls(entries: SourceEntry[]): Set<string> {
  return new Set(entries.filter(isSourceEntry).map((entry) => entry.parsed.url));
}

export function sourceNameFrom(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_SOURCE_NAME_LENGTH);
  return cleaned || 'source';
}

export function suggestNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').split('.')[0];
    const file = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
    const stem = file.replace(/\.[A-Za-z0-9]+$/, '');
    return sourceNameFrom(stem ? `${host}_${stem}` : host);
  } catch {
    return 'source';
  }
}

export function uniqueSourceName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base.toLowerCase())) return base;
  for (let suffix = 2; ; suffix += 1) {
    const ending = `_${suffix}`;
    const candidate = `${base.slice(0, MAX_SOURCE_NAME_LENGTH - ending.length)}${ending}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export interface LibraryChoice {
  url: string;
  name: string;
  category: string;
}

export interface RenamedSource {
  wanted: string;
  given: string;
}

export interface LibraryAdditions {
  additions: SourceFields[];
  renamed: RenamedSource[];
}

export function planLibraryAdditions(
  choices: readonly LibraryChoice[],
  takenNames: ReadonlySet<string>,
  existingUrls: ReadonlySet<string>,
): LibraryAdditions {
  const names = new Set(takenNames);
  const urls = new Set(existingUrls);
  const additions: SourceFields[] = [];
  const renamed: RenamedSource[] = [];
  for (const choice of choices) {
    if (urls.has(choice.url)) continue;
    urls.add(choice.url);
    const wanted = sourceNameFrom(choice.name);
    const given = uniqueSourceName(wanted, names);
    names.add(given.toLowerCase());
    if (given !== wanted) renamed.push({ wanted, given });
    additions.push({ url: choice.url, name: given, category: choice.category, abp: false });
  }
  return { additions, renamed };
}
