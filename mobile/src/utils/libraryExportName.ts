import type { LibraryItem } from '@/models/library';

type NamedLibraryFile = Pick<
  LibraryItem,
  'title' | 'mediaType' | 'relativeMediaPath'
>;

const MAX_TITLE_CHARACTERS = 120;
const MAX_TITLE_UTF8_BYTES = 200;
const SUPPORTED_EXTENSIONS = new Set(['mp4', 'm4a', 'mp3', 'aac']);

export function libraryExportName(item: NamedLibraryFile): string {
  const extension = item.relativeMediaPath.split('.').at(-1)?.toLowerCase();
  if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('La extensión del archivo de Biblioteca no es válida.');
  }
  const fallback = item.mediaType === 'audio' ? 'Drop Audio' : 'Drop Video';
  const withoutMatchingExtension = item.title.replace(
    new RegExp(`\\.${extension}$`, 'i'),
    '',
  );
  const sanitized = withoutMatchingExtension
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  let bytes = 0;
  const characters: string[] = [];
  for (const character of sanitized) {
    if (characters.length >= MAX_TITLE_CHARACTERS) break;
    const point = character.codePointAt(0) ?? 0;
    const width =
      point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + width > MAX_TITLE_UTF8_BYTES) break;
    characters.push(character);
    bytes += width;
  }
  const trimmed = characters.join('').replace(/[.\s]+$/g, '');
  return `${trimmed || fallback}.${extension}`;
}
