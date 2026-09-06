export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return 'Duración desconocida';
  }
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
}

export function formatSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return 'Tamaño desconocido';
  }
  if (bytes < 1000) return `${Math.floor(bytes)} B`;
  // Decimal SI units: 1 KB = 1000 bytes. These remain estimates, not promises.
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  const exponent = Math.min(Math.floor(Math.log10(bytes) / 3), units.length);
  return `${Number((bytes / 1000 ** exponent).toFixed(1))} ${units[exponent - 1]}`;
}

export function formatResolution(resolution: string | null): string {
  if (!resolution?.trim()) return 'Resolución desconocida';
  const dimensions = /^(\d+)x(\d+)$/i.exec(resolution);
  // Label only: the option still references the original server format.
  return dimensions ? `${dimensions[2]}p` : resolution;
}

export function formatCodec(codec: string | null): string {
  if (!codec?.trim()) return 'Codec desconocido';
  return codec.toLowerCase() === 'h264' ? 'H.264' : codec.toUpperCase();
}
