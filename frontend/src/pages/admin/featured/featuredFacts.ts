import { toApiError } from '../../../api/errors';
import { formFailure, type FormFailure } from '../shared/fieldErrors';

export type FeaturedField = 'username' | 'list_name' | 'description';

export const FEATURED_FIELDS: ReadonlyArray<FeaturedField> = [
  'username',
  'list_name',
  'description',
];

export const MAX_FEATURED_NAME_LENGTH = 100;
export const MAX_FEATURED_DESCRIPTION_LENGTH = 500;

const NOT_FOUND_FIELDS: Record<string, { field: FeaturedField; message: string }> = {
  'User not found': { field: 'username', message: 'No account has this username.' },
  'List not found': {
    field: 'list_name',
    message: 'This account has no published list with this name.',
  },
};

export function addFeaturedFailure(error: unknown): FormFailure<FeaturedField> {
  const apiError = toApiError(error);
  const missing = apiError.status === 404 ? NOT_FOUND_FIELDS[apiError.message] : undefined;
  if (missing) return { fields: { [missing.field]: missing.message }, form: null };
  return formFailure(error, {
    fields: FEATURED_FIELDS,
    fallback: 'The list could not be featured.',
  });
}

export interface FeaturedDraft {
  username: string;
  listName: string;
  description: string;
}

export function draftErrors(draft: FeaturedDraft): Partial<Record<FeaturedField, string>> {
  const errors: Partial<Record<FeaturedField, string>> = {};
  if (draft.username.trim() === '') errors.username = 'Enter the username of the account.';
  if (draft.listName.trim() === '') errors.list_name = 'Enter the name of the list.';
  return errors;
}

export interface FeaturedPosition {
  id: string;
  order: number;
}

export type MoveDirection = 'up' | 'down';

export function planFeaturedMove(
  featured: readonly FeaturedPosition[],
  index: number,
  direction: MoveDirection,
): FeaturedPosition[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= featured.length || target < 0 || target >= featured.length) return [];
  const moved = featured[index];
  const neighbour = featured[target];
  if (moved.order !== neighbour.order) {
    return [
      { id: moved.id, order: neighbour.order },
      { id: neighbour.id, order: moved.order },
    ];
  }
  const sequence = [...featured];
  sequence[index] = neighbour;
  sequence[target] = moved;
  return sequence
    .map((entry, position) => ({ id: entry.id, order: position + 1, was: entry.order }))
    .filter((entry) => entry.order !== entry.was)
    .map(({ id, order }) => ({ id, order }));
}
