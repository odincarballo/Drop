import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { CompletedFileActions } from '@/components/CompletedFileActions';
import {
  saveLocalFileToFiles,
  withNamedLibraryFile,
} from '@/services/fileExport';
import { withLibraryLease } from '@/services/library';

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
