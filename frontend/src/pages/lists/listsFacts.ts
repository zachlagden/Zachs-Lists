import { formatBytes, formatDateTime, pluralise } from '../../lib/format';
import { exactDomains } from '../../lib/listCatalogue';
import type { AnalyticsTotals, UserList } from '../../types';

export function isPublicList(list: Pick<UserList, 'is_public'>): boolean {
  return list.is_public !== false;
}

export function describeList(
  list: Pick<UserList, 'domain_count' | 'last_updated'>,
  compressedBytes: number | null,
  now: Date,
): string {
  const parts = [`${exactDomains(list.domain_count)} domains`];
  if (compressedBytes !== null) parts.push(`${formatBytes(compressedBytes)} compressed`);
  const published = formatDateTime(list.last_updated, { now });
  if (published) parts.push(`published ${published}`);
  return parts.join(' · ');
}

export function describeDownloads(totals: AnalyticsTotals, periodDays: number): string {
  const period = `the last ${pluralise(periodDays, 'day')}`;
  if (totals.requests === 0) return `None of your lists were downloaded in ${period}.`;
  return `Your lists were downloaded ${pluralise(totals.requests, 'time')} in ${period}, ${formatBytes(totals.bandwidth_bytes)} in total. The figure covers all of your lists together.`;
}
