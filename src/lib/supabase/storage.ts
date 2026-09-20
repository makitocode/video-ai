/**
 * Convención de rutas dentro del bucket `media`.
 *
 * El primer segmento es SIEMPRE el id del usuario: de ahí cuelga la política RLS de
 * storage.objects (ver supabase/migrations/*_storage.sql). Centralizar la construcción
 * de rutas aquí evita que una ruta mal formada abra un agujero de acceso.
 */

export const MEDIA_BUCKET = 'media';

export type MediaFileKind = 'audio' | 'proxy' | 'master' | 'waveform';

const FILE_NAMES: Record<MediaFileKind, (extension: string) => string> = {
  audio: (extension) => `audio.${extension}`,
  proxy: () => 'proxy.mp4',
  master: (extension) => `master.${extension}`,
  waveform: () => 'waveform.bin',
};

export function buildStoragePath(input: {
  userId: string;
  mediaAssetId: string;
  kind: MediaFileKind;
  extension?: string;
}): string {
  const fileName = FILE_NAMES[input.kind](input.extension ?? 'bin');
  return `${input.userId}/${input.mediaAssetId}/${fileName}`;
}
