import { useEffect, useRef, useMemo } from 'react';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { StreamLanguage } from '@codemirror/language';

// Custom syntax highlighting for whitelist config
// Patterns:
// - Comments: # ...
// - Optional markers: #OPTIONAL: or #DISABLED:
// - Regex patterns: /^pattern$/
// - Wildcards: *.example.com
// - Exact domains: example.com
const whitelistLanguage = StreamLanguage.define({
  token(stream) {
    // At start of line, check for special patterns
    if (stream.sol()) {
      // Skip leading whitespace
      stream.eatWhile(/\s/);

      // Empty line
      if (stream.eol()) {
        return null;
      }

      // Comments
      if (stream.peek() === '#') {
        stream.next(); // consume #
        // Check for special markers
        if (stream.match(/OPTIONAL:|DISABLED:/)) {
          stream.skipToEnd();
          return 'meta'; // Orange for optional/disabled
        }
        stream.skipToEnd();
        return 'comment';
      }

      // Regex pattern starting with /
      if (stream.peek() === '/') {
        stream.next(); // consume opening /
        // Consume until closing / or end
        while (!stream.eol()) {
          const ch = stream.next();
          if (ch === '/') {
            return 'regexp';
          }
          // Handle escape sequences in regex
          if (ch === '\\' && !stream.eol()) {
            stream.next();
          }
        }
        return 'regexp';
      }

      // Wildcard pattern starting with *
      if (stream.peek() === '*') {
        stream.next();
        return 'operator'; // Red/orange for wildcard star
      }
    }

    // Not at start of line - continue parsing

    // Comment anywhere (shouldn't happen but safety)
    if (stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }

    // Dots (punctuation)
    if (stream.eat('.')) {
      return 'punctuation';
    }

    // Domain name parts (alphanumeric and hyphens)
    if (stream.match(/^[a-zA-Z0-9_-]+/)) {
      return 'string'; // Blue for domain parts
    }

    // Consume any other character
    stream.next();
    return null;
  },
});

// Dark theme matching pihole aesthetic (same as AdvancedConfigEditor)
const darkTheme = EditorView.theme({
  '&': {
    color: '#e1e4e8',
    backgroundColor: '#0d1117',
    height: '100%',
  },
  '.cm-content': {
    caretColor: '#79b8ff',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: '14px',
    lineHeight: '1.5',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#79b8ff',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#264f78',
  },
  '.cm-gutters': {
    backgroundColor: '#0d1117',
    color: '#6e7681',
    border: 'none',
    borderRight: '1px solid #21262d',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#161b22',
  },
  '.cm-activeLine': {
    backgroundColor: '#161b2255',
  },
  '.cm-line': {
    padding: '0 4px',
  },
});

// Custom highlight style for whitelist patterns
const whitelistHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: '#6a737d', fontStyle: 'italic' },
  { tag: tags.meta, color: '#ffab70' },        // #OPTIONAL / #DISABLED lines
  { tag: tags.regexp, color: '#b392f0' },      // Regex patterns /^.../
  { tag: tags.operator, color: '#f97583' },    // Wildcard star *
  { tag: tags.punctuation, color: '#6e7681' }, // Dots
  { tag: tags.string, color: '#79b8ff' },      // Domain name parts
]);

interface WhitelistEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
}

export default function WhitelistEditor({
  value,
  onChange,
  placeholder = '',
  readOnly = false,
  className = '',
}: WhitelistEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Build extensions
  const extensions = useMemo<Extension[]>(() => {
    const exts: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      whitelistLanguage,
      syntaxHighlighting(whitelistHighlightStyle),
      darkTheme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newValue = update.state.doc.toString();
          onChange(newValue);
        }
      }),
    ];

    if (readOnly) {
      exts.push(EditorState.readOnly.of(true));
    }

    if (placeholder) {
      exts.push(EditorView.contentAttributes.of({ 'data-placeholder': placeholder }));
    }

    return exts;
  }, [onChange, readOnly, placeholder]);

  // Initialize editor
  useEffect(() => {
    if (!editorRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // Only run once on mount

  // Update content when value changes externally
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    if (currentValue !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentValue.length,
          insert: value,
        },
      });
    }
  }, [value]);

  return (
    <div
      ref={editorRef}
      className={`border border-pihole-border rounded-lg overflow-hidden ${className}`}
      style={{ height: '384px' }} // h-96 equivalent
    />
  );
}
