import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../../api/config';
import { ApiError } from '../../api/errors';
import { applyViewText, parseDraft, removeLine } from '../../components/config/lineDraft';
import {
  analyseSources,
  isSourceEntry,
  planLibraryAdditions,
} from '../../components/config/sourceLines';
import { applyChange, minimalChange } from '../../components/config/minimalChange';
import { AWKWARD_TEXTS, generatedTexts } from '../../components/config/testTexts';
import {
  buildNowLabel,
  buildRefusalTitle,
  cooldownEndsAt,
  cooldownSecondsLeft,
  describeBuildRefusal,
  describeBuildWait,
  runningBuildId,
} from '../../lib/builds';
import type { Job, SourceProgress } from '../../types';
import {
  describeChanges,
  describeSourceLimit,
  filterLibrary,
  issuesFromValidation,
  issuesFromWhitelistDetails,
  lastBuildSourceStates,
  locateIssues,
  metadataUrls,
  savedSourceLines,
  sourceChanges,
  sourceRowState,
  whitelistChanges,
} from './configFacts';

const CATEGORIES = ['advertising', 'tracking'];
const SAVED = [
  '# sources',
  'https://example.com/a|a|tracking',
  'https://example.com/b|b|tracking',
  'https://example.com/c|c|advertising',
  '',
].join('\n');

describe('issues from a check', () => {
  const draft = parseDraft(SAVED);
  const issues = issuesFromValidation(draft, [
    { severity: 'warning', message: 'Could not reach source', line: 3, url: null },
    { severity: 'error', message: 'Too many sources', line: null, url: null },
    { severity: 'error', message: 'Invalid source category', line: 4, url: null },
  ]);

  it('puts each issue on its line and whole-file issues first', () => {
    expect(locateIssues(draft, issues)).toEqual([
      { severity: 'error', message: 'Too many sources', lineNumber: null },
      { severity: 'warning', message: 'Could not reach source', lineNumber: 3 },
      { severity: 'error', message: 'Invalid source category', lineNumber: 4 },
    ]);
  });

  it('follows a line when lines above it are added or removed', () => {
    const shifted = applyViewText(draft, `# new first line\n${SAVED}`);
    expect(locateIssues(shifted, issues).map((issue) => issue.lineNumber)).toEqual([null, 4, 5]);
    const shorter = removeLine(draft, draft.lines[0].id);
    expect(locateIssues(shorter, issues).map((issue) => issue.lineNumber)).toEqual([null, 2, 3]);
  });

  it('drops an issue once its line is edited or removed', () => {
    const fixed = applyViewText(draft, SAVED.replace('c|c|advertising', 'c|c|tracking'));
    expect(locateIssues(fixed, issues).map((issue) => issue.lineNumber)).toEqual([null, 3]);
    const removed = removeLine(draft, draft.lines[2].id);
    expect(locateIssues(removed, issues).map((issue) => issue.lineNumber)).toEqual([null, 3]);
  });

  it('reads the line numbers in a refused whitelist', () => {
    const whitelist = parseDraft('example.com\r\nbad domain\r\n/[/\r\n');
    const located = locateIssues(
      whitelist,
      issuesFromWhitelistDetails(whitelist, [
        'Line 2: Not a valid domain',
        'Line 3: Invalid regex: unclosed character class',
        '4 more lines have problems',
      ]),
    );
    expect(located).toEqual([
      { severity: 'error', message: '4 more lines have problems', lineNumber: null },
      { severity: 'error', message: 'Not a valid domain', lineNumber: 2 },
      { severity: 'error', message: 'Invalid regex: unclosed character class', lineNumber: 3 },
    ]);
  });
});

