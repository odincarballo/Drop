/** @jest-environment node */

import { createHash } from 'node:crypto';
import {
  createServer,
  request,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetch as partialFetch } from 'expo/fetch';

import { apiUrl } from '@/services/api';
import { jobSchema } from '@/models/media';
import {
  resumableResource,
  transferDownloadPartial,
} from '@/services/downloadResumption';
import {
  appendDownloadPartial,
  type DownloadPartialCheckpoint,
} from '@/services/downloadRecovery';

jest.mock('@/services/token', () => ({
  getApiToken: async () => 'fixture-token',
}));
jest.mock('@/services/api', () => ({ apiUrl: jest.fn() }));
jest.mock('expo/fetch', () => ({
  fetch: jest.fn((url: string, options: RequestInit) =>
    mockLocalFetch(url, options),
  ),
}));
jest.mock('@/services/downloadRecovery', () => ({
  appendDownloadPartial: jest.fn(),
  maxPartialBytes: 100 * 1_048_576,
  maxPartialChunkBytes: 1_048_576,
}));

const full = Buffer.alloc(1_048_579, 0x41);
const sha256 = createHash('sha256').update(full).digest('hex');
const id = 'a'.repeat(32);
const etag = `"sha256-${sha256}"`;
const path = `/jobs/${id}/file`;
const job = {
  id,
  status: 'COMPLETED',
  progress: 1,
  bytesDownloaded: full.length,
  totalBytes: full.length,
  fileSize: full.length,
  fileName: 'fixture.mp4',
  downloadUrl: path,
  fileSha256: sha256,
  fileContentType: 'video/mp4',
  error: null,
} as const;
const empty = createHash('sha256').digest('hex');
const checkpoint: DownloadPartialCheckpoint = {
  id: 'local-attempt',
  generation: 1,
  remoteJobId: id,
  sha256,
  etag,
  totalBytes: full.length,
  confirmedBytes: 0,
  prefixSha256: empty,
};

let testOrigin: string;

function mockLocalFetch(url: string, options: RequestInit) {
  if (new URL(url).origin !== testOrigin)
    throw new Error('Non-loopback fixture request');
  return new Promise((resolve, reject) => {
    const outbound = request(
      url,
      {
        method: options.method,
        headers: options.headers as OutgoingHttpHeaders,
        signal: options.signal ?? undefined,
      },
      (response) => {
        const iterator = response[Symbol.asyncIterator]();
        resolve({
          status: response.statusCode,
          headers: { get: (key: string) => response.headers[key] ?? null },
          body: {
            getReader: () => ({
              read: () => iterator.next(),
              releaseLock: () => undefined,
            }),
          },
        });
      },
    );
    outbound.once('error', reject);
    outbound.end();
  });
}

