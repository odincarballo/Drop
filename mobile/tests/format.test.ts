import {
  formatCodec,
  formatDuration,
  formatResolution,
  formatSize,
} from '@/utils/format';

test.each([
  [0, '0:00'],
  [59, '0:59'],
  [60, '1:00'],
  [754, '12:34'],
  [3723, '1:02:03'],
  [3600, '1:00:00'],
  [3599.9, '59:59'],
  [360000, '100:00:00'],
] as const)('formats %s seconds as %s', (input, expected) => {
  expect(formatDuration(input)).toBe(expected);
});

test.each([null, -1, NaN, Infinity])('handles unknown duration %s', (input) => {
  expect(formatDuration(input)).toBe('Duración desconocida');
});

test.each([
  [0, '0 B'],
  [999, '999 B'],
  [1000, '1 KB'],
  [1500, '1.5 KB'],
  [1_000_000, '1 MB'],
  [128_000_000, '128 MB'],
  [1_500_000_000, '1.5 GB'],
  [1_000_000_000_000, '1 TB'],
] as const)('formats %s bytes as %s', (input, expected) => {
  expect(formatSize(input)).toBe(expected);
});

test.each([null, -1, NaN, Infinity])('handles unknown size %s', (input) => {
  expect(formatSize(input)).toBe('Tamaño desconocido');
});

test('resolution labels never add a format', () => {
  expect(formatResolution('1920x1080')).toBe('1080p');
  expect(formatResolution('720p')).toBe('720p');
  expect(formatResolution('custom')).toBe('custom');
  expect(formatResolution(null)).toBe('Resolución desconocida');
  expect(formatCodec('h264')).toBe('H.264');
  expect(formatCodec('aac')).toBe('AAC');
});
