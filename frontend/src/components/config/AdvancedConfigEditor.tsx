import { useEffect, useRef, useMemo } from 'react';
import { EditorState, Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  highlightActiveLine,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { StreamLanguage } from '@codemirror/language';
import { urlMetadataExtension } from './urlMetadataExtension';
import { userApi } from '../../api/client';

// Valid categories for the blocklist config
const VALID_CATEGORIES = new Set([
  'comprehensive',
  'malicious',
  'advertising',
  'tracking',
  'suspicious',
  'nsfw',
]);

// Custom syntax highlighting for blocklist config with proper tags
const bloclistWithTags = StreamLanguage.define({
  token(stream) {
    // Handle comments
    if (stream.sol() && stream.match(/^\s*#/)) {
      // Check for special markers like #OPTIONAL: or #DISABLED:
      if (stream.match(/OPTIONAL:|DISABLED:/)) {
        stream.skipToEnd();
        return 'meta'; // Orange for optional/disabled lines
      }
      stream.skipToEnd();
      return 'comment';
    }

    // Skip leading whitespace
    if (stream.sol()) {
      stream.eatWhile(/\s/);
    }

    // Empty line
    if (stream.eol()) {
      return null;
    }

    // Comment anywhere
    if (stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }

    // URL part (before first pipe)
    if (stream.match(/^https?:\/\/[^|\n]+/)) {
      return 'url';
    }

    // Pipe delimiter
    if (stream.eat('|')) {
      return 'punctuation';
    }

    // After URL, check if this looks like a name or category
    const remaining = stream.string.slice(stream.pos);
    const hasPipeAfter = remaining.includes('|');

    if (hasPipeAfter) {
      // This is the name part
      if (stream.match(/^[a-zA-Z0-9_-]+/)) {
        return 'variableName';
      }
    } else {
      // This is the category part (last segment)
      // Extract the category string before matching
      const remainingStr = stream.string.slice(stream.pos);
      const categoryRegex = /^[a-zA-Z0-9_-]+/;
      const match = remainingStr.match(categoryRegex);
      if (match && stream.match(categoryRegex)) {
        const category = match[0];
        if (VALID_CATEGORIES.has(category)) {
          return 'keyword';
        } else {
          return 'invalid';
        }
      }
    }

    // Fall through - consume a character
    stream.next();
    return null;
  },
});

// Dark theme matching pihole aesthetic
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

// Custom highlight style with correct tags
const customHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: '#6a737d', fontStyle: 'italic' },
  { tag: tags.meta, color: '#ffab70' }, // #OPTIONAL / #DISABLED lines
  { tag: tags.url, color: '#79b8ff' },
  { tag: tags.punctuation, color: '#6e7681' },
  { tag: tags.variableName, color: '#ffab70' },
  { tag: tags.keyword, color: '#85e89d' },
  { tag: tags.invalid, color: '#f97583', textDecoration: 'underline wavy' },
]);

interface AdvancedConfigEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
}

export default function AdvancedConfigEditor({
  value,
  onChange,
  placeholder = '',
  readOnly = false,
  className = '',
}: AdvancedConfigEditorProps) {
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
      bloclistWithTags,
      syntaxHighlighting(customHighlightStyle),
      darkTheme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newValue = update.state.doc.toString();
          onChange(newValue);
        }
      }),
      // URL metadata decorations (domain counts)
      urlMetadataExtension(userApi.getUrlMetadata),
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