async function fixture<T>(
  handler: (
    headers: import('node:http').IncomingHttpHeaders,
    response: ServerResponse,
  ) => void,
  action: () => Promise<T>,
) {
  const server = createServer((request, response) => {
    if (request.url === path) handler(request.headers, response);
    else response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  testOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  jest.mocked(apiUrl).mockImplementation((relative) => testOrigin + relative);
  try {
    return await action();
  } finally {
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }
}

function sendRange(
  response: ServerResponse,
  start: number,
  end: number,
  extra = {},
) {
  response.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${full.length}`,
    'Content-Length': String(end - start + 1),
    'Content-Type': 'video/mp4',
    ETag: etag,
    ...extra,
  });
  response.end(full.subarray(start, end + 1));
}

test('old jobs remain readable and only C.1 jobs within quota use resumable transport', () => {
  expect(resumableResource(jobSchema.parse(job))).toEqual({
    remoteJobId: id,
    sha256,
    etag,
    totalBytes: full.length,
  });
  const legacy = jobSchema.parse({
    ...job,
    fileSha256: undefined,
    fileContentType: undefined,
  });
  expect(resumableResource(legacy)).toBeNull();
  expect(resumableResource({ ...job, fileSize: 101 * 1_048_576 })).toBeNull();
});

test('interruption after a checkpoint requests only the remainder on explicit resume', async () => {
  expect(resumableResource(job)).toMatchObject({
    remoteJobId: checkpoint.remoteJobId,
    etag: checkpoint.etag,
  });
  const ranges: string[] = [];
  let saved = checkpoint;
  jest
    .mocked(appendDownloadPartial)
    .mockImplementation(async (record, bytes) => {
      const offset = record.confirmedBytes + bytes.length;
      expect(
        Buffer.compare(
          Buffer.from(bytes),
          full.subarray(record.confirmedBytes, offset),
        ),
      ).toBe(0);
      saved = {
        ...record,
        confirmedBytes: offset,
        prefixSha256: createHash('sha256')
          .update(full.subarray(0, offset))
          .digest('hex'),
      };
      return saved;
    });
  await fixture(
    (headers, response) => {
      expect(headers['if-range']).toBe(etag);
      expect(headers['accept-encoding']).toBe('identity');
      ranges.push(headers.range!);
      if (ranges.length === 2) response.destroy();
      else
        sendRange(
          response,
          ranges.length === 1 ? 0 : 1_048_576,
          ranges.length === 1 ? 1_048_575 : full.length - 1,
        );
    },
    async () => {
      await expect(
        transferDownloadPartial(job, saved, new AbortController().signal),
      ).rejects.toThrow(/socket hang up/);
      expect(partialFetch).toHaveBeenCalledWith(
        testOrigin + path,
        expect.any(Object),
      );
      expect(saved.confirmedBytes).toBe(1_048_576);
      await expect(
        transferDownloadPartial(job, saved, new AbortController().signal),
      ).resolves.toMatchObject({
        confirmedBytes: full.length,
        prefixSha256: sha256,
      });
    },
  );
  expect(ranges).toEqual([
    'bytes=0-1048575',
    'bytes=1048576-1048578',
    'bytes=1048576-1048578',
  ]);
});

test.each([
  '200',
  '416',
  'etag',
  'content-range',
  'coding',
  'wrong-length',
  'truncated',
] as const)(
  'incompatible %s never confirms bytes or issues a second GET',
  async (failure) => {
    let requests = 0;
    await fixture(
      (_, response) => {
        requests++;
        if (failure === '200' || failure === '416')
          response.writeHead(Number(failure)).end();
        else if (failure === 'truncated') {
          response.writeHead(206, {
            'Content-Range': `bytes 0-1048575/${full.length}`,
            'Content-Length': '1048576',
            ETag: etag,
            'Content-Type': 'video/mp4',
          });
          response.write('x', () => response.destroy());
        } else {
          const headers =
            failure === 'etag'
              ? { ETag: 'W/' + etag }
              : failure === 'content-range'
                ? { 'Content-Range': `bytes 1-1048576/${full.length}` }
                : failure === 'coding'
                  ? { 'Content-Encoding': 'gzip' }
                  : { 'Content-Length': '10' };
          sendRange(response, 0, 1_048_575, headers);
        }
      },
      async () => {
        if (failure !== 'truncated')
          await expect(
            transferDownloadPartial(
              job,
              checkpoint,
              new AbortController().signal,
            ),
          ).rejects.toMatchObject({ code: 'RESUME_INCOMPATIBLE' });
        else
          await expect(
            transferDownloadPartial(
              job,
              checkpoint,
              new AbortController().signal,
            ),
          ).rejects.toThrow();
      },
    );
    expect(requests).toBe(1);
    expect(appendDownloadPartial).not.toHaveBeenCalled();
  },
);

test('server identity, abort and a stale checkpoint each stop additional requests', async () => {
  let requests = 0;
  const signal = new AbortController();
  signal.abort();
  jest.mocked(appendDownloadPartial).mockResolvedValue(null);
  await fixture(
    (_, response) => {
      requests++;
      sendRange(response, 0, 1_048_575);
    },
    async () => {
      await expect(
        transferDownloadPartial(
          { ...job, id: 'b'.repeat(32) },
          checkpoint,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      await expect(
        transferDownloadPartial(job, checkpoint, signal.signal),
      ).rejects.toThrow();
      expect(requests).toBe(0);
      await expect(
        transferDownloadPartial(job, checkpoint, new AbortController().signal),
      ).rejects.toThrow();
      expect(requests).toBe(1);
    },
  );
});

test('cancelling an active range leaves its incomplete block uncommitted', async () => {
  const controller = new AbortController();
  let serverStarted: () => void;
  const seen = new Promise<void>((resolve) => {
    serverStarted = resolve;
  });
  await fixture(
    (_, response) => {
      response.writeHead(206, {
        'Content-Range': `bytes 0-1048575/${full.length}`,
        'Content-Length': '1048576',
        ETag: etag,
        'Content-Type': 'video/mp4',
      });
      response.write('x');
      serverStarted();
    },
    async () => {
      const transfer = transferDownloadPartial(
        job,
        checkpoint,
        controller.signal,
      );
      const outcome = expect(transfer).rejects.toThrow();
      await Promise.race([seen, transfer]);
      controller.abort();
      await outcome;
    },
  );
  expect(appendDownloadPartial).not.toHaveBeenCalled();
});

test('an expired file returns an explicit expiration without another request', async () => {
  let requests = 0;
  await fixture(
    (_, response) => {
      requests++;
      response.writeHead(404).end();
    },
    async () => {
      await expect(
        transferDownloadPartial(job, checkpoint, new AbortController().signal),
      ).rejects.toMatchObject({
        code: 'FILE_EXPIRED',
      });
    },
  );
  expect(requests).toBe(1);
  expect(appendDownloadPartial).not.toHaveBeenCalled();
});
