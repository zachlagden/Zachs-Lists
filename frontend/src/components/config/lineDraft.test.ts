import { describe, expect, it } from 'vitest';
import {
  appendLine,
  applyViewText,
  draftViewText,
  insertLine,
  lineAtReportedNumber,
  parseDraft,
  removeLine,
  replaceLine,
  serialiseDraft,
} from './lineDraft';
import { AWKWARD_TEXTS, generatedTexts } from './testTexts';

const ALL_TEXTS = [...AWKWARD_TEXTS, ...generatedTexts(400)];

describe('parsing and serialising a draft', () => {
  it('returns every text byte for byte', () => {
    for (const text of ALL_TEXTS) expect(serialiseDraft(parseDraft(text))).toBe(text);
  });

  it('gives an empty file no lines and never a line with a line break in it', () => {
    expect(parseDraft('').lines).toEqual([]);
    for (const text of ALL_TEXTS) {
      for (const line of parseDraft(text).lines) expect(line.raw).not.toMatch(/[\r\n]/);
    }
  });

  it('gives every line its own id', () => {
    for (const text of ALL_TEXTS) {
      const ids = parseDraft(text).lines.map((line) => line.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('the text view of a draft', () => {
  it('leaves the draft untouched when the view text is fed back unchanged', () => {
    for (const text of ALL_TEXTS) {
      const draft = parseDraft(text);
      expect(applyViewText(draft, draftViewText(draft))).toBe(draft);
    }
  });

  it('keeps the line endings of lines that were not edited', () => {
    const draft = parseDraft('one\r\ntwo\r\nthree\r\n');
    const edited = applyViewText(draft, 'one\nTWO\nthree\n');
    expect(serialiseDraft(edited)).toBe('one\r\nTWO\r\nthree\r\n');
    expect(edited.lines.map((line) => line.id)).toEqual(draft.lines.map((line) => line.id));
  });

  it('gives typed lines the ending the file already uses', () => {
    const draft = parseDraft('one\r\ntwo\r\n');
    expect(serialiseDraft(applyViewText(draft, 'one\nnew\ntwo\n'))).toBe('one\r\nnew\r\ntwo\r\n');
  });

  it('keeps a missing final newline missing and a present one present', () => {
    expect(serialiseDraft(applyViewText(parseDraft('one\ntwo'), 'one\ntwo\nthree'))).toBe(
      'one\ntwo\nthree',
    );
    expect(serialiseDraft(applyViewText(parseDraft('one\n'), 'one\ntwo\n'))).toBe('one\ntwo\n');
    expect(serialiseDraft(applyViewText(parseDraft('one\ntwo\n'), 'one\ntwo'))).toBe('one\ntwo');
  });

  it('keeps the ids of the lines around an edit', () => {
    const draft = parseDraft('a\nb\nc\nd\n');
    const edited = applyViewText(draft, 'a\nx\ny\nd\n');
    expect(edited.lines[0].id).toBe(draft.lines[0].id);
    expect(edited.lines[3].id).toBe(draft.lines[3].id);
    const removed = applyViewText(draft, 'a\nd\n');
    expect(removed.lines.map((line) => line.id)).toEqual([draft.lines[0].id, draft.lines[3].id]);
  });

  it('shows any typed text back exactly as typed', () => {
    for (const text of ALL_TEXTS) {
      const typed = draftViewText(parseDraft(text));
      for (const start of ['', 'x\r\ny\r\n', 'x\ny']) {
        expect(draftViewText(applyViewText(parseDraft(start), typed))).toBe(typed);
      }
    }
  });

  it('empties the draft when all text is deleted', () => {
    expect(applyViewText(parseDraft('one\ntwo\n'), '').lines).toEqual([]);
  });
});

describe('line operations', () => {
  it('removes exactly one line and leaves every other byte alone', () => {
    for (const text of ALL_TEXTS) {
      const draft = parseDraft(text);
      draft.lines.forEach((line, index) => {
        const expected = draft.lines
          .filter((_, other) => other !== index)
          .map((other) => other.raw + other.ending)
          .join('');
        expect(serialiseDraft(removeLine(draft, line.id))).toBe(expected);
      });
    }
  });

  it('removes one of two identical lines by identity', () => {
    const draft = parseDraft('same\nother\nsame\n');
    expect(serialiseDraft(removeLine(draft, draft.lines[2].id))).toBe('same\nother\n');
    expect(serialiseDraft(removeLine(draft, draft.lines[0].id))).toBe('other\nsame\n');
  });

  it('rewrites one line and keeps its ending', () => {
    const draft = parseDraft('one\r\ntwo\r\nthree');
    expect(serialiseDraft(replaceLine(draft, draft.lines[1].id, 'TWO'))).toBe(
      'one\r\nTWO\r\nthree',
    );
    expect(() => replaceLine(draft, draft.lines[1].id, 'a\nb')).toThrow();
  });

  it('inserts a line without changing the lines around it', () => {
    const draft = parseDraft('# top\r\n\r\none\r\n# bottom\r\n');
    expect(serialiseDraft(insertLine(draft, 3, 'two'))).toBe(
      '# top\r\n\r\none\r\ntwo\r\n# bottom\r\n',
    );
  });

  it('appends after a last line that has no newline, and keeps the file without one', () => {
    expect(serialiseDraft(appendLine(parseDraft('one\ntwo'), 'three'))).toBe('one\ntwo\nthree');
    expect(serialiseDraft(appendLine(parseDraft('one\n'), 'two'))).toBe('one\ntwo\n');
    expect(serialiseDraft(appendLine(parseDraft(''), 'one'))).toBe('one\n');
  });
});

describe('line numbers reported by the server', () => {
  it('follows the Python splitter, which also breaks on form feeds', () => {
    const draft = parseDraft('one\ntwo\fhalf\nthree\n');
    expect(lineAtReportedNumber(draft, 2, 'python')?.raw).toBe('two\fhalf');
    expect(lineAtReportedNumber(draft, 3, 'python')?.raw).toBe('two\fhalf');
    expect(lineAtReportedNumber(draft, 4, 'python')?.raw).toBe('three');
    expect(lineAtReportedNumber(draft, 9, 'python')).toBeNull();
  });

  it('follows the Rust splitter, which does not break on a lone carriage return', () => {
    const draft = parseDraft('one\rstill one\ntwo\r\nthree');
    expect(lineAtReportedNumber(draft, 1, 'rust')?.raw).toBe('one');
    expect(lineAtReportedNumber(draft, 2, 'rust')?.raw).toBe('two');
    expect(lineAtReportedNumber(draft, 3, 'rust')?.raw).toBe('three');
  });
});
