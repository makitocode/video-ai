import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { MEDIA_DIR } from './config';
import type { MediaFileKind } from '@/lib/domain';

/**
 * Almacenamiento local en disco.
 *
 * Es el adaptador local del puerto que en la nube ocupa Supabase Storage. La convención de
 * rutas es la misma (`{assetId}/{archivo}`), de modo que migrar consiste en cambiar esta
 * implementación, no las llamadas.
 */

const FILE_NAMES: Record<MediaFileKind, (extension: string) => string> = {
  audio: (extension) => `audio.${extension}`,
  source: (extension) => `source.${extension}`,
};

export function buildStoragePath(assetId: string, kind: MediaFileKind, extension: string): string {
  return `${assetId}/${FILE_NAMES[kind](sanitizeExtension(extension))}`;
}

/**
 * Una extensión viene del nombre de archivo que eligió el usuario, así que es entrada no
 * confiable: se reduce a caracteres alfanuméricos para que no pueda contener separadores
 * de ruta ni secuencias `..`.
 */
function sanitizeExtension(extension: string): string {
  const clean = extension.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return clean.length > 0 ? clean.slice(0, 8) : 'bin';
}

/**
 * Resuelve una ruta de almacenamiento a una ruta absoluta dentro del directorio de datos.
 *
 * Aunque esta versión sea local y monousuario, la comprobación de contención sigue siendo
 * necesaria: la ruta se compone con datos que vienen del cliente, y un `..` colado escribiría
 * fuera del directorio de datos.
 */
export function resolveStoragePath(storagePath: string): string {
  const absolute = normalize(join(MEDIA_DIR, storagePath));
  const root = normalize(MEDIA_DIR);

  if (!absolute.startsWith(root + '/') && absolute !== root) {
    throw new Error('Ruta de almacenamiento fuera del directorio de datos.');
  }
  return absolute;
}

/** Añade un trozo al final de un archivo. Es la primitiva de la subida por chunks. */
export async function appendChunk(storagePath: string, chunk: Buffer): Promise<number> {
  const absolute = resolveStoragePath(storagePath);
  await mkdir(dirname(absolute), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(absolute, { flags: 'a' });
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(chunk);
  });

  return statSync(absolute).size;
}

export function fileSize(storagePath: string): number {
  const absolute = resolveStoragePath(storagePath);
  return existsSync(absolute) ? statSync(absolute).size : 0;
}

export function readFileStream(
  storagePath: string,
  range?: { start: number; end: number },
): ReturnType<typeof createReadStream> {
  return createReadStream(resolveStoragePath(storagePath), range);
}

export async function deleteAssetFiles(assetId: string): Promise<void> {
  await rm(resolveStoragePath(assetId), { recursive: true, force: true });
}
