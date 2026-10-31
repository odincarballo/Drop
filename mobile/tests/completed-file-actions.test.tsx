import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { CompletedFileActions } from '@/components/CompletedFileActions';
import {
  saveLocalFileToFiles,
  withNamedLibraryFile,
} from '@/services/fileExport';
import { withLibraryLease } from '@/services/library';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('@/services/fileExport', () => ({
  saveLocalFileToFiles: jest.fn(),
  withNamedLibraryFile: jest.fn((_item, operation) =>
    operation('file:///cache/DropExport/Friendly.mp4'),
  ),
}));
jest.mock('@/services/library', () => ({
  withLibraryLease: jest.fn((_id, operation) =>
    operation({ uri: 'file:///library/uuid.mp4' }),
  ),
}));

const uri = 'file:///cache/test.mp4';

test('shows saved only after document picker confirms it', async () => {
  let confirm!: (result: 'saved') => void;
  jest.mocked(saveLocalFileToFiles).mockImplementation(
    () =>
      new Promise((resolve) => {
        confirm = resolve;
      }),
  );
  const more = jest.fn();
  const next = jest.fn();
  await render(
    <CompletedFileActions
      uri={uri}
      onMoreOptions={more}
      onNewDownload={next}
    />,
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Guardar en Archivos' }),
  );
  expect(screen.queryByText('Guardado en Archivos.')).toBeNull();
  await act(async () => {
    confirm('saved');
  });
  expect(screen.getByText('Guardado en Archivos.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Más opciones' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Nueva descarga' }));
  expect(more).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledTimes(1);
});

test('cancellation does not show saved and permits retry', async () => {
  jest.mocked(saveLocalFileToFiles).mockResolvedValue('cancelled');
  await render(
    <CompletedFileActions
      uri={uri}
      onMoreOptions={jest.fn()}
      onNewDownload={jest.fn()}
    />,
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Guardar en Archivos' }),
  );
  expect(await screen.findByText('No se guardó el archivo.')).toBeTruthy();
  expect(screen.queryByText('Guardado en Archivos.')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Guardar en Archivos' }),
  ).toBeEnabled();
});

test('native export errors remain actionable', async () => {
  jest
    .mocked(saveLocalFileToFiles)
    .mockRejectedValue(new Error('No disponible'));
  await render(
    <CompletedFileActions
      uri={uri}
      onMoreOptions={jest.fn()}
      onNewDownload={jest.fn()}
    />,
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Guardar en Archivos' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('No disponible');
});

test('completed Library result exports a friendly alias while retaining its lease', async () => {
  jest.mocked(saveLocalFileToFiles).mockResolvedValue('saved');
  await render(
    <CompletedFileActions
      uri="file:///library/uuid.mp4"
      libraryId="item-1"
      onMoreOptions={jest.fn()}
      onNewDownload={jest.fn()}
    />,
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Guardar en Archivos' }),
  );
  expect(withLibraryLease).toHaveBeenCalledWith('item-1', expect.any(Function));
  expect(withNamedLibraryFile).toHaveBeenCalled();
  expect(saveLocalFileToFiles).toHaveBeenCalledWith(
    'file:///cache/DropExport/Friendly.mp4',
  );
  expect(await screen.findByText('Guardado en Archivos.')).toBeTruthy();
});

test('open uses the current saved Library ID after consecutive results, never the file URI', async () => {
  const props = { onMoreOptions: jest.fn(), onNewDownload: jest.fn() };
  const view = await render(
    <CompletedFileActions
      {...props}
      uri="file:///library/a.m4a"
      libraryId="a"
    />,
  );
  expect(mockPush).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Abrir archivo' }));
  expect(mockPush).toHaveBeenLastCalledWith('/player/a');
  await view.rerender(
    <CompletedFileActions
      {...props}
      uri="file:///library/b.m4a"
      libraryId="b"
    />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Abrir archivo' }));
  expect(mockPush).toHaveBeenLastCalledWith('/player/b');
  expect(JSON.stringify(mockPush.mock.calls)).not.toContain('file://');
});

test('legacy URI-only result does not invent a Library ID or expose open', async () => {
  await render(
    <CompletedFileActions
      uri={uri}
      onMoreOptions={jest.fn()}
      onNewDownload={jest.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Abrir archivo' })).toBeNull();
});
