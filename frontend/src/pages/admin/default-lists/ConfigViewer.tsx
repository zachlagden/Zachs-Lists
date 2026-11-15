import { useDeferredValue, useId, useMemo, useState } from 'react';
import { CopyButton } from '../../../components/ui/CopyButton';
import { Input } from '../../../components/ui/Field';
import { lineCountLabel, matchingLines, numberedLines } from './defaultListFacts';

export interface ConfigViewerProps {
  title: string;
  text: string;
  emptyMessage: string;
}

export function ConfigViewer({ title, text, emptyMessage }: ConfigViewerProps) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const lines = useMemo(() => numberedLines(text), [text]);
  const shown = useMemo(() => matchingLines(lines, deferredQuery), [lines, deferredQuery]);

  return (
    <section aria-label={title} className="grid min-w-0 content-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-[13px] font-medium">{title}</h3>
        <CopyButton text={text} subject={title.toLowerCase()} />
      </div>
      <label htmlFor={searchId} className="sr-only">
        Search the {title.toLowerCase()}
      </label>
      <Input
        id={searchId}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search these lines"
        autoComplete="off"
        spellCheck={false}
      />
      <p role="status" className="num text-xs text-text-tertiary">
        {lineCountLabel(shown.length, lines.length)}
      </p>
      {lines.length === 0 ? (
        <p className="text-[13px] text-text-secondary">{emptyMessage}</p>
      ) : shown.length === 0 ? (
        <p className="text-[13px] text-text-secondary">No line contains that text.</p>
      ) : (
        <pre
          tabIndex={0}
          aria-label={`${title}, read only`}
          className="m-0 max-h-[420px] overflow-auto rounded-control border border-border bg-sunken py-2 font-mono text-[13px] leading-[1.6]"
        >
          {shown.map((line) => (
            <span key={line.number} className="flex">
              <span
                aria-hidden="true"
                className="num w-12 flex-none pr-3 text-right text-text-tertiary select-none"
              >
                {line.number}
              </span>
              <span className="pr-3 whitespace-pre">{line.text || ' '}</span>
            </span>
          ))}
        </pre>
      )}
    </section>
  );
}
