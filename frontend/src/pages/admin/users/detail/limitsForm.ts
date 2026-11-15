import type { AdminUserDetail } from '../../../../api/admin';
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

export function changedLimits(user: LimitSubject, values: LimitValues): Partial<UserLimits> {
  const changes: Partial<UserLimits> = {};
  for (const key of LIMIT_KEYS) {
    const amount = Number(values[key].trim());
    if (Number.isInteger(amount) && amount !== user.limits[key]) changes[key] = amount;
  }
  return changes;
}

export function limitHint(user: LimitSubject, field: LimitField): string {
  const standard = formatInteger(user.default_limits[field.key]);
  const maximum = formatInteger(user.limit_maximums[field.key]);
  return `Default ${standard} ${field.unit}. At most ${maximum}.`;
}

export function hasEdits(user: LimitSubject, values: LimitValues): boolean {
  return LIMIT_KEYS.some((key) => values[key].trim() !== String(user.limits[key]));
}
