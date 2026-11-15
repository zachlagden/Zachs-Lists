export const AWKWARD_TEXTS: readonly string[] = [
  '',
  '\n',
  '\r\n',
  '\n\n\n',
  '# only a comment',
  '# only a comment\n',
  '# one\n# two\n\n# three',
  'https://example.com/a.txt',
  'https://example.com/a.txt|alpha|advertising\r\nhttps://example.com/b.txt|beta|tracking\r\n',
  'https://example.com/a.txt|alpha|advertising   \n\t# indented comment\t\n',
  'https://example.com/a.txt|alpha|advertising|abp\nhttps://example.com/a.txt|again|tracking',
  'https://example.com/a.txt|alpha|phising\nnot a source at all\n|||\n',
  'mixed\r\nline\nendings\rhere',
  'ends with a carriage return\r',
  'form\ffeed and \u2028 separator\n',
  '  \n \t \n',
];

const FRAGMENTS = [
  '',
  ' ',
  '\t',
  '# comment',
  'https://example.com/list.txt',
  'https://example.org/x|name',
  'https://example.org/x|name|tracking|abp',
  '  https://example.org/y|other|advertising  ',
  'https://example.org/z|third|unknown',
  '|',
  '@@example.com',
  '*.example.com',
  '/^ads[0-9]+\\./',
  'example.net # kept for sign-in',
];
const ENDINGS = ['\n', '\r\n', '\r', ''];

export function generatedTexts(count: number): string[] {
  let seed = 20240611;
  const next = (bound: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % bound;
  };
  return Array.from({ length: count }, () => {
    const lines = next(9);
    let text = '';
    for (let line = 0; line < lines; line += 1) {
      text += FRAGMENTS[next(FRAGMENTS.length)] + ENDINGS[next(ENDINGS.length)];
    }
    return text;
  });
}
