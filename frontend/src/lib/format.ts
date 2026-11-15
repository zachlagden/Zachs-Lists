const COPY_LOCALE = 'en-GB';
const MINUS_SIGN = '−';

const integerFormat = new Intl.NumberFormat(COPY_LOCALE, { maximumFractionDigits: 0 });
const oneDecimalFormat = new Intl.NumberFormat(COPY_LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const upToOneDecimalFormat = new Intl.NumberFormat(COPY_LOCALE, { maximumFractionDigits: 1 });

export interface DateFormatOptions {
  locale?: string;
  timeZone?: string;
  now?: Date;
}

export type DateInput = string | Date | null | undefined;

export function parseApiDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatInteger(value: number): string {
  return integerFormat.format(Math.round(value)).replace(/^-/, MINUS_SIGN);
}

export function formatDecimal(value: number): string {
  return upToOneDecimalFormat.format(value).replace(/^-/, MINUS_SIGN);
}

export function formatRoundedCount(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000_000) {
    return `${upToOneDecimalFormat.format(value / 1_000_000_000)} billion`;
  }
  if (magnitude >= 999_950) return `${upToOneDecimalFormat.format(value / 1_000_000)} million`;
  if (magnitude >= 1_000) return formatInteger(Math.round(value / 1_000) * 1_000);
  return formatInteger(value);
}

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let amount = bytes / 1024;
  let unit = 0;
  while (amount >= 1023.95 && unit < BYTE_UNITS.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${oneDecimalFormat.format(amount)} ${BYTE_UNITS[unit]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0 s';
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes > 0) return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`;
  return `${rest} s`;
}

export function durationBetween(start: DateInput, end: DateInput): number | null {
  const from = parseApiDate(start);
  const to = parseApiDate(end);
  if (!from || !to) return null;
  return Math.max(0, (to.getTime() - from.getTime()) / 1000);
}

function dayKey(date: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function timeOfDay(date: Date, options: DateFormatOptions): string {
  return new Intl.DateTimeFormat(options.locale ?? COPY_LOCALE, {
    timeZone: options.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function formatDate(value: DateInput, options: DateFormatOptions = {}): string {
  const date = parseApiDate(value);
  if (!date) return '';
  const now = options.now ?? new Date();
  const sameYear =
    dayKey(date, options.timeZone).slice(0, 4) === dayKey(now, options.timeZone).slice(0, 4);
  return new Intl.DateTimeFormat(options.locale ?? COPY_LOCALE, {
    timeZone: options.timeZone,
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  }).format(date);
}

export function formatDateTime(value: DateInput, options: DateFormatOptions = {}): string {
  const date = parseApiDate(value);
  if (!date) return '';
  const now = options.now ?? new Date();
  const time = timeOfDay(date, options);
  if (dayKey(date, options.timeZone) === dayKey(now, options.timeZone)) return `Today, ${time}`;
  return `${formatDate(date, options)}, ${time}`;
}

export function formatClockTime(value: DateInput, options: DateFormatOptions = {}): string {
  const date = parseApiDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(options.locale ?? COPY_LOCALE, {
    timeZone: options.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function formatFullDateTime(value: DateInput, options: DateFormatOptions = {}): string {
  const date = parseApiDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(options.locale ?? COPY_LOCALE, {
    timeZone: options.timeZone,
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(date);
}

const RELATIVE_STEPS: ReadonlyArray<{
  unit: Intl.RelativeTimeFormatUnit;
  seconds: number;
  upTo: number;
}> = [
  { unit: 'minute', seconds: 60, upTo: 3600 },
  { unit: 'hour', seconds: 3600, upTo: 86_400 },
  { unit: 'day', seconds: 86_400, upTo: 14 * 86_400 },
  { unit: 'week', seconds: 7 * 86_400, upTo: 60 * 86_400 },
  { unit: 'month', seconds: 30.44 * 86_400, upTo: 365 * 86_400 },
  { unit: 'year', seconds: 365.25 * 86_400, upTo: Infinity },
];

const relativeFormat = new Intl.RelativeTimeFormat(COPY_LOCALE, { numeric: 'always' });

export function formatRelativeTime(value: DateInput, now: Date = new Date()): string {
  const date = parseApiDate(value);
  if (!date) return '';
  const deltaSeconds = (date.getTime() - now.getTime()) / 1000;
  const magnitude = Math.abs(deltaSeconds);
  if (magnitude < 45) return 'just now';
  const step = RELATIVE_STEPS.find((candidate) => magnitude < candidate.upTo) ?? RELATIVE_STEPS[5];
  const amount = Math.max(1, Math.round(magnitude / step.seconds));
  return relativeFormat.format(deltaSeconds < 0 ? -amount : amount, step.unit);
}

export function formatSignedChange(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  const magnitude = integerFormat.format(Math.abs(rounded));
  return rounded > 0 ? `+${magnitude}` : `${MINUS_SIGN}${magnitude}`;
}

export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '0%';
  return `${integerFormat.format(Math.round(ratio * 100))}%`;
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatInteger(count)} ${count === 1 ? singular : plural}`;
}
