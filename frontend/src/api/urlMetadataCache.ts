export interface UrlMetadataEntry {
  domain_count: number | null;
  cached: boolean;
}

export type UrlMetadataResponse = Record<string, UrlMetadataEntry>;

export interface KnownUrlMetadata {
  entry: UrlMetadataEntry;
  fetchedAt: number;
}

export type UrlMetadataCache = Map<string, KnownUrlMetadata>;

export type UrlMetadataBatchFetcher = (urls: string[]) => Promise<UrlMetadataResponse>;

export const URL_METADATA_BATCH_SIZE = 100;
export const URL_METADATA_FRESH_MS = 5 * 60 * 1000;

export function urlsToFetch(
  urls: readonly string[],
  cache: UrlMetadataCache,
  now: number,
): string[] {
  return urls.filter((url) => {
    const known = cache.get(url);
    return !known || now - known.fetchedAt > URL_METADATA_FRESH_MS;
  });
}

export function urlBatches(urls: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let start = 0; start < urls.length; start += URL_METADATA_BATCH_SIZE) {
    batches.push(urls.slice(start, start + URL_METADATA_BATCH_SIZE));
  }
  return batches;
}

export function knownMetadata(
  urls: readonly string[],
  cache: UrlMetadataCache,
): UrlMetadataResponse {
  const known: UrlMetadataResponse = {};
  for (const url of urls) {
    const entry = cache.get(url)?.entry;
    if (entry) known[url] = entry;
  }
  return known;
}

export async function loadUrlMetadata(
  urls: readonly string[],
  cache: UrlMetadataCache,
  fetchBatch: UrlMetadataBatchFetcher,
  now: () => number,
): Promise<UrlMetadataResponse> {
  const answers = await Promise.allSettled(
    urlBatches(urlsToFetch(urls, cache, now())).map(fetchBatch),
  );
  const fetchedAt = now();
  const refusals: unknown[] = [];
  for (const answer of answers) {
    if (answer.status === 'rejected') {
      refusals.push(answer.reason);
      continue;
    }
    for (const [url, entry] of Object.entries(answer.value)) cache.set(url, { entry, fetchedAt });
  }
  const known = knownMetadata(urls, cache);
  if (refusals.length > 0 && Object.keys(known).length === 0) throw refusals[0];
  return known;
}
