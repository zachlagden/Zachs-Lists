import { describe, expect, it } from 'vitest';
import { describeDownloads, describeList, isPublicList } from './listsFacts';

const NOW = new Date('2026-11-15T12:00:00.000Z');

describe('list summary', () => {
  it('gives the exact count, the compressed size and the published time', () => {
    const summary = describeList(
      { domain_count: 6232235, last_updated: '2026-11-08T07:15:15.000Z' },
      1536,
      NOW,
    );
    expect(summary).toMatch(/^6,232,235 domains · 1\.5 KB compressed · published .*Nov/);
  });

  it('reads the date format the API sent before it used UTC timestamps', () => {
    const summary = describeList(
      { domain_count: 10, last_updated: 'Sun, 08 Nov 2026 07:15:15 GMT' },
      null,
      NOW,
    );
    expect(summary).toMatch(/^10 domains · published .*Nov/);
  });

  it('leaves out what is unknown', () => {
    expect(describeList({ domain_count: 10, last_updated: '' }, null, NOW)).toBe('10 domains');
  });
});

describe('list visibility', () => {
  it('treats a list as public unless it says otherwise', () => {
    expect(isPublicList({})).toBe(true);
    expect(isPublicList({ is_public: true })).toBe(true);
    expect(isPublicList({ is_public: false })).toBe(false);
  });
});

describe('download summary', () => {
  it('reports the total across all lists', () => {
    expect(
      describeDownloads({ requests: 9412, unique_visitors: 300, bandwidth_bytes: 2_097_152 }, 30),
    ).toBe(
      'Your lists were downloaded 9,412 times in the last 30 days, 2.0 MB in total. The figure covers all of your lists together.',
    );
  });

  it('says when nothing was downloaded', () => {
    expect(describeDownloads({ requests: 0, unique_visitors: 0, bandwidth_bytes: 0 }, 30)).toBe(
      'None of your lists were downloaded in the last 30 days.',
    );
  });
});
