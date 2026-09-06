import { fireEvent, render, screen } from '@testing-library/react-native';

import { DownloadStatusCard } from '@/components/DownloadStatusCard';
import type { DownloadJob } from '@/models/media';

const job: DownloadJob = {
  id: 'job-1',
  status: 'DOWNLOADING',
  progress: 0.63,
  bytesDownloaded: 38_000_000,
  totalBytes: 60_000_000,
  fileName: 'clip.mp4',
  fileSize: null,
  error: null,
  downloadUrl: null,
};

test('shows real backend progress and cancellation', async () => {
  const cancel = jest.fn();
  await render(
    <DownloadStatusCard
      state={{ status: 'downloading', job }}
      onCancel={cancel}
      onShare={jest.fn()}
      onReset={jest.fn()}
    />,
  );
  expect(screen.getByText('Descargando…')).toBeTruthy();
  expect(screen.getByText('63 %')).toBeTruthy();
  expect(screen.getByText('38 MB / 60 MB')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(cancel).toHaveBeenCalledTimes(1);
});

test('shows completed filename and actions', async () => {
  const share = jest.fn();
  const reset = jest.fn();
  await render(
    <DownloadStatusCard
      state={{
        status: 'completed',
        job: {
          ...job,
          status: 'COMPLETED',
          progress: 1,
          bytesDownloaded: 60_000_000,
          fileSize: 60_000_000,
          downloadUrl: '/jobs/job-1/file',
        },
        localUri: 'file:///cache/clip.mp4',
        localSize: 60_000_000,
        actionError: null,
      }}
      onCancel={jest.fn()}
      onShare={share}
      onReset={reset}
    />,
  );
  expect(screen.getByText('✓ Descarga completada')).toBeTruthy();
  expect(screen.getByText('clip.mp4')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Compartir' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Nueva descarga' }));
  expect(share).toHaveBeenCalledTimes(1);
  expect(reset).toHaveBeenCalledTimes(1);
});
