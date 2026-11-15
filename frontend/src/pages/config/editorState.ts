import { parseDraft, serialiseDraft, type LineDraft } from '../../components/config/lineDraft';

export type EditorTab = 'sources' | 'whitelist';

export interface ServerConfig {
  sources: string;
  whitelist: string;
  revision: number;
}

export interface EditorState {
  server: ServerConfig;
  sources: LineDraft;
  whitelist: LineDraft;
  conflict: ServerConfig | null;
}

export type EditorAction =
  | { type: 'edit'; tab: EditorTab; apply: (draft: LineDraft) => LineDraft }
  | { type: 'discard' }
  | { type: 'restore'; sources: string; whitelist: string }
  | { type: 'server-changed'; server: ServerConfig }
  | { type: 'saved'; server: ServerConfig }
  | { type: 'take-server-version' }
  | { type: 'keep-my-edits' };

function fromServer(server: ServerConfig): EditorState {
  return {
    server,
    sources: parseDraft(server.sources),
    whitelist: parseDraft(server.whitelist),
    conflict: null,
  };
}

export function initialEditorState(server: ServerConfig): EditorState {
  return fromServer(server);
}

export function sameServerConfig(a: ServerConfig, b: ServerConfig): boolean {
  return a.revision === b.revision && a.sources === b.sources && a.whitelist === b.whitelist;
}

export function sourcesText(state: EditorState): string {
  return serialiseDraft(state.sources);
}

export function whitelistText(state: EditorState): string {
  return serialiseDraft(state.whitelist);
}

export function sourcesAreDirty(state: EditorState): boolean {
  return sourcesText(state) !== state.server.sources;
}

export function whitelistIsDirty(state: EditorState): boolean {
  return whitelistText(state) !== state.server.whitelist;
}

export function isDirty(state: EditorState): boolean {
  return sourcesAreDirty(state) || whitelistIsDirty(state);
}

function matchesDraft(state: EditorState, server: ServerConfig): boolean {
  return sourcesText(state) === server.sources && whitelistText(state) === server.whitelist;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'edit': {
      const draft = action.apply(state[action.tab]);
      return draft === state[action.tab] ? state : { ...state, [action.tab]: draft };
    }
    case 'discard':
      return fromServer(state.conflict ?? state.server);
    case 'restore':
      return {
        ...state,
        sources: parseDraft(action.sources),
        whitelist: parseDraft(action.whitelist),
      };
    case 'server-changed': {
      if (sameServerConfig(action.server, state.server)) {
        return state.conflict ? { ...state, conflict: null } : state;
      }
      if (!isDirty(state)) return fromServer(action.server);
      if (matchesDraft(state, action.server)) {
        return { ...state, server: action.server, conflict: null };
      }
      return { ...state, conflict: action.server };
    }
    case 'saved':
      return { ...state, server: action.server, conflict: null };
    case 'take-server-version':
      return state.conflict ? fromServer(state.conflict) : state;
    case 'keep-my-edits':
      return state.conflict ? { ...state, server: state.conflict, conflict: null } : state;
  }
}
