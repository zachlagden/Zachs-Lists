import { parseDraft } from './lineDraft';
import { analyseSources } from './sourceLines';

export type { LibraryEntry } from '../../api/config';

export interface ConfigLine {
  url: string;
  name: string;
  category: string;
  abp: boolean;
  isComment: boolean;
}

export function parseConfig(config: string): ConfigLine[] {
  const lines: ConfigLine[] = [];
  for (const { parsed } of analyseSources(parseDraft(config), [])) {
    if (parsed.kind === 'comment') {
      lines.push({ url: '', name: '', category: '', abp: false, isComment: true });
    }
    if (parsed.kind === 'source') {
      lines.push({
        url: parsed.url,
        name: parsed.name,
        category: parsed.category ?? '',
        abp: parsed.abp,
        isComment: false,
      });
    }
    if (parsed.kind === 'unrecognised') {
      lines.push({ url: parsed.text, name: '', category: '', abp: false, isComment: false });
    }
  }
  return lines;
}
