export type EditorView = 'visual' | 'text';

const VIEW_KEY = 'zl-config-view';

export function readEditorView(): EditorView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'text' ? 'text' : 'visual';
  } catch {
    return 'visual';
  }
}

export function rememberEditorView(view: EditorView): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    return;
  }
}
