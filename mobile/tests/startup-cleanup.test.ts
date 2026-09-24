import { requireOptionalNativeModule } from 'expo';

import { cleanupAbandonedFilesAtStartup } from '@/services/fileExport';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/services/jobs', () => ({ withLocalFileLease: jest.fn() }));

test('runs native cache recovery once per JS process', () => {
  const cleanupAbandonedFiles = jest.fn().mockReturnValue({
    removed: 3,
    failures: 0,
  });
  jest.mocked(requireOptionalNativeModule).mockReturnValue({
    cleanupAbandonedFiles,
  });
  cleanupAbandonedFilesAtStartup();
  cleanupAbandonedFilesAtStartup();
  expect(cleanupAbandonedFiles).toHaveBeenCalledTimes(1);
});
