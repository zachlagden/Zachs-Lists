import { appendLine, insertLine, type DraftLine, type LineDraft } from './lineDraft';

export type WhitelistKind = 'exact' | 'subdomain' | 'wildcard' | 'regex';

export const WHITELIST_KINDS: readonly WhitelistKind[] = [
  'exact',
  'subdomain',
  'wildcard',
  'regex',
];

export type ParsedWhitelistLine =
  | { kind: 'blank' }
  | { kind: 'comment' }
  | { kind: 'entry'; entryKind: WhitelistKind; pattern: string; note: string | null };

export interface WhitelistEntry {
  line: DraftLine;
  lineNumber: number;
  entryKind: WhitelistKind;
  pattern: string;
  note: string | null;
}

export function whitelistKindOf(pattern: string): WhitelistKind {
  if (pattern.startsWith('/')) return 'regex';
  if (pattern.startsWith('@@')) return 'subdomain';
  if (pattern.includes('*')) return 'wildcard';
  return 'exact';
}

export function parseWhitelistLine(raw: string): ParsedWhitelistLine {
  const hash = raw.indexOf('#');
  const pattern = (hash === -1 ? raw : raw.slice(0, hash)).trim();
  if (!pattern) return raw.trim() ? { kind: 'comment' } : { kind: 'blank' };
  const note = hash === -1 ? null : raw.slice(hash + 1).trim() || null;
  return { kind: 'entry', entryKind: whitelistKindOf(pattern), pattern, note };
}

export function whitelistEntries(draft: LineDraft): WhitelistEntry[] {
  const entries: WhitelistEntry[] = [];
  draft.lines.forEach((line, index) => {
    const parsed = parseWhitelistLine(line.raw);
    if (parsed.kind !== 'entry') return;
    entries.push({
      line,
      lineNumber: index + 1,
      entryKind: parsed.entryKind,
      pattern: parsed.pattern,
      note: parsed.note,
    });
  });
  return entries;
}

export function countWhitelistComments(draft: LineDraft): number {
  return draft.lines.filter((line) => parseWhitelistLine(line.raw).kind === 'comment').length;
}

export function groupWhitelist(entries: WhitelistEntry[]): Record<WhitelistKind, WhitelistEntry[]> {
  const groups: Record<WhitelistKind, WhitelistEntry[]> = {
    exact: [],
    subdomain: [],
    wildcard: [],
    regex: [],
  };
  for (const entry of entries) groups[entry.entryKind].push(entry);
  return groups;
}

function entryKey(pattern: string): string {
  return whitelistKindOf(pattern) === 'regex' ? pattern : pattern.toLowerCase();
}

export function hasWhitelistEntry(entries: WhitelistEntry[], pattern: string): boolean {
  const key = entryKey(pattern.trim());
  return entries.some((entry) => entryKey(entry.pattern) === key);
}

const KIND_LABELS: Record<WhitelistKind, string> = {
  exact: 'Exact domains',
  subdomain: 'Domains with their subdomains',
  wildcard: 'Wildcards',
  regex: 'Regular expressions',
};

export function whitelistKindLabel(kind: WhitelistKind): string {
  return KIND_LABELS[kind];
}

export function describeWhitelistMatch(pattern: string): string {
  const kind = whitelistKindOf(pattern);
  if (kind === 'regex') return 'Keeps every domain this regular expression matches.';
  if (kind === 'subdomain') {
    const domain = pattern.slice(2);
    return `Keeps ${domain} and every subdomain of it.`;
  }
  if (kind === 'wildcard') {
    if (pattern.startsWith('*.') && !pattern.slice(2).includes('*')) {
      const domain = pattern.slice(2);
      return `Keeps every subdomain of ${domain}, but not ${domain} itself.`;
    }
    return 'Keeps every domain that fits the pattern. Each * stands for any run of characters.';
  }
  return `Keeps ${pattern} only, not its subdomains.`;
}

export function describeWhitelistProblem(pattern: string): string | null {
  if (!pattern) return 'Enter a domain or a pattern.';
  if (pattern.includes('#')) {
    return 'A # starts a comment. In a regular expression, write a literal # as \\x23.';
  }
  const kind = whitelistKindOf(pattern);
  if (kind === 'regex') {
    return pattern.length > 2 && pattern.endsWith('/')
      ? null
      : 'A regular expression starts and ends with /, with a pattern between them.';
  }
  const domain = kind === 'subdomain' ? pattern.slice(2) : pattern;
  const allowed = kind === 'wildcard' ? /^[A-Za-z0-9.*-]+$/ : /^[A-Za-z0-9.-]+$/;
  if (!allowed.test(domain)) {
    return 'Use letters, digits, hyphens and dots. Write international names in punycode.';
  }
  return null;
}

export interface AddedWhitelistEntry {
  draft: LineDraft;
  lineId: number;
}

export function addWhitelistEntry(draft: LineDraft, pattern: string): AddedWhitelistEntry {
  const raw = pattern.trim();
  const kind = whitelistKindOf(raw);
  const lineId = draft.nextId;
  const sameKind = whitelistEntries(draft).filter((entry) => entry.entryKind === kind);
  const last = sameKind[sameKind.length - 1];
  return {
    draft: last ? insertLine(draft, last.lineNumber, raw) : appendLine(draft, raw),
    lineId,
  };
}
