const safeMessages = new Set([
  'Escribe un nombre para la colección.',
  'El nombre debe tener 80 caracteres visibles o menos.',
  'El nombre contiene caracteres de control no permitidos.',
  '«Sin colección» es un nombre reservado.',
  'Ya existe una colección con ese nombre.',
  'La colección ya no existe.',
  'La descarga ya no está disponible.',
  'No se pudo actualizar Collections. Inténtalo de nuevo.',
]);

export function collectionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return safeMessages.has(message)
    ? message
    : 'No se pudo completar la acción. Inténtalo de nuevo.';
}
