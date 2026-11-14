function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

export function utcIsoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return '';
  const year = String(moment.getFullYear()).padStart(4, '0');
  const date = `${year}-${twoDigits(moment.getMonth() + 1)}-${twoDigits(moment.getDate())}`;
  return `${date}T${twoDigits(moment.getHours())}:${twoDigits(moment.getMinutes())}`;
}

export function localInputToUtcIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  const moment = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(moment.getTime())) return null;
  return moment.toISOString();
}
