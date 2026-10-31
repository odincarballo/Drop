import type { LibraryItem } from '@/models/library';
import { librarySortOptions, selectLibraryItems } from '@/utils/libraryQuery';
const make = (
  id: string,
  title: string,
  durationSeconds?: number | null,
  date = '2026-10-31',
) =>
  ({
    id,
    title,
    durationSeconds,
    downloadedAt: date,
    mediaType: 'audio',
    container: 'm4a',
    resolution: null,
    sourceVideoId: 'sourceId',
    availability: 'missing',
  }) as LibraryItem;
const rows = [
  make('a', 'Árbol música', 30),
  make('b', 'Zorro', null),
  make('c', 'arbol Música', 10, '2026-10-30'),
  make('d', 'Otro', undefined, '2026-10-29'),
];
const ids = (
  query = '',
  filter: 'all' | 'audio' | 'video' = 'all',
  sort: Parameters<typeof selectLibraryItems>[3] = 'recent',
) => selectLibraryItems(rows, query, filter, sort).map((r) => r.id);
test('title search folds accents, case, whitespace and requires every word in any order', () => {
  expect(ids('  MÚSICA   arBOL  ')).toEqual(['a', 'c']);
  expect(ids('arbol inexistente')).toEqual([]);
  expect(ids('m4a sourceID')).toHaveLength(4);
  expect(
    selectLibraryItems(
      [{ ...rows[0]!, resolution: '1080p' }],
      '1080P',
      'all',
      'recent',
    ),
  ).toHaveLength(1);
  expect(ids('   ')).toHaveLength(4);
  expect(ids('arbol', 'video')).toEqual([]);
  expect(ids('arbol', 'audio')).toEqual(['a', 'c']);
});
test.each([
  ['recent', ['b', 'a', 'c', 'd']],
  ['oldest', ['d', 'c', 'a', 'b']],
  ['title-asc', ['a', 'c', 'd', 'b']],
  ['title-desc', ['b', 'd', 'a', 'c']],
  ['duration-asc', ['c', 'a', 'b', 'd']],
  ['duration-desc', ['a', 'c', 'b', 'd']],
] as const)(
  '%s has deterministic ordering, with unknown durations last',
  (sort, expected) => {
    expect(ids('', 'all', sort)).toEqual(expected);
    expect(
      selectLibraryItems([...rows].reverse(), '', 'all', sort).map((r) => r.id),
    ).toEqual(expected);
  },
);
test('duplicate normalized titles and dates are resolved by ID; inputs and unavailable entries remain intact', () => {
  const data = Object.freeze([
    Object.freeze(make('a', 'Á', 0)),
    Object.freeze(make('b', 'a', NaN)),
    Object.freeze(make('c', 'a', -1)),
    Object.freeze(make('d', 'a', Infinity)),
  ]);
  for (const [sort] of librarySortOptions)
    expect(selectLibraryItems(data, '', 'all', sort)).toHaveLength(4);
  expect(
    selectLibraryItems(data, '', 'all', 'title-asc').map((r) => r.id),
  ).toEqual(['d', 'c', 'b', 'a']);
  expect(
    selectLibraryItems(data, '', 'all', 'duration-desc').map((r) => r.id),
  ).toEqual(['a', 'd', 'c', 'b']);
  expect(data.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
});
