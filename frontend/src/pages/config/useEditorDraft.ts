import { useEffect, useMemo, useReducer, useState, type Dispatch } from 'react';
import type { Blocker } from 'react-router-dom';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { useAuthStore } from '../../store';
import {
  clearStoredDraft,
  readStoredDraft,
  writeStoredDraft,
  type StoredDraft,
} from './draftStorage';
import {
  editorReducer,
  initialEditorState,
  sameServerConfig,
  sourcesText,
  whitelistText,
  type EditorAction,
  type EditorState,
  type ServerConfig,
} from './editorState';

export interface EditorDraft {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  sources: string;
  whitelist: string;
  sourcesDirty: boolean;
  whitelistDirty: boolean;
  dirty: boolean;
  restorable: StoredDraft | null;
  restoreStoredDraft: () => void;
  dropStoredDraft: () => void;
  blocker: Blocker;
}

function differsFromServer(draft: StoredDraft, server: ServerConfig): boolean {
  return draft.sources !== server.sources || draft.whitelist !== server.whitelist;
}

export function useEditorDraft(userId: string, server: ServerConfig): EditorDraft {
  const [state, dispatch] = useReducer(editorReducer, server, initialEditorState);
  const [seenServer, setSeenServer] = useState(server);
  if (!sameServerConfig(seenServer, server)) {
    setSeenServer(server);
    dispatch({ type: 'server-changed', server });
  }

  const [restorable, setRestorable] = useState<StoredDraft | null>(() => {
    const stored = readStoredDraft(userId);
    return stored && differsFromServer(stored, server) ? stored : null;
  });

  const sources = useMemo(() => sourcesText(state), [state]);
  const whitelist = useMemo(() => whitelistText(state), [state]);
  const sourcesDirty = sources !== state.server.sources;
  const whitelistDirty = whitelist !== state.server.whitelist;
  const dirty = sourcesDirty || whitelistDirty;

  useEffect(() => {
    if (restorable) return;
    if (dirty) writeStoredDraft(userId, { sources, whitelist });
    else clearStoredDraft(userId);
  }, [userId, restorable, dirty, sources, whitelist]);

  useEffect(
    () => () => {
      if (useAuthStore.getState().isAuthenticated) clearStoredDraft(userId);
    },
    [userId],
  );

  const blocker = useUnsavedChangesGuard(dirty);

  return {
    state,
    dispatch,
    sources,
    whitelist,
    sourcesDirty,
    whitelistDirty,
    dirty,
    restorable,
    restoreStoredDraft: () => {
      if (restorable) dispatch({ type: 'restore', ...restorable });
      setRestorable(null);
    },
    dropStoredDraft: () => {
      clearStoredDraft(userId);
      setRestorable(null);
    },
    blocker,
  };
}
