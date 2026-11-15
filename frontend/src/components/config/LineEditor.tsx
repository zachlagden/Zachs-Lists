import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { Annotation, EditorState, Transaction } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
} from '@codemirror/view';
import { useEffect, useEffectEvent, useRef } from 'react';
import { cn } from '../../lib/cn';
import { diagnosticsExtension, setDiagnostics, type EditorDiagnostic } from './editorDiagnostics';
import { syntaxExtension, type EditorSyntax } from './editorSyntax';
import { editorTheme } from './editorTheme';
import { minimalChange } from './minimalChange';

const fromOutside = Annotation.define<boolean>();

export interface LineJump {
  lineNumber: number;
  request: number;
}

export interface LineEditorProps {
  value: string;
  onChange: (value: string) => void;
  syntax: EditorSyntax;
  categories: readonly string[];
  label: string;
  placeholder: string;
  diagnostics: readonly EditorDiagnostic[];
  jump?: LineJump | null;
  className?: string;
}

export function LineEditor({
  value,
  onChange,
  syntax,
  categories,
  label,
  placeholder,
  diagnostics,
  jump = null,
  className,
}: LineEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const loadedRef = useRef(false);
  const emitChange = useEffectEvent((text: string) => onChange(text));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          placeholderExtension(placeholder),
          syntaxExtension(syntax, categories),
          diagnosticsExtension(),
          editorTheme,
          EditorView.contentAttributes.of({
            'aria-label': label,
            tabindex: '0',
            spellcheck: 'false',
            autocapitalize: 'off',
            autocorrect: 'off',
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((transaction) => transaction.annotation(fromOutside))) {
              return;
            }
            emitChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    loadedRef.current = false;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [syntax, categories, label, placeholder]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const change = minimalChange(view.state.doc.toString(), value);
    if (change) {
      view.dispatch({
        changes: change,
        annotations: loadedRef.current
          ? [fromOutside.of(true)]
          : [fromOutside.of(true), Transaction.addToHistory.of(false)],
      });
    }
    loadedRef.current = true;
  }, [value, syntax, categories, label, placeholder]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setDiagnostics.of(diagnostics) });
  }, [diagnostics, value, syntax, categories, label, placeholder]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !jump) return;
    const lineNumber = Math.min(Math.max(jump.lineNumber, 1), view.state.doc.lines);
    const line = view.state.doc.line(lineNumber);
    view.dispatch({
      selection: { anchor: line.from, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.focus();
  }, [jump]);

  return (
    <div
      ref={hostRef}
      className={cn(
        'overflow-hidden rounded-control border border-border-strong bg-sunken focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--accent-start)',
        className,
      )}
    />
  );
}
