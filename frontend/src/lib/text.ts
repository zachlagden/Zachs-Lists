import { formatDuration } from './format';

export function sentence(text: string | null | undefined): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function describeSeconds(seconds: number): string {
  return seconds > 0 && seconds < 1 ? 'less than 1 s' : formatDuration(seconds);
}
