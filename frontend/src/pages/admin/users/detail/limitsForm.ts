import type { AdminUserDetail } from '../../../../api/admin';
import {
  editsChangedUnderneath,
  pendingEdits,
  shownValues,
  type FieldEdits,
} from '../../../../lib/editOverlay';
import { formatInteger } from '../../../../lib/format';
import type { UserLimits } from '../../../../types';

export type LimitKey = keyof UserLimits;

export interface LimitField {
  key: LimitKey;
  label: string;
  unit: string;
}

export const LIMIT_FIELDS: ReadonlyArray<LimitField> = [
  { key: 'max_domains', label: 'Domains across all lists', unit: 'domains' },
  { key: 'max_source_lists', label: 'Sources in the configuration', unit: 'sources' },
  { key: 'max_config_size_mb', label: 'Configuration size', unit: 'MB' },
  { key: 'manual_updates_per_week', label: 'Manual builds each week', unit: 'builds' },
];

export const LIMIT_KEYS: ReadonlyArray<LimitKey> = LIMIT_FIELDS.map((field) => field.key);

export type LimitValues = Record<LimitKey, string>;

export type LimitEdits = FieldEdits<LimitKey>;

export const NO_LIMIT_EDITS: LimitEdits = {};

function sameLimit(edited: string, saved: string): boolean {
  return edited.trim() === saved;
}

type LimitSubject = Pick<AdminUserDetail, 'limits' | 'default_limits' | 'limit_maximums'>;

export function limitValues(limits: UserLimits): LimitValues {
  return {
    max_domains: String(limits.max_domains),
    max_source_lists: String(limits.max_source_lists),
    max_config_size_mb: String(limits.max_config_size_mb),
    manual_updates_per_week: String(limits.manual_updates_per_week),
  };
}

export function isOverride(user: LimitSubject, key: LimitKey): boolean {
  return user.limits[key] !== user.default_limits[key];
}

export function limitError(value: string, maximum: number): string | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return 'Enter a whole number.';
  const amount = Number(trimmed);
  if (amount < 1 || amount > maximum) {
    return `Enter a number between 1 and ${formatInteger(maximum)}.`;
  }
  return null;
}

export function limitErrors(
  user: LimitSubject,
  values: LimitValues,
): Partial<Record<LimitKey, string>> {
  const errors: Partial<Record<LimitKey, string>> = {};
  for (const key of LIMIT_KEYS) {
    const error = limitError(values[key], user.limit_maximums[key]);
    if (error) errors[key] = error;
  }
  return errors;
}

export function shownLimits(user: LimitSubject, edits: LimitEdits): LimitValues {
  return shownValues(limitValues(user.limits), edits);
}

export function changedLimits(user: LimitSubject, edits: LimitEdits): Partial<UserLimits> {
  const pending = pendingEdits(limitValues(user.limits), edits, sameLimit);
  const changes: Partial<UserLimits> = {};
  for (const key of LIMIT_KEYS) {
    const value = pending[key];
    if (value === undefined) continue;
    const amount = Number(value.trim());
    if (Number.isInteger(amount) && amount !== user.limits[key]) changes[key] = amount;
  }
  return changes;
}

export function limitsChangedUnderneath(user: LimitSubject, edits: LimitEdits): LimitKey[] {
  const changed = editsChangedUnderneath(limitValues(user.limits), edits, sameLimit);
  return LIMIT_KEYS.filter((key) => changed.includes(key));
}

export function describeChangedUnderneath(user: LimitSubject, keys: LimitKey[]): string {
  return LIMIT_FIELDS.filter((field) => keys.includes(field.key))
    .map(
      (field) =>
        `${field.label} is now ${formatInteger(user.limits[field.key])} ${field.unit} on the server.`,
    )
    .join(' ');
}

export function limitHint(user: LimitSubject, field: LimitField): string {
  const standard = formatInteger(user.default_limits[field.key]);
  const maximum = formatInteger(user.limit_maximums[field.key]);
  return `Default ${standard} ${field.unit}. At most ${maximum}.`;
}

export function hasEdits(user: LimitSubject, edits: LimitEdits): boolean {
  return Object.keys(pendingEdits(limitValues(user.limits), edits, sameLimit)).length > 0;
}
