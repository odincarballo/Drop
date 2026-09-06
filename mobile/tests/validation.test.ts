import { validateMediaUrl } from '@/utils/validation';

test.each(['', ' ', '\n'])(
  'rejects empty input %j with a specific message',
  (input) => {
    expect(validateMediaUrl(input)).toEqual({
      valid: false,
      message: 'Pega o escribe una URL para analizar.',
    });
  },
);

test.each([
  'example.com/video',
  'nonsense',
  'ftp://example.com',
  'file:///tmp/file',
  'javascript:alert(1)',
  'https://',
  'https://user:secret@example.com',
  `https://example.com/${'a'.repeat(2048)}`,
])('rejects invalid input %s', (input) => {
  expect(validateMediaUrl(input).valid).toBe(false);
});

test.each([
  'https://example.com/video.mp4',
  'http://example.com/audio.mp3?token=test',
])('accepts HTTP(S) input %s', (url) => {
  expect(validateMediaUrl(`  ${url}  `)).toEqual({ valid: true, url });
});
