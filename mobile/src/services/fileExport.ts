import { requireOptionalNativeModule } from 'expo';

import type { LibraryItem } from '@/models/library';
import { withLocalFileLease } from '@/services/jobs';
import { libraryExportName } from '@/utils/libraryExportName';

type ExportResult = { status: 'saved' | 'cancelled' };
type DropFileExportNative = {
  saveToFiles(uri: string): Promise<ExportResult>;
  cleanupAbandonedFiles(): { removed: number; failures: number };
  createNamedExport(uri: string, name: string): Promise<{ uri: string }>;
  removeNamedExport(uri: string): Promise<void>;
};

let startupCleanupDone = false;

export function cleanupAbandonedFilesAtStartup(): void {
  if (startupCleanupDone) return;
  startupCleanupDone = true;
  try {
    const native =
      requireOptionalNativeModule<DropFileExportNative>('DropFileExport');
    if (!native) {
      console.warn('[Drop files] Native startup cleanup unavailable');
      return;
    }
    const result = native.cleanupAbandonedFiles();
    if (result.failures > 0) {
      console.warn(
        `[Drop files] Startup cleanup had ${result.failures} failure(s)`,
      );
    }
  } catch (error) {
    console.warn('[Drop files] Startup cleanup failed', error);
  }
}

export async function saveLocalFileToFiles(
  uri: string,
): Promise<'saved' | 'cancelled'> {
  const native =
    requireOptionalNativeModule<DropFileExportNative>('DropFileExport');
  if (!native) {
    throw new Error(
      'Esta versión de Drop no incluye Guardar en Archivos. Actualiza la app.',
    );
  }
  return withLocalFileLease(uri, async () => {
    const result = await native.saveToFiles(uri);
    if (result?.status !== 'saved' && result?.status !== 'cancelled') {
      throw new Error('No se pudo confirmar el resultado de Archivos.');
    }
    return result.status;
  });
}

export async function withNamedLibraryFile<T>(
  item: LibraryItem,
  operation: (uri: string) => Promise<T>,
): Promise<T> {
  const exporter =
    requireOptionalNativeModule<DropFileExportNative>('DropFileExport');
  if (!exporter?.createNamedExport || !exporter.removeNamedExport) {
    throw new Error(
      'Esta versión de Drop no puede preparar el nombre de exportación.',
    );
  }
  const alias = await exporter.createNamedExport(
    item.uri,
    libraryExportName(item),
  );
  if (!alias?.uri)
    throw new Error('No se pudo preparar el archivo para compartir.');
  try {
    return await operation(alias.uri);
  } finally {
    try {
      await exporter.removeNamedExport(alias.uri);
    } catch (error) {
      // A cold-start sweep removes abandoned DropExport aliases after a crash.
      console.warn('[Drop files] Could not clean named export alias', error);
    }
  }
}
