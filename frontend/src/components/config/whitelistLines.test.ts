import { describe, expect, it } from 'vitest';
import { parseDraft, removeLine, serialiseDraft } from './lineDraft';
import {
  addWhitelistEntry,
  countWhitelistComments,
  describeWhitelistMatch,
  describeWhitelistProblem,
  groupWhitelist,
  hasWhitelistEntry,
  parseWhitelistLine,
  whitelistEntries,
  whitelistKindOf,
} from './whitelistLines';

const WHITELIST = [
  '# Sites that must keep working',
  'login.example.com',
  'status.example.net # the status page',
  '@@payments.example.org',
  '*.assets.example.org',
  '',
  '/^metrics[0-9]+\\.example\\.com$/',
  '',
].join('\n');

describe('reading the whitelist', () => {
  it('tells the four kinds apart the way the worker does', () => {
    expect(whitelistKindOf('example.com')).toBe('exact');
    expect(whitelistKindOf('@@example.com')).toBe('subdomain');
    expect(whitelistKindOf('*.example.com')).toBe('wildcard');
    expect(whitelistKindOf('ad*.example.com')).toBe('wildcard');
    expect(whitelistKindOf('/^ads\\./')).toBe('regex');
    expect(whitelistKindOf('/a*b/')).toBe('regex');
  });

  it('reads the pattern before a # and keeps the note after it', () => {
    expect(parseWhitelistLine('  Example.COM # inline comment ')).toEqual({
      kind: 'entry',
      entryKind: 'exact',
      pattern: 'Example.COM',
      note: 'inline comment',
    });
    expect(parseWhitelistLine('# just a comment')).toEqual({ kind: 'comment' });
    expect(parseWhitelistLine('   ')).toEqual({ kind: 'blank' });
  });

  it('groups entries by kind with their line numbers', () => {
    const groups = groupWhitelist(whitelistEntries(parseDraft(WHITELIST)));
    expect(groups.exact.map((entry) => [entry.lineNumber, entry.pattern])).toEqual([
      [2, 'login.example.com'],
      [3, 'status.example.net'],
    ]);
    expect(groups.subdomain).toHaveLength(1);
    expect(groups.wildcard).toHaveLength(1);
    expect(groups.regex[0].lineNumber).toBe(7);
    expect(countWhitelistComments(parseDraft(WHITELIST))).toBe(1);
  });
});

describe('editing the whitelist', () => {
  it('adds after the last entry of the same kind and moves nothing else', () => {
    const { draft } = addWhitelistEntry(parseDraft(WHITELIST), ' shop.example.com ');
    const before = WHITELIST.split('\n');
    expect(serialiseDraft(draft).split('\n')).toEqual([
      ...before.slice(0, 3),
      'shop.example.com',
      ...before.slice(3),
    ]);
  });

  it('adds at the end when there is no entry of that kind', () => {
    const { draft } = addWhitelistEntry(parseDraft('# header\r\nexample.com\r\n'), '@@example.org');
    expect(serialiseDraft(draft)).toBe('# header\r\nexample.com\r\n@@example.org\r\n');
  });

  it('removes exactly one line', () => {
    const draft = parseDraft(WHITELIST);
    const entry = whitelistEntries(draft).find((item) => item.pattern === '@@payments.example.org');
    const after = serialiseDraft(removeLine(draft, entry?.line.id ?? -1));
    expect(after).toBe(WHITELIST.replace('@@payments.example.org\n', ''));
  });

  it('finds an entry that is already there, ignoring case except in a regex', () => {
    const entries = whitelistEntries(parseDraft(WHITELIST));
    expect(hasWhitelistEntry(entries, 'LOGIN.example.com')).toBe(true);
    expect(hasWhitelistEntry(entries, '@@login.example.com')).toBe(false);
    expect(hasWhitelistEntry(entries, '/^METRICS[0-9]+\\.example\\.com$/')).toBe(false);
  });
});

describe('explaining a pattern', () => {
  it('says that a wildcard does not match the domain itself', () => {
    expect(describeWhitelistMatch('*.example.com')).toBe(
      'Keeps every subdomain of example.com, but not example.com itself.',
    );
    expect(describeWhitelistMatch('@@example.com')).toBe(
      'Keeps example.com and every subdomain of it.',
    );
    expect(describeWhitelistMatch('example.com')).toBe(
      'Keeps example.com only, not its subdomains.',
    );
  });

  it('catches the mistakes that can be seen without the server', () => {
    expect(describeWhitelistProblem('example.com')).toBeNull();
    expect(describeWhitelistProblem('@@example.com')).toBeNull();
    expect(describeWhitelistProblem('ad*.example.com')).toBeNull();
    expect(describeWhitelistProblem('/^ads\\./')).toBeNull();
    expect(describeWhitelistProblem('')).not.toBeNull();
    expect(describeWhitelistProblem('/unclosed')).not.toBeNull();
    expect(describeWhitelistProblem('exa mple.com')).not.toBeNull();
    expect(describeWhitelistProblem('/a#b/')).not.toBeNull();
  });
});
