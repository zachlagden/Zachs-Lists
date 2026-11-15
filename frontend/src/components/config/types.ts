import { parseDraft } from './lineDraft';
import { analyseSources } from './sourceLines';

export type { LibraryEntry } from '../../api/config';

export interface ConfigLine {
  url: string;
  isComment: boolean;
}

export function parseConfig(config: string): ConfigLine[] {
  const lines: ConfigLine[] = [];
  for (const { parsed } of analyseSources(parseDraft(config), [])) {
    if (parsed.kind === 'comment') lines.push({ url: '', isComment: true });
    if (parsed.kind === 'source') lines.push({ url: parsed.url, isComment: false });
    if (parsed.kind === 'unrecognised') lines.push({ url: parsed.text, isComment: false });
  }
  return lines;
}
