import { describe, expect, it } from 'vitest';
import {
  URL_METADATA_BATCH_SIZE,
  URL_METADATA_FRESH_MS,
  loadUrlMetadata,
  type UrlMetadataCache,
  type UrlMetadataResponse,
} from './urlMetadataCache';

const A = 'https://lists.example.org/a.txt';
const B = 'https://lists.example.org/b.txt';
const C = 'https://lists.example.org/c.txt';

function server(counts: Record<string, number>): {
  requests: string[][];
  fetchBatch: (urls: string[]) => Promise<UrlMetadataResponse>;
} {
  const requests: string[][] = [];
  return {
    requests,
    fetchBatch: (urls) => {
      requests.push(urls);
      return Promise.resolve(
        Object.fromEntries(
          urls.map((url) => [url, { domain_count: counts[url] ?? null, cached: url in counts }]),
        ),
      );
    },
  };
}

const rateLimited = (): Promise<UrlMetadataResponse> =>
  Promise.reject(Object.assign(new Error('Too many requests'), { status: 429 }));

describe('source domain counts', () => {
  it('asks only for a source it has not seen when one is added', async () => {
    const cache: UrlMetadataCache = new Map();
    const { requests, fetchBatch } = server({ [A]: 10, [B]: 20, [C]: 30 });
    await loadUrlMetadata([A, B], cache, fetchBatch, () => 0);
    const afterAdding = await loadUrlMetadata([A, B, C], cache, fetchBatch, () => 1000);
    expect(requests).toEqual([[A, B], [C]]);
    expect(afterAdding[A].domain_count).toBe(10);
    expect(afterAdding[C].domain_count).toBe(30);
  });

  it('asks for nothing when a source is removed', async () => {
    const cache: UrlMetadataCache = new Map();
    const { requests, fetchBatch } = server({ [A]: 10, [B]: 20 });
    await loadUrlMetadata([A, B], cache, fetchBatch, () => 0);
    const afterRemoving = await loadUrlMetadata([A], cache, fetchBatch, () => 1000);
    expect(requests).toHaveLength(1);
    expect(Object.keys(afterRemoving)).toEqual([A]);
  });

  it('keeps the counts it knows when the server refuses a request', async () => {
    const cache: UrlMetadataCache = new Map();
    await loadUrlMetadata([A], cache, server({ [A]: 10 }).fetchBatch, () => 0);
    const refused = await loadUrlMetadata([A, B], cache, rateLimited, () => 1000);
    expect(refused).toEqual({ [A]: { domain_count: 10, cached: true } });
  });

  it('keeps an old count when refreshing it is refused', async () => {
    const cache: UrlMetadataCache = new Map();
    await loadUrlMetadata([A], cache, server({ [A]: 10 }).fetchBatch, () => 0);
    const later = URL_METADATA_FRESH_MS + 1;
    expect((await loadUrlMetadata([A], cache, rateLimited, () => later))[A].domain_count).toBe(10);
    const refreshed = server({ [A]: 11 });
    expect(
      (await loadUrlMetadata([A], cache, refreshed.fetchBatch, () => later))[A].domain_count,
    ).toBe(11);
  });

  it('reports the refusal when it knows no count at all', async () => {
    await expect(loadUrlMetadata([A], new Map(), rateLimited, () => 0)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('never sends more addresses in one request than the server accepts', async () => {
    const urls = Array.from(
      { length: URL_METADATA_BATCH_SIZE * 2 + 5 },
      (_, index) => `https://lists.example.org/${index}.txt`,
    );
    const { requests, fetchBatch } = server({});
    const loaded = await loadUrlMetadata(urls, new Map(), fetchBatch, () => 0);
    expect(requests.map((batch) => batch.length)).toEqual([100, 100, 5]);
    expect(Object.keys(loaded)).toHaveLength(urls.length);
  });
});
