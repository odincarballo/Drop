import { z } from 'zod';

import { config } from '@/config';

type URLValidation =
  { valid: true; url: string } | { valid: false; message: string };
const urlSchema = z.url({ protocol: /^https?$/ }).max(config.maxUrlLength);

export function validateMediaUrl(input: string): URLValidation {
  const url = input.trim();
  if (!url)
    return { valid: false, message: 'Pega o escribe una URL para analizar.' };
  if (url.length > config.maxUrlLength) {
    return { valid: false, message: 'La URL es demasiado larga.' };
  }
  if (!urlSchema.safeParse(url).success) {
    return {
      valid: false,
      message: 'Introduce una URL completa que empiece por http:// o https://.',
    };
  }
  const parsed = new URL(url);
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      message: 'Utiliza un enlace sin usuario ni contraseña incluidos.',
    };
  }
  return { valid: true, url };
}
