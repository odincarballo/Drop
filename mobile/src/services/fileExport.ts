import { requireOptionalNativeModule } from 'expo';

import { withLocalFileLease } from '@/services/jobs';

type ExportResult = { status: 'saved' | 'cancelled' };
type DropFileExportNative = {
  saveToFiles(uri: string): Promise<ExportResult>;
};

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
