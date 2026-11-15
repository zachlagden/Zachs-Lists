import { EditorView } from '@codemirror/view';

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'var(--sunken)',
    fontSize: '13px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.65',
  },
  '.cm-content': { caretColor: 'var(--text)', padding: '10px 0' },
  '.cm-line': { padding: '0 14px 0 10px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--accent-soft)' },
  '.cm-gutters': {
    backgroundColor: 'var(--sunken)',
    color: 'var(--text-tertiary)',
    border: 'none',
    borderRight: '1px solid var(--border)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px', minWidth: '28px' },
  '.cm-activeLine': { backgroundColor: 'var(--surface-raised)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-raised)', color: 'var(--text)' },
  '.cm-placeholder': { color: 'var(--text-tertiary)' },
  '.cm-specialChar': { color: 'var(--warn)' },
  '.cm-diagnostic-error': {
    textDecoration: 'underline wavy var(--fail)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cm-diagnostic-warning': {
    textDecoration: 'underline wavy var(--warn)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cm-diagnostic-line-error': { boxShadow: 'inset 3px 0 0 var(--fail)' },
  '.cm-diagnostic-line-warning': { boxShadow: 'inset 3px 0 0 var(--warn)' },
});
