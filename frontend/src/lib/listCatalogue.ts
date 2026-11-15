import type { DefaultList, ListFormat } from '../types';
import { formatInteger, formatRoundedCount } from './format';

export const COMBINED_LIST = 'all_domains';
export const ADULT_CONTENT_LIST = 'nsfw';
export const SERVER_DEFAULT_FORMAT: ListFormat = 'hosts';
export const REBUILD_SCHEDULE = 'every Sunday morning (UTC)';

export const LIST_FORMATS: ReadonlyArray<{ value: ListFormat; label: string }> = [
  { value: 'hosts', label: 'Hosts' },
  { value: 'plain', label: 'Plain' },
  { value: 'adblock', label: 'Adblock' },
];

export const FORMAT_NAMES: Record<ListFormat, string> = {
  hosts: 'hosts',
  plain: 'plain',
  adblock: 'Adblock',
};

export const FORMAT_SAMPLES: Record<ListFormat, string> = {
  hosts: '0.0.0.0 ads.example.com',
  plain: 'ads.example.com',
  adblock: '||ads.example.com^',
};

export const FORMAT_USES: Record<ListFormat, string> = {
  hosts: 'Pi-hole and AdGuard Home read the hosts format.',
  plain: 'The plain format has one domain on each line, for tools that take a list of domains.',
  adblock:
    'The Adblock format suits AdGuard Home and browser content blockers such as uBlock Origin.',
};

const DEFAULT_LIST_DESCRIPTIONS: Record<string, string> = {
  all_domains: 'Every category below except adult content',
  advertising: 'Ad servers and ad networks',
  tracking: 'Analytics and device telemetry',
  malicious: 'Malware, phishing and scam sites',
  suspicious: 'Potentially unwanted sites, such as cryptomining hosts',
  comprehensive: 'Broad lists that cover several categories at once',
  nsfw: 'Adult content. Not part of all_domains',
};

export function describeDefaultList(name: string): string {
  return DEFAULT_LIST_DESCRIPTIONS[name] ?? `Sources in the ${name} category`;
}

function listRank(name: string): number {
  if (name === COMBINED_LIST) return 0;
  if (name === ADULT_CONTENT_LIST) return 2;
  return 1;
}

export function orderLists<Entry>(lists: Entry[], nameOf: (entry: Entry) => string): Entry[] {
  return [...lists].sort(
    (first, second) =>
      listRank(nameOf(first)) - listRank(nameOf(second)) ||
      nameOf(first).localeCompare(nameOf(second)),
  );
}

function withFormat(address: string, format: ListFormat): string {
  return `${address}?format=${format}`;
}

export function defaultListAddress(siteUrl: string, name: string, format?: ListFormat): string {
  const address = `${siteUrl}/lists/${name}.txt`;
  return format ? withFormat(address, format) : address;
}

export function userListAddress(
  siteUrl: string,
  username: string,
  name: string,
  format: ListFormat,
): string {
  return withFormat(`${siteUrl}/u/${username}/${name}.txt`, format);
}

export function defaultListPath(name: string, format: ListFormat): string {
  return defaultListAddress('', name, format);
}

export function userListPath(username: string, name: string, format: ListFormat): string {
  return userListAddress('', username, name, format);
}

export function offersFormat(formats: ListFormat[] | undefined, format: ListFormat): boolean {
  if (!formats || formats.length === 0) return format === SERVER_DEFAULT_FORMAT;
  return formats.includes(format);
}

export function exactDomains(count: number | null | undefined): string {
  return typeof count === 'number' ? formatInteger(count) : 'Not counted';
}

export function roundedDomains(count: number | null | undefined): string {
  return typeof count === 'number' ? formatRoundedCount(count) : 'Not counted';
}

export function publishedTime(
  list: Pick<DefaultList, 'published_at' | 'last_updated'>,
): string | null {
  return list.published_at ?? list.last_updated ?? null;
}

export function latestPublishedTime(
  lists: ReadonlyArray<Pick<DefaultList, 'published_at' | 'last_updated'>>,
): string | null {
  let latest: string | null = null;
  for (const list of lists) {
    const time = publishedTime(list);
    if (time && (latest === null || Date.parse(time) > Date.parse(latest))) latest = time;
  }
  return latest;
}

export function heroCountLine(lists: DefaultList[] | undefined): string {
  if (!lists) return '# Rebuilt every Sunday';
  const combined = lists.find((list) => list.name === COMBINED_LIST);
  if (!combined) return '# This list has not been published yet';
  if (typeof combined.domain_count !== 'number') return '# Rebuilt every Sunday';
  return `# ${formatRoundedCount(combined.domain_count)} domains · rebuilt every Sunday`;
}
