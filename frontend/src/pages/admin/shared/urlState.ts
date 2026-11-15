export function pageFromSearch(params: URLSearchParams, key = 'page'): number {
  const page = Number.parseInt(params.get(key) ?? '', 10);
  return Number.isFinite(page) && page >= 1 ? page : 1;
}

export function choiceFromSearch<Choice extends string>(
  params: URLSearchParams,
  key: string,
  choices: ReadonlyArray<Choice>,
  fallback: Choice,
): Choice {
  const value = params.get(key);
  return choices.find((choice) => choice === value) ?? fallback;
}

export type SearchChanges = Record<string, string | number | boolean | null | undefined>;

export function withSearchChanges(current: URLSearchParams, changes: SearchChanges): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === '' || value === false) next.delete(key);
    else next.set(key, value === true ? '1' : String(value));
  }
  return next.toString();
}

export function pageRange(
  page: number,
  perPage: number,
  total: number,
): { first: number; last: number } {
  if (total <= 0) return { first: 0, last: 0 };
  const first = (page - 1) * perPage + 1;
  return { first: Math.min(first, total), last: Math.min(page * perPage, total) };
}
