import { describe, expect, it } from 'vitest';
import { resolveSiteUrl } from '../config/site';
import type { DefaultList } from '../types';
import {
  defaultListAddress,
  defaultListPath,
  describeDefaultList,
  exactDomains,
  heroCountLine,
  latestPublishedTime,
  offersFormat,
  orderLists,
  publishedTime,
  roundedDomains,
  userListAddress,
  userListPath,
} from './listCatalogue';

const SITE = 'https://lists.example.com';

function defaultList(name: string, overrides: Partial<DefaultList> = {}): DefaultList {
  return {
    name,
    formats: ['hosts', 'plain', 'adblock'],
    size_bytes: 1,
    domain_count: 1000,
    last_updated: '2026-11-08T06:14:59.000Z',
    published_at: '2026-11-08T06:15:10.000Z',
    ...overrides,
  };
}

describe('site address', () => {
  it('uses the configured address without a trailing slash', () => {
    expect(resolveSiteUrl('https://lists.example.com/', 'https://other.example.org')).toBe(SITE);
  });

  it('falls back to the origin the page was loaded from', () => {
    expect(resolveSiteUrl(undefined, SITE)).toBe(SITE);
    expect(resolveSiteUrl('', SITE)).toBe(SITE);
    expect(resolveSiteUrl('   ', SITE)).toBe(SITE);
  });
});

describe('list addresses', () => {
  it('builds a default list address with and without a format', () => {
    expect(defaultListAddress(SITE, 'all_domains')).toBe(`${SITE}/lists/all_domains.txt`);
    expect(defaultListAddress(SITE, 'tracking', 'adblock')).toBe(
      `${SITE}/lists/tracking.txt?format=adblock`,
    );
  });

  it('builds a user list address with no api prefix', () => {
    expect(userListAddress(SITE, 'alex', 'all_domains', 'plain')).toBe(
      `${SITE}/u/alex/all_domains.txt?format=plain`,
    );
    expect(userListPath('alex', 'all_domains', 'hosts')).toBe(
      '/u/alex/all_domains.txt?format=hosts',
    );
    expect(defaultListPath('nsfw', 'hosts')).toBe('/lists/nsfw.txt?format=hosts');
  });
});

describe('formats on offer', () => {
  it('follows the formats a list reports', () => {
    expect(offersFormat(['hosts', 'plain'], 'plain')).toBe(true);
    expect(offersFormat(['hosts', 'plain'], 'adblock')).toBe(false);
  });

  it('assumes only the hosts format when a list reports none', () => {
    expect(offersFormat(undefined, 'hosts')).toBe(true);
    expect(offersFormat([], 'adblock')).toBe(false);
  });
});

describe('list order and descriptions', () => {
  it('puts the combined list first and the adult content list last', () => {
    const names = ['nsfw', 'tracking', 'all_domains', 'advertising'];
    expect(orderLists(names, (name) => name)).toEqual([
      'all_domains',
      'advertising',
      'tracking',
      'nsfw',
    ]);
    expect(names[0]).toBe('nsfw');
  });

  it('describes known categories and falls back to the category name', () => {
    expect(describeDefaultList('malicious')).toBe('Malware, phishing and scam sites');
    expect(describeDefaultList('gambling')).toBe('Sources in the gambling category');
  });
});

describe('domain counts', () => {
  it('shows exact and rounded counts', () => {
    expect(exactDomains(5127863)).toBe('5,127,863');
    expect(roundedDomains(5127863)).toBe('5.1 million');
    expect(roundedDomains(399994)).toBe('400,000');
  });

  it('says when a list was never counted', () => {
    expect(exactDomains(undefined)).toBe('Not counted');
    expect(roundedDomains(null)).toBe('Not counted');
  });
});

describe('published time', () => {
  it('prefers the publication time over the file time', () => {
    expect(publishedTime(defaultList('tracking'))).toBe('2026-11-08T06:15:10.000Z');
    expect(publishedTime(defaultList('tracking', { published_at: null }))).toBe(
      '2026-11-08T06:14:59.000Z',
    );
    expect(publishedTime({})).toBeNull();
  });

  it('finds the latest publication across lists', () => {
    expect(
      latestPublishedTime([
        defaultList('tracking'),
        defaultList('nsfw', { published_at: '2026-11-15T06:15:10.000Z' }),
      ]),
    ).toBe('2026-11-15T06:15:10.000Z');
    expect(latestPublishedTime([])).toBeNull();
  });
});

describe('hero count line', () => {
  it('makes no claim about the count before the lists have loaded', () => {
    expect(heroCountLine(undefined)).toBe('# Rebuilt every Sunday');
  });

  it('rounds the combined list count', () => {
    expect(heroCountLine([defaultList('all_domains', { domain_count: 5127863 })])).toBe(
      '# 5.1 million domains · rebuilt every Sunday',
    );
  });

  it('says when the combined list is not published', () => {
    expect(heroCountLine([defaultList('tracking')])).toBe('# This list has not been published yet');
  });
});