describe('what a source row shows', () => {
  const source = (url: string, status: SourceProgress['status'], stale = false) =>
    ({ url, status, stale, cache_hit: false }) as SourceProgress;
  const job = (status: Job['status'], sources: SourceProgress[]) =>
    ({ status, progress: { sources } }) as Job;
  const jobs = [
    job('processing', [source('https://example.com/a', 'failed')]),
    job('failed', [source('https://example.com/a', 'failed')]),
    job('completed', [
      source('https://example.com/a', 'completed'),
      source('https://example.com/b', 'completed', true),
      source('https://example.com/c', 'failed'),
    ]),
    job('completed', [source('https://example.com/a', 'failed')]),
  ];
  const entries = analyseSources(
    parseDraft(`${SAVED}https://example.com/new|new|tracking\n`),
    CATEGORIES,
  ).filter(isSourceEntry);
  const saved = savedSourceLines(SAVED);
  const states = lastBuildSourceStates(jobs);
  const metadata = {
    'https://example.com/a': { domain_count: 1200, cached: true },
    'https://example.com/b': { domain_count: 5, cached: true },
  };

  it('uses the most recent completed build only', () => {
    expect([...states]).toEqual([
      ['https://example.com/b', 'stale'],
      ['https://example.com/c', 'failed'],
    ]);
    expect(lastBuildSourceStates([]).size).toBe(0);
  });

  it('prefers not saved, then the build result, then the domain count', () => {
    expect(entries.map((entry) => sourceRowState(entry, saved, states, metadata))).toEqual([
      { kind: 'domains', count: 1200 },
      { kind: 'stale' },
      { kind: 'failed' },
      { kind: 'unsaved' },
    ]);
    expect(sourceRowState(entries[0], saved, states, undefined)).toEqual({ kind: 'unknown' });
  });

  it('asks for each address once', () => {
    const doubled = analyseSources(
      parseDraft('https://example.com/b|b\nhttps://example.com/a|a\nhttps://example.com/b|c\n'),
      CATEGORIES,
    );
    expect(metadataUrls(doubled)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });
});

describe('the summary of unsaved changes', () => {
  it('counts added, removed and changed sources', () => {
    const current = [
      '# sources',
      'https://example.com/a|renamed|tracking',
      'https://example.com/c|c|advertising',
      'https://example.com/d|d|tracking',
      'https://example.com/e|e|tracking',
      '',
    ].join('\n');
    const changes = sourceChanges(SAVED, current);
    expect(changes).toEqual({ added: 2, removed: 1, changed: 1, otherLines: false });
    expect(describeChanges(changes, whitelistChanges('', ''))).toBe(
      '2 sources added, 1 removed and 1 changed.',
    );
  });

  it('counts one of two identical lines being removed', () => {
    const twice = 'https://example.com/a|a|tracking\nhttps://example.com/a|a|tracking\n';
    expect(sourceChanges(twice, 'https://example.com/a|a|tracking\n')).toMatchObject({
      removed: 1,
      added: 0,
      changed: 0,
    });
  });

  it('says when only comments or spacing changed', () => {
    const changes = sourceChanges(SAVED, SAVED.replace('# sources', '# my sources'));
    expect(changes).toEqual({ added: 0, removed: 0, changed: 0, otherLines: true });
    expect(describeChanges(changes, whitelistChanges('a.example\n', 'a.example\n'))).toBe(
      'Comments or spacing changed in the sources.',
    );
  });

  it('describes both tabs together', () => {
    expect(
      describeChanges(
        sourceChanges(SAVED, SAVED.replace('https://example.com/b|b|tracking\n', '')),
        whitelistChanges('a.example\nb.example\n', 'a.example\nc.example\n# note\n'),
      ),
    ).toBe('1 source removed. 1 whitelist line added and 1 removed.');
  });

  it('finds no change between a text and itself', () => {
    for (const text of [...AWKWARD_TEXTS, ...generatedTexts(100)]) {
      expect(sourceChanges(text, text)).toEqual({
        added: 0,
        removed: 0,
        changed: 0,
        otherLines: false,
      });
      expect(describeChanges(sourceChanges(text, text), whitelistChanges(text, text))).toBe('');
    }
  });
});

describe('limits and refusals', () => {
  it('explains the source limit only when it is reached', () => {
    expect(describeSourceLimit(49, 50)).toBeNull();
    expect(describeSourceLimit(50, 50)).toContain('50 of 50');
    expect(describeSourceLimit(53, 50)).toContain('Remove 3');
  });

  it('points at the running build when one is active', () => {
    const error = new ApiError({
      kind: 'http',
      status: 409,
      message: 'A build is already in progress',
      body: { error: 'A build is already in progress', code: 'build_active', job_id: 'job-1' },
    });
    expect(describeBuildRefusal(error)).toBe(
      'A build is already running, so a new one was not started.',
    );
    expect(runningBuildId(error)).toBe('job-1');
  });

  it('gives the time left in a cooldown', () => {
    const error = new ApiError({
      kind: 'http',
      status: 429,
      message: 'Please wait',
      body: { error: 'Please wait', code: 'cooldown', cooldown_remaining: 125 },
    });
    expect(describeBuildRefusal(error)).toContain('2 min 5 s');
    expect(runningBuildId(error)).toBeNull();
  });

  it('says the changes were saved when a cooldown stops the build after a save', () => {
    const cooldown = new ApiError({
      kind: 'http',
      status: 429,
      message: 'Please wait',
      body: { error: 'Please wait', code: 'cooldown', cooldown_remaining: 125 },
    });
    const active = new ApiError({
      kind: 'http',
      status: 409,
      message: 'A build is already in progress',
      body: { error: 'A build is already in progress', code: 'build_active' },
    });
    expect(buildRefusalTitle(cooldown, true)).toBe(
      'Your changes were saved, but the build could not start yet',
    );
    expect(buildRefusalTitle(cooldown, false)).toBe('The build could not start yet');
    expect(buildRefusalTitle(active, true)).toBe('Saved, but the build was not started');
    expect(buildRefusalTitle(active, false)).toBe('The build was not started');
  });

  it('knows when a cooldown ends and counts down to it', () => {
    const refusedAt = Date.parse('2026-11-15T12:00:00Z');
    const cooldown = new ApiError({
      kind: 'http',
      status: 429,
      message: 'Please wait',
      body: { error: 'Please wait', code: 'cooldown', cooldown_remaining: 125 },
    });
    const weeklyLimit = new ApiError({
      kind: 'http',
      status: 429,
      message: 'Weekly manual update limit reached',
      body: { error: 'Weekly manual update limit reached', code: 'weekly_limit' },
    });
    const endsAt = cooldownEndsAt(cooldown, refusedAt);
    expect(endsAt).toBe(refusedAt + 125_000);
    expect(cooldownEndsAt(weeklyLimit, refusedAt)).toBeNull();

    expect(cooldownSecondsLeft(endsAt, refusedAt + 60_500)).toBe(65);
    expect(cooldownSecondsLeft(endsAt, refusedAt + 200_000)).toBe(0);
    expect(cooldownSecondsLeft(null, refusedAt)).toBe(0);

    expect(describeBuildWait(65)).toBe(
      'A build finished recently. You can start another in 1 min 5 s.',
    );
    expect(describeBuildWait(0)).toBeNull();
    expect(buildNowLabel(65)).toBe('Build in 1 min 5 s');
    expect(buildNowLabel(0)).toBe('Build now');
  });
});

describe('the library picker', () => {
  const entry = (id: string, name: string, category: string, url: string): LibraryEntry => ({
    id,
    url,
    name,
    category,
    description: `${name} description`,
    recommended: false,
    aggressiveness: 1,
    domain_count: 10,
    added_by: 'sam',
    created_at: '',
    updated_at: '',
  });
  const library = [
    entry('1', 'Acme Ads', 'advertising', 'https://example.com/ads.txt'),
    entry('2', 'Acme Trackers', 'tracking', 'https://example.com/trackers.txt'),
    entry('3', 'Sample Trackers', 'tracking', 'https://example.org/trackers.txt'),
  ];

  it('filters by every search word and by category', () => {
    expect(filterLibrary(library, '', '').length).toBe(3);
    expect(filterLibrary(library, 'acme TRACK', '').map((item) => item.id)).toEqual(['2']);
    expect(filterLibrary(library, 'example.org', 'tracking').map((item) => item.id)).toEqual(['3']);
    expect(filterLibrary(library, 'acme', 'tracking').map((item) => item.id)).toEqual(['2']);
    expect(filterLibrary(library, 'nothing', '')).toEqual([]);
  });

  it('never adds a duplicate address or a duplicate name', () => {
    const taken = new Set(['acme_ads', 'acme_trackers']);
    const existing = new Set(['https://example.com/trackers.txt']);
    const twice = [
      ...library,
      entry('4', 'Acme ads', 'advertising', 'https://example.net/ads.txt'),
    ];
    const { additions, renamed } = planLibraryAdditions(twice, taken, existing);
    expect(additions.map((addition) => [addition.url, addition.name])).toEqual([
      ['https://example.com/ads.txt', 'acme_ads_2'],
      ['https://example.org/trackers.txt', 'sample_trackers'],
      ['https://example.net/ads.txt', 'acme_ads_3'],
    ]);
    expect(renamed).toEqual([
      { wanted: 'acme_ads', given: 'acme_ads_2' },
      { wanted: 'acme_ads', given: 'acme_ads_3' },
    ]);
  });
});

describe('changes applied to the text editor', () => {
  it('turns one text into the other with a single edit', () => {
    const texts = [...AWKWARD_TEXTS, ...generatedTexts(60)];
    texts.forEach((from, index) => {
      const to = texts[(index + 7) % texts.length];
      expect(applyChange(from, minimalChange(from, to))).toBe(to);
    });
  });

  it('touches only the part that differs', () => {
    expect(minimalChange('one\ntwo\nthree\n', 'one\nTWO\nthree\n')).toEqual({
      from: 4,
      to: 7,
      insert: 'TWO',
    });
    expect(minimalChange('same', 'same')).toBeNull();
    expect(minimalChange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' });
  });
});
