import { describeApiError, toApiError } from '../../../api/errors';

export interface FormFailure<Field extends string> {
  fields: Partial<Record<Field, string>>;
  form: string | null;
}

function withoutPrefix(field: string, prefix: string): string {
  return field.startsWith(prefix) ? field.slice(prefix.length) : field;
}

export interface FailureOptions<Field extends string> {
  fields: ReadonlyArray<Field>;
  prefix?: string;
  aliases?: Readonly<Record<string, Field>>;
  fallback: string;
}

export function formFailure<Field extends string>(
  error: unknown,
  { fields, prefix = '', aliases = {}, fallback }: FailureOptions<Field>,
): FormFailure<Field> {
  const apiError = toApiError(error);
  const message = describeApiError(apiError, fallback);
  if (apiError.field === null) return { fields: {}, form: message };
  const named = withoutPrefix(apiError.field, prefix);
  const field = aliases[named] ?? fields.find((candidate) => candidate === named);
  if (field === undefined) return { fields: {}, form: message };
  return { fields: { [field]: message } as Partial<Record<Field, string>>, form: null };
}

export function errorDetails(error: unknown): string[] {
  const details = toApiError(error).body.details;
  return Array.isArray(details)
    ? details.filter((detail): detail is string => typeof detail === 'string')
    : [];
}

export function focusFirstInvalid(form: HTMLFormElement): void {
  requestAnimationFrame(() => {
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}
