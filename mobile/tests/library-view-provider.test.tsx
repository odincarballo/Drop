import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import {
  LibraryViewProvider,
  useLibraryView,
} from '@/providers/LibraryViewProvider';

const key = 'drop.library.view.v1';
function Probe() {
  const { viewMode, setViewMode } = useLibraryView();
  return (
    <>
      <Text testID="mode">{viewMode}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="grid"
        onPress={() => setViewMode('grid')}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="list"
        onPress={() => setViewMode('list')}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="toggle"
        onPress={() =>
          setViewMode((mode) => (mode === 'grid' ? 'list' : 'grid'))
        }
      />
    </>
  );
}
function app() {
  return (
    <LibraryViewProvider>
      <Probe />
    </LibraryViewProvider>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  await AsyncStorage.clear();
});

test.each([null, 'list', 'grid', 'invalid', 'GRID', ''])(
  'hydrates %s without writing defaults',
  async (saved) => {
    const get = jest
      .spyOn(AsyncStorage, 'getItem')
      .mockResolvedValueOnce(saved);
    const set = jest.spyOn(AsyncStorage, 'setItem');
    await render(app());
    await waitFor(() => expect(get).toHaveBeenCalledWith(key));
    expect(screen.getByTestId('mode').props.children).toBe(
      saved === 'grid' ? 'grid' : 'list',
    );
    expect(set).not.toHaveBeenCalled();
  },
);

test('read failure keeps list functional and allows a later choice to persist', async () => {
  jest
    .spyOn(AsyncStorage, 'getItem')
    .mockRejectedValueOnce(new Error('read failure'));
  await render(app());
  expect(screen.getByTestId('mode').props.children).toBe('list');
  await fireEvent.press(screen.getByRole('button', { name: 'grid' }));
  await waitFor(async () =>
    expect(await AsyncStorage.getItem(key)).toBe('grid'),
  );
});

test('late read cannot overwrite a recent choice and writes wait for initial read', async () => {
  const read = deferred<string | null>();
  jest.spyOn(AsyncStorage, 'getItem').mockReturnValueOnce(read.promise);
  const set = jest.spyOn(AsyncStorage, 'setItem');
  await render(app());
  await fireEvent.press(screen.getByRole('button', { name: 'grid' }));
  expect(screen.getByTestId('mode').props.children).toBe('grid');
  expect(set).not.toHaveBeenCalled();
  await act(async () => read.resolve('list'));
  await waitFor(() => expect(set).toHaveBeenCalledWith(key, 'grid'));
  expect(screen.getByTestId('mode').props.children).toBe('grid');
});

test('rapid writes serialize so later operations cannot resolve out of order', async () => {
  const first = deferred<void>();
  const set = jest
    .spyOn(AsyncStorage, 'setItem')
    .mockImplementationOnce(() => first.promise);
  await render(app());
  await fireEvent.press(screen.getByRole('button', { name: 'grid' }));
  await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByRole('button', { name: 'list' }));
  await fireEvent.press(screen.getByRole('button', { name: 'toggle' }));
  expect(screen.getByTestId('mode').props.children).toBe('grid');
  expect(set).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve());
  await waitFor(() =>
    expect(set.mock.calls.map((call) => call[1])).toEqual([
      'grid',
      'list',
      'grid',
    ]),
  );
  expect(await AsyncStorage.getItem(key)).toBe('grid');
});

test('write failure does not roll back UI or prevent subsequent successful writes', async () => {
  jest
    .spyOn(AsyncStorage, 'setItem')
    .mockRejectedValueOnce(new Error('write failure'));
  await render(app());
  await fireEvent.press(screen.getByRole('button', { name: 'grid' }));
  expect(screen.getByTestId('mode').props.children).toBe('grid');
  expect(await AsyncStorage.getItem(key)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'list' }));
  await waitFor(async () =>
    expect(await AsyncStorage.getItem(key)).toBe('list'),
  );
});

test('new owner restores the last saved choice', async () => {
  const view = await render(app());
  await fireEvent.press(screen.getByRole('button', { name: 'grid' }));
  await waitFor(async () =>
    expect(await AsyncStorage.getItem(key)).toBe('grid'),
  );
  await view.unmount();
  await render(app());
  await waitFor(() =>
    expect(screen.getByTestId('mode').props.children).toBe('grid'),
  );
});

test('unmounted owner ignores pending read without writing anything', async () => {
  const read = deferred<string | null>();
  jest.spyOn(AsyncStorage, 'getItem').mockReturnValueOnce(read.promise);
  const set = jest.spyOn(AsyncStorage, 'setItem');
  const view = await render(app());
  await view.unmount();
  await act(async () => read.resolve('grid'));
  expect(set).not.toHaveBeenCalled();
});
