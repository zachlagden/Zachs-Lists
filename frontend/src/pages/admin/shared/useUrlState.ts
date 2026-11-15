import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { withSearchChanges, type SearchChanges } from './urlState';

export interface UrlState {
  params: URLSearchParams;
  update: (changes: SearchChanges) => void;
}

export function useUrlState(): UrlState {
  const [params, setParams] = useSearchParams();
  const latest = useRef(params);

  useEffect(() => {
    latest.current = params;
  }, [params]);

  const update = useCallback(
    (changes: SearchChanges) => {
      const next = new URLSearchParams(withSearchChanges(latest.current, changes));
      latest.current = next;
      setParams(next, { replace: true, preventScrollReset: true });
    },
    [setParams],
  );
  return { params, update };
}

export function useUrlText(
  url: UrlState,
  key: string,
  alongside?: SearchChanges,
): [string, (value: string) => void] {
  const { params, update } = url;
  const [text, setText] = useState(() => params.get(key) ?? '');
  const change = (value: string) => {
    setText(value);
    update({ ...alongside, [key]: value });
  };
  return [text, change];
}

export function useDebouncedValue<Value>(value: Value, delayMs: number): Value {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
