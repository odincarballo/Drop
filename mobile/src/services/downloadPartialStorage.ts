import { requireOptionalNativeModule } from 'expo';

type NativePartialStorage = {
  appendPartialDownload(
    key: string,
    confirmedBytes: number,
    prefixSha256: string,
    totalBytes: number,
    bytes: Uint8Array,
  ): Promise<unknown>;
  verifyPartialDownload(
    key: string,
    confirmedBytes: number,
    prefixSha256: string,
  ): Promise<void>;
  discardPartialDownload(key: string): Promise<void>;
};

function nativeStorage() {
  const module =
    requireOptionalNativeModule<NativePartialStorage>('DropLibrary');
  if (!module?.appendPartialDownload) {
    throw new Error(
      'El almacenamiento de descargas parciales no está disponible.',
    );
  }
  return module;
}

export function appendPartialBytes(
  key: string,
  confirmedBytes: number,
  prefixSha256: string,
  totalBytes: number,
  bytes: Uint8Array,
) {
  return nativeStorage().appendPartialDownload(
    key,
    confirmedBytes,
    prefixSha256,
    totalBytes,
    bytes,
  );
}

export function verifyPartialBytes(
  key: string,
  confirmedBytes: number,
  prefixSha256: string,
) {
  return nativeStorage().verifyPartialDownload(
    key,
    confirmedBytes,
    prefixSha256,
  );
}

export function removePartialBytes(key: string) {
  return nativeStorage().discardPartialDownload(key);
}
