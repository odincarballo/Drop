import { File } from 'expo-file-system';

import type { DownloadJob } from '@/models/media';
import { downloadJobFile } from '@/services/jobs';
import { getApiToken } from '@/services/token';

jest.mock('expo-file-system', () => ({
  File: Object.assign(jest.fn(), { createDownloadTask: jest.fn() }),
  Directory: jest.fn(),
  Paths: { cache: 'file:///cache' },
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));
jest.mock('@/services/api', () => ({
  apiUrl: jest.fn((path: string) => path),
}));
jest.mock('@/services/token', () => ({ getApiToken: jest.fn() }));

const job = {
  id: '0123456789abcdef0123456789abcdef',
  downloadUrl: '/jobs/0123456789abcdef0123456789abcdef/file',
  fileName: 'example.mp4',
} as DownloadJob;
const remove = jest.fn();
const release = jest.fn();
const downloadAsync = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getApiToken).mockResolvedValue('test-token');
  jest
    .mocked(File)
    .mockImplementation(() => ({ exists: true, delete: remove }) as never);
  jest.mocked(File.createDownloadTask).mockReturnValue({
    downloadAsync,
    release,
  } as never);
});

test('failed direct transfer removes its owned destination and can retry', async () => {
  downloadAsync.mockRejectedValueOnce(new Error('network lost'));
  await expect(
    downloadJobFile(job, new AbortController().signal, jest.fn()),
  ).rejects.toThrow('No se pudo transferir');
  expect(remove).toHaveBeenCalledTimes(2); // old destination and failed destination
  expect(release).toHaveBeenCalledTimes(1);

  downloadAsync.mockResolvedValueOnce({
    uri: 'file:///cache/example.mp4',
    size: 8,
  });
  await expect(
    downloadJobFile(job, new AbortController().signal, jest.fn()),
  ).resolves.toEqual({ uri: 'file:///cache/example.mp4', size: 8 });
  expect(release).toHaveBeenCalledTimes(2);
});

test('cancelled direct transfer removes its destination', async () => {
  const controller = new AbortController();
  downloadAsync.mockImplementationOnce(() => {
    controller.abort();
    return Promise.reject(new Error('cancelled'));
  });
  await expect(
    downloadJobFile(job, controller.signal, jest.fn()),
  ).rejects.toThrow('cancelled');
  expect(remove).toHaveBeenCalledTimes(2);
  expect(release).toHaveBeenCalledTimes(1);
});

test('a write failure does not expose a truncated direct file', async () => {
  downloadAsync.mockRejectedValueOnce(new Error('No space left on device'));
  await expect(
    downloadJobFile(job, new AbortController().signal, jest.fn()),
  ).rejects.toThrow('Revisa el espacio disponible');
  expect(remove).toHaveBeenCalledTimes(2);
  expect(release).toHaveBeenCalledTimes(1);
});
