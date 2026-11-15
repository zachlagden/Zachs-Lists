import { describe, expect, it } from 'vitest';
import { parseDraft, removeLine, serialiseDraft, type LineDraft } from './lineDraft';
import {
  addSource,
  analyseSources,
  countSources,
  countSourcesInText,
  describeNameProblem,
  describeUrlProblem,
  groupSources,
  isSourceEntry,
  parseSourceLine,
  sourceNameFrom,
  suggestNameFromUrl,
  uniqueSourceName,
  updateSource,
  writtenNames,
} from './sourceLines';
import { AWKWARD_TEXTS, generatedTexts } from './testTexts';

const CATEGORIES = ['advertising', 'comprehensive', 'malicious', 'nsfw', 'suspicious', 'tracking'];

const MIXED = [
  '# My sources',
  '',
  'https://example.com/ads.txt|ads|advertising',
  'https://example.com/wild.txt|wild|tracking|abp',
  '',
  '# Odd ones',
  'https://example.com/two.txt|two_fields',
  'https://example.com/bare.txt',
  'https://example.com/typo.txt|typo|phising',
  'https://example.com/ads.txt|ads_again|advertising',
  'just some words',
  '',
].join('\n');

function linesOf(draft: LineDraft): string[] {
  return serialiseDraft(draft).split('\n');
}

function changedLines(before: string, after: string): string[] {
  const kept = new Set(before.split('\n'));
  return after.split('\n').filter((line) => !kept.has(line));
}

describe('reading one line', () => {
  it('reads the four accepted shapes', () => {
    expect(parseSourceLine('https://example.com/a|alpha|tracking|abp', CATEGORIES)).toMatchObject({
      kind: 'source',
      url: 'https://example.com/a',
      name: 'alpha',
      category: 'tracking',
      abp: true,
      problems: [],
    });
    expect(parseSourceLine(' https://example.com/a | alpha | tracking ', CATEGORIES)).toMatchObject(
      { kind: 'source', name: 'alpha', category: 'tracking', abp: false, problems: [] },
    );
    expect(parseSourceLine('https://example.com/a|alpha', CATEGORIES)).toMatchObject({
      kind: 'source',
      category: null,
      nameIsWritten: true,
      problems: [],
    });
    expect(parseSourceLine('https://lists.example.com/a', CATEGORIES)).toMatchObject({
      kind: 'source',
      name: 'lists_example_com',
      nameIsWritten: false,
      problems: [],
    });
  });

  it('reads comments and blank lines', () => {
    expect(parseSourceLine('   ', CATEGORIES)).toEqual({ kind: 'blank' });
    expect(parseSourceLine('  # note', CATEGORIES)).toEqual({ kind: 'comment', text: '# note' });
    expect(parseSourceLine('#OPTIONAL: https://example.com/a|a|tracking', CATEGORIES).kind).toBe(
      'comment',
    );
  });

  it('says what is wrong with a line it cannot use', () => {
    expect(parseSourceLine('https://example.com/a|alpha|phising', CATEGORIES)).toMatchObject({
      kind: 'source',
      problems: ['unknown-category'],
    });
    expect(parseSourceLine('https://example.com/a|first name|tracking', CATEGORIES)).toMatchObject({
      kind: 'source',
      problems: ['invalid-name'],
    });
    expect(parseSourceLine('just some words', CATEGORIES)).toMatchObject({
      kind: 'unrecognised',
      problems: ['not-a-url'],
    });
    expect(parseSourceLine('https://example.com/a||tracking', CATEGORIES)).toMatchObject({
      kind: 'unrecognised',
      problems: ['empty-field'],
    });
    expect(parseSourceLine('https://example.com/a|b|tracking|ABP', CATEGORIES)).toMatchObject({
      kind: 'unrecognised',
      problems: ['unknown-flag'],
    });
    expect(parseSourceLine('https://example.com/a|b|tracking|abp|x', CATEGORIES)).toMatchObject({
      kind: 'unrecognised',
      problems: ['too-many-fields'],
    });
  });
});

