import type { LibraryCategory, LibraryEntry, LibraryEntrySubmission } from '../../../api/admin';
import { toApiError } from '../../../api/errors';
import { formatInteger } from '../../../lib/format';
import { formFailure, type FormFailure } from '../shared/fieldErrors';

export const MAX_URL_LENGTH = 2048;
export const MAX_NAME_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_DOMAIN_COUNT = 1_000_000_000;
export const MIN_STRICTNESS = 1;
export const MAX_STRICTNESS = 5;

export const CATEGORY_LABELS: Record<LibraryCategory, string> = {
  comprehensive: 'Comprehensive',
  malicious: 'Malicious',
  advertising: 'Advertising',
  tracking: 'Tracking',
  suspicious: 'Suspicious',
  nsfw: 'Adult content (nsfw)',
};

export const CATEGORY_ORDER: ReadonlyArray<LibraryCategory> = [
  'comprehensive',
  'malicious',
  'advertising',
  'tracking',
  'suspicious',
  'nsfw',
];

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as LibraryCategory] ?? category;
}

export function filterLibrary(
  entries: LibraryEntry[],
  query: string,
  category: LibraryCategory | 'all',
): LibraryEntry[] {
  const wanted = query.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (category === 'all' || entry.category === category) &&
      (wanted === '' ||
        [entry.name, entry.url, entry.description].some((text) =>
          text.toLowerCase().includes(wanted),
        )),
  );
}

export interface LibraryGroup {
  category: LibraryCategory;
  entries: LibraryEntry[];
}

export function groupByCategory(entries: LibraryEntry[]): LibraryGroup[] {
  const known = CATEGORY_ORDER.map((category) => ({
    category,
    entries: entries.filter((entry) => entry.category === category),
  }));
  const others = [...new Set(entries.map((entry) => entry.category))]
    .filter((category) => !CATEGORY_ORDER.includes(category))
    .map((category) => ({
      category,
      entries: entries.filter((entry) => entry.category === category),
    }));
  return [...known, ...others].filter((group) => group.entries.length > 0);
}

export type LibraryField =
  | 'url'
  | 'name'
  | 'category'
  | 'description'
  | 'recommended'
  | 'aggressiveness'
  | 'domain_count';

export const LIBRARY_FIELDS: ReadonlyArray<LibraryField> = [
  'url',
  'name',
  'category',
  'description',
  'recommended',
  'aggressiveness',
  'domain_count',
];

export interface LibraryDraft {
  url: string;
  name: string;
  category: LibraryCategory;
  description: string;
  recommended: boolean;
  aggressiveness: string;
  domainCount: string;
}

export function entryDraft(entry: LibraryEntry | null): LibraryDraft {
  return {
    url: entry?.url ?? '',
    name: entry?.name ?? '',
    category: entry?.category ?? 'comprehensive',
    description: entry?.description ?? '',
    recommended: entry?.recommended ?? false,
    aggressiveness: String(entry?.aggressiveness ?? 3),
    domainCount: String(entry?.domain_count ?? 0),
  };
}

function wholeNumber(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
}

export function draftErrors(draft: LibraryDraft): Partial<Record<LibraryField, string>> {
  const errors: Partial<Record<LibraryField, string>> = {};
  if (draft.url.trim() === '') errors.url = 'Enter the address of the list.';
  else if (!/^https?:\/\//i.test(draft.url.trim())) {
    errors.url = 'The address must start with http:// or https://.';
  }
  if (draft.name.trim() === '') errors.name = 'Enter a name.';
  const strictness = wholeNumber(draft.aggressiveness);
  if (strictness === null || strictness < MIN_STRICTNESS || strictness > MAX_STRICTNESS) {
    errors.aggressiveness = `Enter a whole number from ${MIN_STRICTNESS} to ${MAX_STRICTNESS}.`;
  }
  const domains = wholeNumber(draft.domainCount);
  if (domains === null || domains > MAX_DOMAIN_COUNT) {
    errors.domain_count = `Enter a whole number from 0 to ${formatInteger(MAX_DOMAIN_COUNT)}.`;
  }
  return errors;
}

export function draftSubmission(draft: LibraryDraft): LibraryEntrySubmission {
  return {
    url: draft.url.trim(),
    name: draft.name.trim(),
    category: draft.category,
    description: draft.description.trim(),
    recommended: draft.recommended,
    aggressiveness: Number(draft.aggressiveness.trim()),
    domain_count: Number(draft.domainCount.trim()),
  };
}

export function saveFailure(error: unknown): FormFailure<LibraryField> {
  const apiError = toApiError(error);
  if (apiError.status === 409) {
    return { fields: { url: 'Another library entry already uses this address.' }, form: null };
  }
  return formFailure(error, {
    fields: LIBRARY_FIELDS,
    fallback: 'The library entry could not be saved.',
  });
}

export function strictnessLabel(aggressiveness: number): string {
  return `${formatInteger(aggressiveness)} of ${MAX_STRICTNESS}`;
}
