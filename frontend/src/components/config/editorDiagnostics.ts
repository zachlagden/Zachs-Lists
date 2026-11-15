import { StateEffect, StateField, type Extension, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

export interface EditorDiagnostic {
  lineNumber: number;
  severity: 'error' | 'warning';
  message: string;
}

export const setDiagnostics = StateEffect.define<readonly EditorDiagnostic[]>();

function decorationsFor(doc: Text, diagnostics: readonly EditorDiagnostic[]): DecorationSet {
  const messages = new Map<number, { severity: EditorDiagnostic['severity']; text: string[] }>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.lineNumber < 1 || diagnostic.lineNumber > doc.lines) continue;
    const entry = messages.get(diagnostic.lineNumber) ?? { severity: 'warning', text: [] };
    if (diagnostic.severity === 'error') entry.severity = 'error';
    entry.text.push(diagnostic.message);
    messages.set(diagnostic.lineNumber, entry);
  }
  const ranges: Range<Decoration>[] = [];
  for (const [lineNumber, { severity, text }] of [...messages].sort((a, b) => a[0] - b[0])) {
    const line = doc.line(lineNumber);
    const title = text.join(' ');
    ranges.push(
      Decoration.line({
        class: `cm-diagnostic-line cm-diagnostic-line-${severity}`,
        attributes: { title },
      }).range(line.from),
    );
    if (line.length > 0) {
      ranges.push(
        Decoration.mark({ class: `cm-diagnostic cm-diagnostic-${severity}` }).range(
          line.from,
          line.to,
        ),
      );
    }
  }
  return Decoration.set(ranges, true);
}

const diagnosticsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setDiagnostics)) return decorationsFor(transaction.state.doc, effect.value);
    }
    return transaction.docChanged ? decorations.map(transaction.changes) : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function diagnosticsExtension(): Extension {
  return diagnosticsField;
}
