export interface FieldEdit {
  value: string;
  savedWhenEdited: string;
}

export type FieldEdits<Key extends string> = Partial<Record<Key, FieldEdit>>;

export type SameValue = (edited: string, saved: string) => boolean;

const identical: SameValue = (edited, saved) => edited === saved;

function keysOf<Key extends string>(record: Partial<Record<Key, unknown>>): Key[] {
  return Object.keys(record) as Key[];
}

export function withEdit<Key extends string>(
  saved: Record<Key, string>,
  edits: FieldEdits<Key>,
  key: Key,
  value: string,
): FieldEdits<Key> {
  const savedWhenEdited = edits[key]?.savedWhenEdited ?? saved[key];
  return { ...edits, [key]: { value, savedWhenEdited } };
}

export function withoutEdit<Key extends string>(edits: FieldEdits<Key>, key: Key): FieldEdits<Key> {
  const rest = { ...edits };
  delete rest[key];
  return rest;
}

export function shownValues<Key extends string>(
  saved: Record<Key, string>,
  edits: FieldEdits<Key>,
): Record<Key, string> {
  const shown = { ...saved };
  for (const key of keysOf(edits)) {
    const edit = edits[key];
    if (edit) shown[key] = edit.value;
  }
  return shown;
}

export function pendingEdits<Key extends string>(
  saved: Record<Key, string>,
  edits: FieldEdits<Key>,
  same: SameValue = identical,
): Partial<Record<Key, string>> {
  const pending: Partial<Record<Key, string>> = {};
  for (const key of keysOf(edits)) {
    const edit = edits[key];
    if (edit && !same(edit.value, saved[key])) pending[key] = edit.value;
  }
  return pending;
}

export function editsChangedUnderneath<Key extends string>(
  saved: Record<Key, string>,
  edits: FieldEdits<Key>,
  same: SameValue = identical,
): Key[] {
  return keysOf(pendingEdits(saved, edits, same)).filter(
    (key) => edits[key]?.savedWhenEdited !== saved[key],
  );
}

export function acceptingSaved<Key extends string>(
  saved: Record<Key, string>,
  edits: FieldEdits<Key>,
): FieldEdits<Key> {
  const accepted: FieldEdits<Key> = {};
  for (const key of keysOf(edits)) {
    const edit = edits[key];
    if (edit) accepted[key] = { value: edit.value, savedWhenEdited: saved[key] };
  }
  return accepted;
}
