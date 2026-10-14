import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { CollectionPicker } from '@/components/CollectionPicker';
import type { CollectionSummary } from '@/models/collections';
import {
  createCollection,
  listCollections,
  listItemCollectionIds,
  setItemCollections,
} from '@/services/collections';

jest.mock('@/services/collections', () => ({
  createCollection: jest.fn(),
  listCollections: jest.fn(),
  listItemCollectionIds: jest.fn(),
  setItemCollections: jest.fn(),
}));
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({
      visible,
      children,
    }: {
      visible: boolean;
      children: unknown;
    }) => (visible ? React.createElement('View', null, children) : null),
  };
});
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const entries: CollectionSummary[] = [
  { id: 'a', name: 'Cursos', itemCount: 1, createdAt: 'now', updatedAt: 'now' },
  {
    id: 'b',
    name: 'Podcasts',
    itemCount: 0,
    createdAt: 'now',
    updatedAt: 'now',
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listCollections).mockResolvedValue(entries);
  jest.mocked(listItemCollectionIds).mockResolvedValue(['a']);
  jest.mocked(setItemCollections).mockResolvedValue(undefined);
  jest.mocked(createCollection).mockResolvedValue({
    id: 'c',
    name: 'Nueva',
    createdAt: 'now',
    updatedAt: 'now',
  });
});

test('loads memberships, toggles locally, and Cancelar does not write', async () => {
  const onClose = jest.fn();
  await render(<CollectionPicker visible itemId="item" onClose={onClose} />);
  await waitFor(() =>
    expect(
      screen.getByRole('checkbox', { name: 'Cursos' }).props.accessibilityState
        .checked,
    ).toBe(true),
  );
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Podcasts' }));
  expect(
    screen.getByRole('checkbox', { name: 'Podcasts' }).props.accessibilityState
      .checked,
  ).toBe(true);
  expect(setItemCollections).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cancelar selección de colecciones' }),
  );
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(setItemCollections).not.toHaveBeenCalled();
});

test('Listo submits one complete membership set despite a double tap', async () => {
  let resolveSave!: () => void;
  jest.mocked(setItemCollections).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const onClose = jest.fn();
  await render(<CollectionPicker visible itemId="item" onClose={onClose} />);
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Cursos' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Podcasts' }));
  const done = screen.getByRole('button', {
    name: 'Guardar selección de colecciones',
  });
  await fireEvent.press(done);
  await fireEvent.press(done);
  expect(setItemCollections).toHaveBeenCalledTimes(1);
  expect(setItemCollections).toHaveBeenCalledWith('item', ['a', 'b']);
  resolveSave();
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

test('failed save stays open with selection and safe error', async () => {
  jest
    .mocked(setItemCollections)
    .mockRejectedValue(new Error('SQL path /private/data'));
  const onClose = jest.fn();
  await render(<CollectionPicker visible itemId="item" onClose={onClose} />);
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Podcasts' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Podcasts' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Guardar selección de colecciones' }),
  );
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByRole('alert').props.children).not.toContain('/private');
  expect(
    screen.getByRole('checkbox', { name: 'Podcasts' }).props.accessibilityState
      .checked,
  ).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
});

test('creating a Collection selects it locally and waits for Listo to assign', async () => {
  const onClose = jest.fn();
  jest
    .mocked(listCollections)
    .mockResolvedValueOnce(entries)
    .mockResolvedValueOnce([
      ...entries,
      {
        id: 'c',
        name: 'Nueva',
        itemCount: 0,
        createdAt: 'now',
        updatedAt: 'now',
      },
    ]);
  await render(<CollectionPicker visible itemId="item" onClose={onClose} />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Nueva colección' }),
    ).toBeTruthy(),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Nueva colección' }),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Nombre de la nueva colección'),
    'Nueva',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Crear colección' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('checkbox', { name: 'Nueva' }).props.accessibilityState
        .checked,
    ).toBe(true),
  );
  expect(setItemCollections).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cancelar selección de colecciones' }),
  );
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(setItemCollections).not.toHaveBeenCalled();
});

test('late membership result for another item cannot replace the current selection', async () => {
  let resolveOld!: (ids: string[]) => void;
  jest
    .mocked(listItemCollectionIds)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce(['b']);
  const view = await render(
    <CollectionPicker visible itemId="old" onClose={jest.fn()} />,
  );
  expect(listItemCollectionIds).toHaveBeenCalledWith('old');
  await view.rerender(
    <CollectionPicker visible itemId="current" onClose={jest.fn()} />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole('checkbox', { name: 'Podcasts' }).props
        .accessibilityState.checked,
    ).toBe(true),
  );
  await act(async () => resolveOld(['a']));
  expect(
    screen.getByRole('checkbox', { name: 'Podcasts' }).props.accessibilityState
      .checked,
  ).toBe(true);
  expect(
    screen.getByRole('checkbox', { name: 'Cursos' }).props.accessibilityState
      .checked,
  ).toBe(false);
});

test('Listo cannot submit stale memberships before the current item has loaded', async () => {
  let resolveCurrent!: (ids: string[]) => void;
  jest.mocked(listItemCollectionIds).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveCurrent = resolve;
      }),
  );
  await render(
    <CollectionPicker visible itemId="current" onClose={jest.fn()} />,
  );
  const done = screen.getByRole('button', {
    name: 'Guardar selección de colecciones',
  });
  expect(done.props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(done);
  expect(setItemCollections).not.toHaveBeenCalled();
  await act(async () => resolveCurrent(['a']));
  await waitFor(() =>
    expect(
      screen.getByRole('checkbox', { name: 'Cursos' }).props.accessibilityState
        .checked,
    ).toBe(true),
  );
  expect(
    screen.getByRole('button', { name: 'Guardar selección de colecciones' })
      .props.accessibilityState.disabled,
  ).toBe(false);
});
