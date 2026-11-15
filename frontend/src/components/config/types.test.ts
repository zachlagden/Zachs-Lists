import { describe, expect, it } from 'vitest';
import { groupByCategory, parseConfig, serializeConfig, serializeLine } from './types';

const roundTrip = (config: string): string => serializeConfig(parseConfig(config));

describe('visual editor config round trip', () => {
  it('keeps a four-field line untouched', () => {
    const config =
      'https://example.com/custom.txt|custom_tracking|tracking|abp\n' +
      'https://example.com/hosts.txt|example|advertising';
    expect(roundTrip(config)).toBe(config);
    const [flagged, plain] = parseConfig(config);
    expect(flagged).toMatchObject({ name: 'custom_tracking', category: 'tracking', abp: true });
    expect(plain.abp).toBe(false);
    expect(groupByCategory(parseConfig(config)).tracking).toHaveLength(1);
  });

  it('keeps two-field, one-field and comment lines as written', () => {
    const config = [
      '# Sources',
      '  # indented comment  ',
      'https://example.com/two.txt|two_fields',
      'https://example.com/one.txt',
      '  https://example.com/spaced.txt | spaced | tracking  ',
      'https://example.com/unknown.txt|unknown|not_a_category|ABP',
    ].join('\n');
    expect(roundTrip(config)).toBe(config);
  });

  it('keeps carriage returns of lines it keeps', () => {
    const config = '# Sources\r\nhttps://example.com/hosts.txt|example|tracking|abp\r';
    expect(roundTrip(config)).toBe(config);
  });

  it('drops blank lines and one-field lines that are not URLs', () => {
    const config = '# Sources\n\nhttps://example.com/hosts.txt|example|tracking\n\nnot-a-url\n';
    expect(roundTrip(config)).toBe('# Sources\nhttps://example.com/hosts.txt|example|tracking');
  });

  it('writes a line added in the editor with its flag', () => {
    const added = { url: 'https://example.com/new.txt', name: 'new', category: 'nsfw' };
    expect(serializeLine(added)).toBe('https://example.com/new.txt|new|nsfw');
    expect(serializeLine({ ...added, abp: true })).toBe('https://example.com/new.txt|new|nsfw|abp');
  });
});
