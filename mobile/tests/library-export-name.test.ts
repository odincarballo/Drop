import { libraryExportName } from '@/utils/libraryExportName';

const file = (
  title: string,
  extension: string,
  mediaType: 'video' | 'audio' = 'video',
) => ({
  title,
  mediaType,
  relativeMediaPath: `Media/ad02362e-bd7c-498a-8f00-aaaaaaaaaaaa.${extension}`,
});

test('uses the saved title and real MP4/M4A extension', () => {
  expect(
    libraryExportName(file('Este video lo borraré en 48 horas', 'mp4')),
  ).toBe('Este video lo borraré en 48 horas.mp4');
  expect(libraryExportName(file('Podcast largo', 'm4a', 'audio'))).toBe(
    'Podcast largo.m4a',
  );
  expect(libraryExportName(file('Video.mp4', 'mp4'))).toBe('Video.mp4');
});

test('removes separators, invalid characters and repeated spaces', () => {
  expect(
    libraryExportName(file('  uno  / dos\\tres: * ? " < > |  ', 'mp4')),
  ).toBe('uno dos tres.mp4');
});

test('empty, dot-only and excessively long titles are safe', () => {
  expect(libraryExportName(file('', 'mp4'))).toBe('Drop Video.mp4');
  expect(libraryExportName(file('.', 'm4a', 'audio'))).toBe('Drop Audio.m4a');
  expect(libraryExportName(file('..', 'm4a', 'audio'))).toBe('Drop Audio.m4a');
  expect(
    Array.from(libraryExportName(file('x'.repeat(400), 'mp4'))).length,
  ).toBeLessThanOrEqual(124);
});

test('preserves the actual extension and never uses the physical UUID', () => {
  expect(libraryExportName(file('Título.mov', 'mp4'))).toBe('Título.mov.mp4');
  expect(libraryExportName(file('  ', 'aac', 'audio'))).toBe('Drop Audio.aac');
  expect(libraryExportName(file('Título', 'mp4'))).not.toContain('ad02362e');
  expect(() => libraryExportName(file('Video', 'part'))).toThrow('extensión');
});
