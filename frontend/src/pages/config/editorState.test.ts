import { describe, expect, it } from 'vitest';
import { appendLine, applyViewText, removeLine } from '../../components/config/lineDraft';
import {
  editorReducer,
  initialEditorState,
  isDirty,
  sourcesAreDirty,
  sourcesText,
  whitelistIsDirty,
  whitelistText,
  type EditorState,
  type ServerConfig,
} from './editorState';

const SERVER: ServerConfig = {
  sources: '# top\r\nhttps://example.com/a|a|tracking\r\n',
  whitelist: 'example.com\n',
  revision: 4,
};

function edited(state: EditorState): EditorState {
  const withSource = editorReducer(state, {
    type: 'edit',
    tab: 'sources',
    apply: (draft) => appendLine(draft, 'https://example.com/b|b|tracking'),
  });
  return editorReducer(withSource, {
    type: 'edit',
    tab: 'whitelist',
    apply: (draft) => appendLine(draft, '@@example.org'),
  });
}

describe('the editor draft', () => {
  it('starts clean and returns the server text byte for byte', () => {
    const state = initialEditorState(SERVER);
    expect(isDirty(state)).toBe(false);
    expect(sourcesText(state)).toBe(SERVER.sources);
    expect(whitelistText(state)).toBe(SERVER.whitelist);
  });

  it('keeps unsaved changes in both tabs at once', () => {
    const state = edited(initialEditorState(SERVER));
    expect(sourcesAreDirty(state)).toBe(true);
    expect(whitelistIsDirty(state)).toBe(true);
    expect(sourcesText(state)).toBe(`${SERVER.sources}https://example.com/b|b|tracking\r\n`);
    expect(whitelistText(state)).toBe('example.com\n@@example.org\n');
  });

  it('is clean again once an edit is undone by hand', () => {
    const start = initialEditorState(SERVER);
    const added = edited(start);
    const back = editorReducer(
      editorReducer(added, {
        type: 'edit',
        tab: 'sources',
        apply: (draft) => removeLine(draft, draft.lines[draft.lines.length - 1].id),
      }),
      { type: 'edit', tab: 'whitelist', apply: (draft) => applyViewText(draft, 'example.com\n') },
    );
    expect(isDirty(back)).toBe(false);
  });

  it('returns the same state when an edit changes nothing', () => {
    const state = initialEditorState(SERVER);
    expect(editorReducer(state, { type: 'edit', tab: 'sources', apply: (draft) => draft })).toBe(
      state,
    );
  });

  it('discards both tabs', () => {
    const state = editorReducer(edited(initialEditorState(SERVER)), { type: 'discard' });
    expect(isDirty(state)).toBe(false);
    expect(sourcesText(state)).toBe(SERVER.sources);
  });

  it('restores a kept draft over the server version', () => {
    const state = editorReducer(initialEditorState(SERVER), {
      type: 'restore',
      sources: 'https://example.com/kept|kept|tracking\n',
      whitelist: SERVER.whitelist,
    });
    expect(sourcesAreDirty(state)).toBe(true);
    expect(whitelistIsDirty(state)).toBe(false);
    expect(state.server).toBe(SERVER);
  });
});

describe('changes on the server', () => {
  const newer: ServerConfig = { ...SERVER, sources: '# changed elsewhere\n', revision: 5 };

  it('ignores a refetch that brings nothing new', () => {
    const state = edited(initialEditorState(SERVER));
    expect(editorReducer(state, { type: 'server-changed', server: { ...SERVER } })).toBe(state);
  });

  it('takes the new version when nothing is unsaved', () => {
    const state = editorReducer(initialEditorState(SERVER), {
      type: 'server-changed',
      server: newer,
    });
    expect(sourcesText(state)).toBe(newer.sources);
    expect(state.server).toBe(newer);
    expect(state.conflict).toBeNull();
  });

  it('raises a conflict instead of dropping unsaved changes', () => {
    const dirty = edited(initialEditorState(SERVER));
    const state = editorReducer(dirty, { type: 'server-changed', server: newer });
    expect(state.conflict).toBe(newer);
    expect(sourcesText(state)).toBe(sourcesText(dirty));
    expect(state.server).toBe(SERVER);
  });

  it('keeps the edits and moves to the new revision when asked to', () => {
    const dirty = edited(initialEditorState(SERVER));
    const conflicted = editorReducer(dirty, { type: 'server-changed', server: newer });
    const kept = editorReducer(conflicted, { type: 'keep-my-edits' });
    expect(kept.conflict).toBeNull();
    expect(kept.server).toBe(newer);
    expect(sourcesText(kept)).toBe(sourcesText(dirty));
    expect(isDirty(kept)).toBe(true);
  });

  it('loads the saved version when asked to', () => {
    const conflicted = editorReducer(edited(initialEditorState(SERVER)), {
      type: 'server-changed',
      server: newer,
    });
    const taken = editorReducer(conflicted, { type: 'take-server-version' });
    expect(isDirty(taken)).toBe(false);
    expect(sourcesText(taken)).toBe(newer.sources);
    expect(taken.conflict).toBeNull();
  });

  it('sees no conflict when the server already holds the same text', () => {
    const dirty = edited(initialEditorState(SERVER));
    const same: ServerConfig = {
      sources: sourcesText(dirty),
      whitelist: whitelistText(dirty),
      revision: 6,
    };
    const state = editorReducer(dirty, { type: 'server-changed', server: same });
    expect(state.conflict).toBeNull();
    expect(isDirty(state)).toBe(false);
  });

  it('keeps typing done while a save was in flight', () => {
    const dirty = edited(initialEditorState(SERVER));
    const savedServer: ServerConfig = {
      sources: sourcesText(dirty),
      whitelist: whitelistText(dirty),
      revision: 6,
    };
    const typedMore = editorReducer(dirty, {
      type: 'edit',
      tab: 'whitelist',
      apply: (draft) => appendLine(draft, 'later.example.com'),
    });
    const state = editorReducer(typedMore, { type: 'saved', server: savedServer });
    expect(sourcesAreDirty(state)).toBe(false);
    expect(whitelistIsDirty(state)).toBe(true);
    expect(whitelistText(state)).toContain('later.example.com');
  });
});
