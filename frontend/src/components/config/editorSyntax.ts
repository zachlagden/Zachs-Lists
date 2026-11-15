import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { ABP_FLAG } from './sourceLines';

interface SourceLineState {
  field: number;
}

function sourcesLanguage(categories: readonly string[]): StreamLanguage<SourceLineState> {
  return StreamLanguage.define<SourceLineState>({
    startState: () => ({ field: 0 }),
    token(stream, state) {
      if (stream.sol()) {
        state.field = 0;
        stream.eatSpace();
        if (stream.peek() === '#') {
          stream.skipToEnd();
          return 'comment';
        }
        if (stream.eol()) return null;
      }
      if (stream.eat('|')) {
        state.field += 1;
        return 'punctuation';
      }
      const start = stream.pos;
      stream.eatWhile((character: string) => character !== '|');
      const text = stream.string.slice(start, stream.pos).trim();
      if (state.field === 0) return 'link';
      if (state.field === 1) return 'variableName';
      if (state.field === 2) return categories.includes(text) ? 'keyword' : 'invalid';
      if (state.field === 3) return text === ABP_FLAG ? 'atom' : 'invalid';
      return 'invalid';
    },
  });
}

const whitelistLanguage = StreamLanguage.define<Record<string, never>>({
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }
    const start = stream.pos;
    const lineStart = stream.string.slice(0, start).trim() === '';
    if (lineStart && stream.peek() === '/') {
      stream.eatWhile((character: string) => character !== '#');
      return 'regexp';
    }
    if (lineStart && stream.match('@@')) return 'keyword';
    if (stream.eat('*')) return 'operator';
    stream.eatWhile((character: string) => !/[\s#*]/.test(character));
    if (stream.pos === start) stream.next();
    return 'variableName';
  },
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--text-tertiary)', fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--info)' },
  { tag: tags.variableName, color: 'var(--text)' },
  { tag: tags.keyword, color: 'var(--ok)' },
  { tag: tags.atom, color: 'var(--warn)' },
  { tag: tags.regexp, color: 'var(--warn)' },
  { tag: tags.operator, color: 'var(--accent-text)' },
  { tag: tags.punctuation, color: 'var(--text-tertiary)' },
  {
    tag: tags.invalid,
    color: 'var(--fail)',
    textDecoration: 'underline dotted',
  },
]);

export type EditorSyntax = 'sources' | 'whitelist';

export function syntaxExtension(syntax: EditorSyntax, categories: readonly string[]): Extension {
  return [
    syntax === 'sources' ? sourcesLanguage(categories) : whitelistLanguage,
    syntaxHighlighting(highlightStyle),
  ];
}
