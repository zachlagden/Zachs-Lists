export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export function minimalChange(current: string, next: string): TextChange | null {
  if (current === next) return null;
  const shorter = Math.min(current.length, next.length);
  let head = 0;
  while (head < shorter && current.charCodeAt(head) === next.charCodeAt(head)) head += 1;
  let tail = 0;
  while (
    tail < shorter - head &&
    current.charCodeAt(current.length - 1 - tail) === next.charCodeAt(next.length - 1 - tail)
  ) {
    tail += 1;
  }
  return { from: head, to: current.length - tail, insert: next.slice(head, next.length - tail) };
}

export function applyChange(current: string, change: TextChange | null): string {
  if (!change) return current;
  return `${current.slice(0, change.from)}${change.insert}${current.slice(change.to)}`;
}
