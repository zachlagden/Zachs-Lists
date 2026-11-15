import { describe, expect, it } from 'vitest';
import {
  durationBetween,
  formatBytes,
  formatClockTime,
  formatDate,
  formatDateTime,
  formatDuration,
  formatInteger,
  formatPercent,
  formatRelativeTime,
  formatRoundedCount,
  formatSignedChange,
  parseApiDate,
  pluralise,
} from './format';

const uk = { locale: 'en-GB', timeZone: 'UTC', now: new Date('2026-11-14T20:41:00.000Z') };

describe('formatInteger', () => {
  it('writes exact integers with thousands separators', () => {
    expect(formatInteger(3_412_907)).toBe('3,412,907');
    expect(formatInteger(38)).toBe('38');
    expect(formatInteger(0)).toBe('0');
  });

  it('uses a true minus sign', () => {
    expect(formatInteger(-318)).toBe('−318');
  });
});

describe('formatRoundedCount', () => {
  it('rounds millions to one decimal', () => {
    expect(formatRoundedCount(2_104_339)).toBe('2.1 million');
    expect(formatRoundedCount(1_590_221)).toBe('1.6 million');
    expect(formatRoundedCount(3_000_000)).toBe('3 million');
    expect(formatRoundedCount(999_960)).toBe('1 million');
  });

  it('rounds thousands to the nearest thousand', () => {
    expect(formatRoundedCount(269_114)).toBe('269,000');
    expect(formatRoundedCount(18_440)).toBe('18,000');
  });

  it('keeps small counts exact', () => {
    expect(formatRoundedCount(412)).toBe('412');
  });
});

describe('formatBytes', () => {
  it('writes one decimal in the largest fitting unit', () => {
    expect(formatBytes(28.4 * 1024 * 1024)).toBe('28.4 MB');
    expect(formatBytes(41.7 * 1024 ** 3)).toBe('41.7 GB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('writes whole bytes below one kilobyte and rolls over cleanly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024 * 1024 - 1)).toBe('1.0 MB');
  });

  it('treats invalid sizes as zero', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('formatDuration', () => {
  it('writes seconds, minutes and hours', () => {
    expect(formatDuration(42)).toBe('42 s');
    expect(formatDuration(108)).toBe('1 min 48 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(3900)).toBe('1 h 5 min');
    expect(formatDuration(0.4)).toBe('0 s');
  });

  it('measures between two API timestamps', () => {
    expect(durationBetween('2026-11-08T06:40:00.000Z', '2026-11-08T06:41:48.000Z')).toBe(108);
    expect(durationBetween(null, '2026-11-08T06:41:48.000Z')).toBeNull();
  });
});

describe('dates', () => {
  it('parses RFC 3339 UTC strings and rejects junk', () => {
    expect(parseApiDate('2026-11-08T06:42:00.000Z')?.toISOString()).toBe(
      '2026-11-08T06:42:00.000Z',
    );
    expect(parseApiDate('not a date')).toBeNull();
    expect(parseApiDate(null)).toBeNull();
  });

  it('writes a short date and time in the given zone', () => {
    expect(formatDateTime('2026-11-08T06:42:00.000Z', uk)).toBe('8 Nov, 06:42');
    expect(formatDateTime('2026-11-08T06:42:00.000Z', { ...uk, timeZone: 'Asia/Tokyo' })).toBe(
      '8 Nov, 15:42',
    );
  });

  it('names today and adds the year for other years', () => {
    expect(formatDateTime('2026-11-14T09:05:00.000Z', uk)).toBe('Today, 09:05');
    expect(formatDate('2025-03-02T10:00:00.000Z', uk)).toBe('2 Mar 2025');
    expect(formatDate('2026-11-01T10:00:00.000Z', uk)).toBe('1 Nov');
  });

  it('returns an empty string for a missing date', () => {
    expect(formatDateTime(null, uk)).toBe('');
  });

  it('writes a time of day to the second in the given zone', () => {
    expect(formatClockTime('2026-11-08T20:41:07.250Z', uk)).toBe('20:41:07');
    expect(formatClockTime('2026-11-08T20:41:07.250Z', { ...uk, timeZone: 'Asia/Tokyo' })).toBe(
      '05:41:07',
    );
    expect(formatClockTime(undefined, uk)).toBe('');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-11-14T20:41:00.000Z');

  it('describes the past and the future', () => {
    expect(formatRelativeTime('2026-11-08T20:41:00.000Z', now)).toBe('6 days ago');
    expect(formatRelativeTime('2026-11-15T02:41:00.000Z', now)).toBe('in 6 hours');
    expect(formatRelativeTime('2026-11-14T20:36:00.000Z', now)).toBe('5 minutes ago');
    expect(formatRelativeTime('2026-08-14T20:41:00.000Z', now)).toBe('3 months ago');
  });

  it('calls anything under 45 seconds just now', () => {
    expect(formatRelativeTime('2026-11-14T20:40:40.000Z', now)).toBe('just now');
  });
});

describe('formatSignedChange', () => {
  it('signs gains and losses and leaves zero bare', () => {
    expect(formatSignedChange(1204)).toBe('+1,204');
    expect(formatSignedChange(-318)).toBe('−318');
    expect(formatSignedChange(0)).toBe('0');
  });
});

describe('formatPercent and pluralise', () => {
  it('rounds a ratio to a whole percentage', () => {
    expect(formatPercent(0.8532)).toBe('85%');
    expect(formatPercent(1.25)).toBe('125%');
  });

  it('chooses the singular or plural noun', () => {
    expect(pluralise(1, 'source')).toBe('1 source');
    expect(pluralise(38, 'source')).toBe('38 sources');
    expect(pluralise(2, 'copy', 'copies')).toBe('2 copies');
  });
});