describe('the whole file', () => {
  it('accounts for every line, so nothing in the file is invisible', () => {
    for (const text of [MIXED, ...AWKWARD_TEXTS, ...generatedTexts(200)]) {
      const draft = parseDraft(text);
      const entries = analyseSources(draft, CATEGORIES);
      const { groups, uncategorised, attention } = groupSources(entries, CATEGORIES);
      const shown =
        groups.reduce((sum, group) => sum + group.entries.length, 0) +
        uncategorised.length +
        attention.length;
      const hidden = entries.filter(
        (entry) => entry.parsed.kind === 'comment' || entry.parsed.kind === 'blank',
      ).length;
      expect(shown + hidden).toBe(draft.lines.length);
      expect(shown).toBe(countSources(entries));
    }
  });

  it('keeps sources with no category apart from the lines that need attention', () => {
    const { groups, uncategorised, attention } = groupSources(
      analyseSources(parseDraft(MIXED), CATEGORIES),
      CATEGORIES,
    );
    expect(groups.map((group) => [group.category, group.entries.length])).toEqual([
      ['advertising', 2],
      ['tracking', 1],
    ]);
    expect(uncategorised.map((entry) => entry.line.raw)).toEqual([
      'https://example.com/two.txt|two_fields',
      'https://example.com/bare.txt',
    ]);
    expect(attention.map((entry) => entry.line.raw)).toEqual([
      'https://example.com/typo.txt|typo|phising',
      'just some words',
    ]);
  });

  it('marks the second use of a written name, whatever its case', () => {
    const entries = analyseSources(
      parseDraft('https://example.com/a|Same|tracking\nhttps://example.com/b|same|tracking\n'),
      CATEGORIES,
    ).filter(isSourceEntry);
    expect(entries[0].parsed.problems).toEqual([]);
    expect(entries[1].parsed.problems).toEqual(['duplicate-name']);
  });

  it('counts the lines the server counts as sources', () => {
    expect(countSources(analyseSources(parseDraft(MIXED), CATEGORIES))).toBe(7);
    expect(countSourcesInText(MIXED)).toBe(7);
    expect(countSources(analyseSources(parseDraft('# nothing\n\n'), CATEGORIES))).toBe(0);
  });
});

describe('visual edits', () => {
  it('adds after the last source of the category and moves nothing else', () => {
    const draft = parseDraft(MIXED);
    const { draft: added } = addSource(
      draft,
      { url: 'https://example.org/new.txt', name: 'fresh', category: 'tracking', abp: false },
      CATEGORIES,
    );
    const before = linesOf(draft);
    const after = linesOf(added);
    expect(after).toEqual([
      ...before.slice(0, 4),
      'https://example.org/new.txt|fresh|tracking',
      ...before.slice(4),
    ]);
  });

  it('adds at the end when the category has no source yet', () => {
    const { draft: added, lineId } = addSource(
      parseDraft('# header\nhttps://example.com/a|a|tracking'),
      { url: 'https://example.org/m.txt', name: 'm', category: 'malicious', abp: true },
      CATEGORIES,
    );
    expect(serialiseDraft(added)).toBe(
      '# header\nhttps://example.com/a|a|tracking\nhttps://example.org/m.txt|m|malicious|abp',
    );
    expect(added.lines[2].id).toBe(lineId);
  });

  it('keeps comments and blank lines where they are, in CRLF files too', () => {
    const text = '# top\r\n\r\nhttps://example.com/a|a|tracking\r\n\r\n# bottom\r\n';
    const { draft: added } = addSource(
      parseDraft(text),
      { url: 'https://example.org/b', name: 'b', category: 'tracking', abp: false },
      CATEGORIES,
    );
    expect(serialiseDraft(added)).toBe(
      '# top\r\n\r\nhttps://example.com/a|a|tracking\r\nhttps://example.org/b|b|tracking\r\n\r\n# bottom\r\n',
    );
  });

  it('removes one of two lines that share a URL', () => {
    const draft = parseDraft(MIXED);
    const second = draft.lines.find((line) => line.raw.includes('ads_again'));
    const after = serialiseDraft(removeLine(draft, second?.id ?? -1));
    expect(after).toContain('https://example.com/ads.txt|ads|advertising');
    expect(after).not.toContain('ads_again');
    expect(after.split('\n')).toHaveLength(MIXED.split('\n').length - 1);
  });

  it('rewrites only the edited line', () => {
    const draft = parseDraft(MIXED);
    const bare = draft.lines.find((line) => line.raw === 'https://example.com/bare.txt');
    const edited = updateSource(draft, bare?.id ?? -1, {
      url: 'https://example.com/bare.txt',
      name: 'bare',
      category: 'malicious',
      abp: true,
    });
    expect(changedLines(MIXED, serialiseDraft(edited))).toEqual([
      'https://example.com/bare.txt|bare|malicious|abp',
    ]);
    expect(edited.lines.map((line) => line.id)).toEqual(draft.lines.map((line) => line.id));
  });

  it('keeps the white space around an edited line and its line ending', () => {
    const draft = parseDraft('  https://example.com/a|a|tracking \r\n# note\r\n');
    const edited = updateSource(draft, draft.lines[0].id, {
      url: 'https://example.com/a',
      name: 'renamed',
      category: 'tracking',
      abp: false,
    });
    expect(serialiseDraft(edited)).toBe('  https://example.com/a|renamed|tracking \r\n# note\r\n');
  });

  it('can turn the abp flag on and off', () => {
    const draft = parseDraft('https://example.com/a|a|tracking\n');
    const fields = { url: 'https://example.com/a', name: 'a', category: 'tracking' };
    const on = updateSource(draft, draft.lines[0].id, { ...fields, abp: true });
    expect(serialiseDraft(on)).toBe('https://example.com/a|a|tracking|abp\n');
    const off = updateSource(on, on.lines[0].id, { ...fields, abp: false });
    expect(serialiseDraft(off)).toBe('https://example.com/a|a|tracking\n');
  });
});

