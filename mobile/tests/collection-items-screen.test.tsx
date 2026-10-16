import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';

import { CollectionItemsView } from '@/components/CollectionItemsView';
import {
  getCollection,
  listCollectionItems,
  listUncollectedItems,
  removeItemFromCollection,
} from '@/services/collections';
import { deleteLibraryItem, withLibraryLease } from '@/services/library';
import { saveLocalFileToFiles } from '@/services/fileExport';
import { shareLocalFile } from '@/services/jobs';
import { playback } from '@/services/playback';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useFocusEffect: (callback: () => void) =>
    require('react').useEffect(callback, [callback]),
}));
jest.mock('@/components/CollectionPicker', () => ({
  CollectionPicker: ({
    visible,
    itemId,
  }: {
    visible: boolean;
    itemId: string | null;
  }) =>
    visible
      ? require('react').createElement('Text', null, `Picker ${itemId}`)
      : null,
}));
jest.mock('@/services/collections', () => ({
  getCollection: jest.fn(),
  listCollectionItems: jest.fn(),
  listUncollectedItems: jest.fn(),
  removeItemFromCollection: jest.fn(),
  observeCollections: jest.fn(() => jest.fn()),
}));
jest.mock('@/services/library', () => ({
  deleteLibraryItem: jest.fn(),
  withLibraryLease: jest.fn((_id, action) =>
    action({ uri: 'file:///library/a.m4a' }),
  ),
}));
jest.mock('@/services/fileExport', () => ({
  saveLocalFileToFiles: jest.fn(),
  withNamedLibraryFile: jest.fn((_item, action) =>
    action('file:///cache/friendly.m4a'),
  ),
}));
jest.mock('@/services/jobs', () => ({ shareLocalFile: jest.fn() }));
jest.mock('@/services/playback', () => ({
  playback: { startInContext: jest.fn() },
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const item = {
  id: 'item',
  title: 'Podcast',
  mediaType: 'audio',
  relativeMediaPath: 'Media/id.m4a',
  sizeBytes: 100,
  durationSeconds: 100,
  playbackPositionSeconds: 25,
  downloadedAt: '2026-10-01T00:00:00.000Z',
  completedAt: null,
  artworkUri: null,
  resolution: null,
} as const;
const collection = {
  id: 'c',
  name: 'Cursos',
  createdAt: 'now',
  updatedAt: 'now',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(playback.startInContext).mockResolvedValue({} as never);
  jest.mocked(getCollection).mockResolvedValue(collection);
  jest.mocked(listCollectionItems).mockResolvedValue([item] as never);
  jest.mocked(listUncollectedItems).mockResolvedValue([item] as never);
  jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
  jest.mocked(deleteLibraryItem).mockResolvedValue(undefined);
  jest.mocked(saveLocalFileToFiles).mockResolvedValue('saved');
  jest.mocked(shareLocalFile).mockResolvedValue(undefined);
});

test('detail reuses player, export, share, remove and delete flows', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await render(<CollectionItemsView kind="collection" collectionId="c" />);
  await waitFor(() => expect(screen.getByText('Podcast')).toBeTruthy());
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reproducir Podcast' }),
  );
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/player/item'));
  expect(playback.startInContext).toHaveBeenCalledWith('item', ['item']);
  await fireEvent.press(screen.getByText('Guardar en Archivos'));
  await waitFor(() => expect(saveLocalFileToFiles).toHaveBeenCalled());
  await fireEvent.press(screen.getByText('Compartir'));
  await waitFor(() => expect(shareLocalFile).toHaveBeenCalled());
  expect(withLibraryLease).toHaveBeenCalledTimes(2);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Colecciones de Podcast' }),
  );
  expect(screen.getByText('Picker item')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Quitar Podcast de Cursos' }),
  );
  await waitFor(() =>
    expect(removeItemFromCollection).toHaveBeenCalledWith('c', 'item'),
  );
  expect(deleteLibraryItem).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Eliminar'));
  const buttons = alert.mock.calls.at(-1)?.[2];
  if (Array.isArray(buttons)) buttons[1]?.onPress?.();
  await waitFor(() => expect(deleteLibraryItem).toHaveBeenCalledWith('item'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Volver a Colecciones' }),
  );
  expect(mockReplace).toHaveBeenCalledWith('/library?section=collections');
  alert.mockRestore();
});

test.each(['collection', 'uncollected'] as const)(
  '%s sends its rendered item order as the playback snapshot',
  async (kind) => {
    const next = { ...item, id: 'next', title: 'Podcast siguiente' };
    const rows = [next, item];
    jest.mocked(listCollectionItems).mockResolvedValue(rows as never);
    jest.mocked(listUncollectedItems).mockResolvedValue(rows as never);
    await render(
      kind === 'collection' ? (
        <CollectionItemsView kind="collection" collectionId="c" />
      ) : (
        <CollectionItemsView kind="uncollected" />
      ),
    );
    await waitFor(() =>
      expect(screen.getByText('Podcast siguiente')).toBeTruthy(),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Reproducir Podcast' }),
    );
    await waitFor(() => expect(playback.startInContext).toHaveBeenCalled());
    expect(playback.startInContext).toHaveBeenCalledWith('item', [
      'next',
      'item',
    ]);
  },
);

test('empty and missing collection are controlled', async () => {
  jest.mocked(listCollectionItems).mockResolvedValue([]);
  const view = await render(
    <CollectionItemsView kind="collection" collectionId="c" />,
  );
  await waitFor(() =>
    expect(screen.getByText('Esta colección está vacía.')).toBeTruthy(),
  );
  jest.mocked(getCollection).mockResolvedValue(null);
  view.rerender(<CollectionItemsView kind="collection" collectionId="other" />);
  await waitFor(() =>
    expect(screen.getByText('La colección ya no existe.')).toBeTruthy(),
  );
  expect(screen.queryByText('Esta colección está vacía.')).toBeNull();
});

test('Sin colección lists ready items, opens picker, and has explicit return', async () => {
  const view = await render(<CollectionItemsView kind="uncollected" />);
  await waitFor(() => expect(screen.getByText('Podcast')).toBeTruthy());
  await fireEvent.press(
    screen.getByRole('button', { name: 'Colecciones de Podcast' }),
  );
  expect(screen.getByText('Picker item')).toBeTruthy();
  expect(screen.queryByText('Quitar de «Cursos»')).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Volver a Colecciones' }),
  );
  expect(mockReplace).toHaveBeenCalledWith('/library?section=collections');
  jest.mocked(listUncollectedItems).mockResolvedValue([]);
  await view.rerender(
    <CollectionItemsView kind="collection" collectionId="c" />,
  );
  await view.rerender(<CollectionItemsView kind="uncollected" />);
  await waitFor(() =>
    expect(screen.getByText('No hay descargas sin colección.')).toBeTruthy(),
  );
});

test('late result from collection A cannot overwrite collection B', async () => {
  let resolveA!: (value: unknown) => void;
  jest.mocked(listCollectionItems).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveA = resolve as typeof resolveA;
      }),
  );
  const view = await render(
    <CollectionItemsView kind="collection" collectionId="a" />,
  );
  expect(listCollectionItems).toHaveBeenCalledWith('a');
  await view.rerender(
    <CollectionItemsView kind="collection" collectionId="b" />,
  );
  await waitFor(() => expect(screen.getByText('Podcast')).toBeTruthy());
  await act(async () => resolveA([{ ...item, id: 'old', title: 'Obsoleto' }]));
  expect(screen.queryByText('Obsoleto')).toBeNull();
  expect(screen.getByText('Podcast')).toBeTruthy();
});
