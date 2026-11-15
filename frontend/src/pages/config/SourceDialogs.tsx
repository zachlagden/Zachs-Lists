import type { Dispatch } from 'react';
import {
  addSource,
  isSourceEntry,
  sourceUrls,
  updateSource,
  writtenNames,
  type LibraryAdditions,
  type SourceEntry,
  type SourceFields,
} from '../../components/config/sourceLines';
import { showToast } from '../../components/ui/toasts';
import type { EditorDialog } from './EditorCard';
import type { EditorAction } from './editorState';
import { LibraryDialog } from './LibraryDialog';
import { SourceFormDialog } from './SourceFormDialog';

const NEW_SOURCE: SourceFields = { url: '', name: '', category: null, abp: false };

export interface SourceDialogsProps {
  dialog: EditorDialog | null;
  entries: SourceEntry[];
  categories: readonly string[];
  remainingSlots: number;
  dispatch: Dispatch<EditorAction>;
  onClose: () => void;
}

export function SourceDialogs({
  dialog,
  entries,
  categories,
  remainingSlots,
  dispatch,
  onClose,
}: SourceDialogsProps) {
  const editing =
    dialog?.kind === 'edit'
      ? entries.filter(isSourceEntry).find((entry) => entry.line.id === dialog.lineId)
      : undefined;

  const addAll = (additions: SourceFields[]) => {
    dispatch({
      type: 'edit',
      tab: 'sources',
      apply: (current) =>
        additions.reduce((next, fields) => addSource(next, fields, categories).draft, current),
    });
    onClose();
  };

  const addFromLibrary = ({ additions, renamed }: LibraryAdditions) => {
    addAll(additions);
    if (renamed.length === 0) return;
    showToast(
      'info',
      `${renamed.map((name) => `${name.wanted} was added as ${name.given}`).join(', ')}, because the name was already taken.`,
    );
  };

  const applyEdit = (lineId: number, fields: SourceFields) => {
    dispatch({
      type: 'edit',
      tab: 'sources',
      apply: (current) => updateSource(current, lineId, fields),
    });
    onClose();
  };

  if (dialog?.kind === 'add') {
    return (
      <SourceFormDialog
        mode="add"
        initial={NEW_SOURCE}
        categories={categories}
        takenNames={writtenNames(entries)}
        existingUrls={sourceUrls(entries)}
        onSubmit={(fields) => addAll([fields])}
        onClose={onClose}
      />
    );
  }
  if (editing) {
    return (
      <SourceFormDialog
        mode="edit"
        initial={editing.parsed}
        categories={categories}
        takenNames={writtenNames(entries, editing.line.id)}
        existingUrls={sourceUrls(entries)}
        onSubmit={(fields) => applyEdit(editing.line.id, fields)}
        onClose={onClose}
      />
    );
  }
  if (dialog?.kind === 'library') {
    return (
      <LibraryDialog
        categories={categories}
        takenNames={writtenNames(entries)}
        existingUrls={sourceUrls(entries)}
        remainingSlots={remainingSlots}
        onAdd={addFromLibrary}
        onClose={onClose}
      />
    );
  }
  return null;
}
