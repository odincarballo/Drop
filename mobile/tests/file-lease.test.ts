import { File } from 'expo-file-system';

import { deleteLocalFile, withLocalFileLease } from '@/services/jobs';

jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  Paths: { cache: 'file:///cache' },
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

const uri = 'file:///cache/test.mp4';
let remove: jest.Mock;

beforeEach(() => {
  remove = jest.fn();
  jest
    .mocked(File)
    .mockImplementation(() => ({ exists: true, delete: remove }) as never);
});

test('defers cleanup after New download until export finishes', async () => {
  let finish!: () => void;
  const pending = withLocalFileLease(
    uri,
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  deleteLocalFile(uri);
  expect(remove).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(remove).toHaveBeenCalledTimes(1);
});

test('releases the retained file after a picker error', async () => {
  let fail!: (error: Error) => void;
  const pending = withLocalFileLease(
    uri,
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  deleteLocalFile(uri);
  fail(new Error('picker failed'));
  await expect(pending).rejects.toThrow('picker failed');
  expect(remove).toHaveBeenCalledTimes(1);
});

test('multiple consumers retain file until the final one finishes', async () => {
  let first!: () => void;
  let second!: () => void;
  const a = withLocalFileLease(
    uri,
    () =>
      new Promise<void>((resolve) => {
        first = resolve;
      }),
  );
  const b = withLocalFileLease(
    uri,
    () =>
      new Promise<void>((resolve) => {
        second = resolve;
      }),
  );
  deleteLocalFile(uri);
  first();
  await a;
  expect(remove).not.toHaveBeenCalled();
  second();
  await b;
  expect(remove).toHaveBeenCalledTimes(1);
});