describe('names', () => {
  it('never hands out a name that is taken', () => {
    const taken = writtenNames(
      analyseSources(
        parseDraft(
          'https://example.com/a|Acme_Ads|tracking\nhttps://example.com/b|acme_ads_2|tracking',
        ),
        CATEGORIES,
      ),
    );
    expect(uniqueSourceName('acme_ads', taken)).toBe('acme_ads_3');
    expect(uniqueSourceName('other', taken)).toBe('other');
    const long = 'x'.repeat(100);
    const unique = uniqueSourceName(long, new Set([long]));
    expect(unique).toHaveLength(100);
    expect(unique.endsWith('_2')).toBe(true);
  });

  it('leaves the edited line out of the taken names', () => {
    const draft = parseDraft('https://example.com/a|alpha|tracking\n');
    const entries = analyseSources(draft, CATEGORIES);
    expect(writtenNames(entries, draft.lines[0].id).has('alpha')).toBe(false);
  });

  it('makes a valid name from any text', () => {
    expect(sourceNameFrom('Acme Ads (Basic)')).toBe('acme_ads_basic');
    expect(sourceNameFrom('***')).toBe('source');
    expect(describeNameProblem(sourceNameFrom('Ünïcode & more'))).toBeNull();
    expect(suggestNameFromUrl('https://www.lists.example.org/ads/basic.txt')).toBe('lists_basic');
    expect(suggestNameFromUrl('https://example.org/')).toBe('example');
    expect(suggestNameFromUrl('nonsense')).toBe('source');
  });

  it('checks names and addresses the way the server does', () => {
    expect(describeNameProblem('good_name-1')).toBeNull();
    expect(describeNameProblem('bad name')).not.toBeNull();
    expect(describeNameProblem('x'.repeat(101))).not.toBeNull();
    expect(describeUrlProblem('https://example.com/list.txt')).toBeNull();
    expect(describeUrlProblem('ftp://example.com/list.txt')).not.toBeNull();
    expect(describeUrlProblem('https://user:pass@example.com/')).not.toBeNull();
    expect(describeUrlProblem('https://example.com/a#part')).not.toBeNull();
    expect(describeUrlProblem('https://example.com/a b')).not.toBeNull();
    expect(describeUrlProblem('')).not.toBeNull();
  });
});
