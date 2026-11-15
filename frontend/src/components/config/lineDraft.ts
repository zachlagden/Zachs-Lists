export type LineEnding = '' | '\n' | '\r\n' | '\r';

export interface DraftLine {
  id: number;
  raw: string;
  ending: LineEnding;
}

export interface LineDraft {
  lines: DraftLine[];
  nextId: number;
}

export type LineNumbering = 'python' | 'rust';

const LINE_PATTERN = /([^\r\n]*)(\r\n|\n|\r|$)/g;
const PYTHON_ONLY_BREAKS = new Set([0x0b, 0x0c, 0x1c, 0x1d, 0x1e, 0x85, 0x2028, 0x2029]);
const DEFAULT_ENDING: LineEnding = '\n';

export function parseDraft(text: string): LineDraft {
  const lines: DraftLine[] = [];
  LINE_PATTERN.lastIndex = 0;
  let consumed = 0;
  while (consumed < text.length) {
    const match = LINE_PATTERN.exec(text);
    if (!match) break;
    lines.push({ id: lines.length + 1, raw: match[1], ending: match[2] as LineEnding });
    consumed += match[0].length;
  }
  return { lines, nextId: lines.length + 1 };
}

export function serialiseDraft(draft: LineDraft): string {
  return draft.lines.map((line) => line.raw + line.ending).join('');
}

export function draftViewText(draft: LineDraft): string {
  return draft.lines.map((line) => line.raw + (line.ending === '' ? '' : '\n')).join('');
}

export function preferredEnding(draft: LineDraft): LineEnding {
  return draft.lines.find((line) => line.ending !== '')?.ending ?? DEFAULT_ENDING;
}

function withSoundEndings(lines: DraftLine[], ending: LineEnding, finalNewline: boolean): void {
  lines.forEach((line, index) => {
    const last = index === lines.length - 1;
    if (!last && line.ending === '') lines[index] = { ...line, ending };
    if (last && !finalNewline && line.ending !== '') lines[index] = { ...line, ending: '' };
    if (last && finalNewline && line.ending === '') lines[index] = { ...line, ending };
  });
}

export function applyViewText(draft: LineDraft, viewText: string): LineDraft {
  if (viewText === draftViewText(draft)) return draft;
  const finalNewline = viewText.endsWith('\n');
  const raws = viewText === '' ? [] : viewText.split('\n');
  if (finalNewline) raws.pop();
  const previous = draft.lines;
  const shorter = Math.min(previous.length, raws.length);
  let head = 0;
  while (head < shorter && previous[head].raw === raws[head]) head += 1;
  let tail = 0;
  while (
    tail < shorter - head &&
    previous[previous.length - 1 - tail].raw === raws[raws.length - 1 - tail]
  ) {
    tail += 1;
  }
  const ending = preferredEnding(draft);
  const replaced = previous.length - head - tail;
  const inserted = raws.length - head - tail;
  let nextId = draft.nextId;
  const middle: DraftLine[] = [];
  for (let offset = 0; offset < inserted; offset += 1) {
    const raw = raws[head + offset];
    if (replaced === inserted) {
      middle.push({ ...previous[head + offset], raw });
    } else {
      middle.push({ id: nextId, raw, ending });
      nextId += 1;
    }
  }
  const lines = [...previous.slice(0, head), ...middle, ...previous.slice(previous.length - tail)];
  withSoundEndings(lines, ending, finalNewline);
  return { lines, nextId };
}

export function insertLine(draft: LineDraft, index: number, raw: string): LineDraft {
  const ending = preferredEnding(draft);
  const position = Math.min(Math.max(index, 0), draft.lines.length);
  const lines = [...draft.lines];
  const atEnd = position === lines.length;
  const hadFinalNewline = lines.length === 0 || lines[lines.length - 1].ending !== '';
  lines.splice(position, 0, { id: draft.nextId, raw, ending });
  if (atEnd) withSoundEndings(lines, ending, hadFinalNewline);
  return { lines, nextId: draft.nextId + 1 };
}

export function appendLine(draft: LineDraft, raw: string): LineDraft {
  return insertLine(draft, draft.lines.length, raw);
}

export function removeLine(draft: LineDraft, id: number): LineDraft {
  if (!draft.lines.some((line) => line.id === id)) return draft;
  return { lines: draft.lines.filter((line) => line.id !== id), nextId: draft.nextId };
}

export function replaceLine(draft: LineDraft, id: number, raw: string): LineDraft {
  if (/[\r\n]/.test(raw)) throw new Error('A line cannot contain a line break');
  const index = draft.lines.findIndex((line) => line.id === id);
  if (index === -1 || draft.lines[index].raw === raw) return draft;
  const lines = [...draft.lines];
  lines[index] = { ...lines[index], raw };
  return { lines, nextId: draft.nextId };
}

function reportedLinesIn(line: DraftLine, numbering: LineNumbering): number {
  if (numbering === 'rust') return line.ending === '\r' ? 0 : 1;
  let lines = 1;
  for (let index = 0; index < line.raw.length; index += 1) {
    if (PYTHON_ONLY_BREAKS.has(line.raw.charCodeAt(index))) lines += 1;
  }
  return lines;
}

export function lineAtReportedNumber(
  draft: LineDraft,
  reported: number,
  numbering: LineNumbering,
): DraftLine | null {
  let counted = 0;
  for (const line of draft.lines) {
    const before = counted;
    counted += reportedLinesIn(line, numbering);
    if (reported > before && reported <= counted) return line;
    if (numbering === 'rust' && counted === before && reported === before + 1) return line;
  }
  return null;
}
