import { describe, expect, it } from 'vitest';
import {
  acceptingSaved,
  editsChangedUnderneath,
  pendingEdits,
  shownValues,
  withEdit,
  withoutEdit,
  type FieldEdits,
} from './editOverlay';

type Key = 'sources' | 'whitelist';

const SAVED: Record<Key, string> = { sources: 'a', whitelist: 'x' };
const NO_EDITS: FieldEdits<Key> = {};

describe('edits kept as an overlay on saved values', () => {
  it('shows the saved value for a field nobody edited, after the saved value changes', () => {
    const edits = withEdit(SAVED, NO_EDITS, 'sources', 'b');
    const refetched = { sources: 'a', whitelist: 'y' };
    expect(shownValues(refetched, edits)).toEqual({ sources: 'b', whitelist: 'y' });
    expect(pendingEdits(refetched, edits)).toEqual({ sources: 'b' });
  });

  it('has nothing pending when an edit is typed back to the saved value', () => {
    const edits = withEdit(SAVED, withEdit(SAVED, NO_EDITS, 'sources', 'b'), 'sources', 'a');
    expect(pendingEdits(SAVED, edits)).toEqual({});
  });

  it('reports an edited field whose saved value changed underneath the edit', () => {
    const edits = withEdit(SAVED, NO_EDITS, 'sources', 'b');
    expect(editsChangedUnderneath(SAVED, edits)).toEqual([]);
    expect(editsChangedUnderneath({ ...SAVED, sources: 'c' }, edits)).toEqual(['sources']);
  });

  it('keeps reporting the change while the admin goes on typing', () => {
    const refetched = { ...SAVED, sources: 'c' };
    const edits = withEdit(refetched, withEdit(SAVED, NO_EDITS, 'sources', 'b'), 'sources', 'bb');
    expect(editsChangedUnderneath(refetched, edits)).toEqual(['sources']);
  });

  it('stops reporting once the saved value matches the edit or the admin decides', () => {
    const edits = withEdit(SAVED, NO_EDITS, 'sources', 'b');
    const refetched = { ...SAVED, sources: 'c' };
    expect(editsChangedUnderneath({ ...SAVED, sources: 'b' }, edits)).toEqual([]);
    expect(editsChangedUnderneath(refetched, acceptingSaved(refetched, edits))).toEqual([]);
    expect(pendingEdits(refetched, acceptingSaved(refetched, edits))).toEqual({ sources: 'b' });
    expect(shownValues(refetched, withoutEdit(edits, 'sources'))).toEqual(refetched);
  });

  it('compares with the rule it is given', () => {
    const trimmed = (edited: string, saved: string) => edited.trim() === saved;
    const edits = withEdit(SAVED, NO_EDITS, 'sources', ' a ');
    expect(pendingEdits(SAVED, edits, trimmed)).toEqual({});
    expect(pendingEdits(SAVED, edits)).toEqual({ sources: ' a ' });
  });
});
