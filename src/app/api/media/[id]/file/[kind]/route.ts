import { Readable } from 'node:stream';
import { buildMediaFileName } from '@/lib/transcript-export';
import { getMediaAsset, getMediaFile } from '@/server/repositories';
import { fileSize, readFileStream } from '@/server/storage';
import type { MediaFileKind } from '@/lib/domain';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; kind: string }> };

/**
 * Sirve un archivo de medios con soporte de rangos.
 *
 * El soporte de `Range` no es un extra: sin él, el `<video>` del navegador no puede saltar a
 * un momento concreto sin descargar el archivo entero, y toda la navegación por citas del
 * resumen dejaría de funcionar en la práctica.
 */
export async function GET(request: Request, { params }: Context) {
  const { id, kind: rawKind } = await params;
  if (rawKind !== 'audio' && rawKind !== 'source') {
    return new Response('Tipo inválido.', { status: 400 });
  }
  const kind: MediaFileKind = rawKind;

  const file = getMediaFile(id, kind);
  if (file === null) return new Response('Archivo no encontrado.', { status: 404 });

  const totalBytes = fileSize(file.storage_path);
  if (totalBytes === 0) return new Response('Archivo vacío.', { status: 404 });

  const contentType = file.content_type ?? 'application/octet-stream';
  const rangeHeader = request.headers.get('range');

  // Con `?download=1` se fuerza la descarga con un nombre derivado del video original.
  // Sin esto el navegador guarda el archivo como «audio.ogg», que no dice nada de a qué
  // grabación pertenece.
  const downloadHeaders: Record<string, string> = {};
  if (new URL(request.url).searchParams.get('download') === '1') {
    const asset = getMediaAsset(id);
    const extension = file.storage_path.split('.').pop() ?? 'bin';
    const fileName = buildMediaFileName(asset?.originalFilename ?? 'audio', extension);
    downloadHeaders['content-disposition'] = `attachment; filename="${fileName}"`;
  }

  if (rangeHeader === null) {
    const stream = Readable.toWeb(readFileStream(file.storage_path)) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      headers: {
        'content-type': contentType,
        'content-length': String(totalBytes),
        'accept-ranges': 'bytes',
        ...downloadHeaders,
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (match === null) {
    return new Response('Rango mal formado.', { status: 416 });
  }

  const [, rawStart, rawEnd] = match;
  const start = rawStart === '' ? 0 : Number(rawStart);
  const end = rawEnd === undefined || rawEnd === '' ? totalBytes - 1 : Number(rawEnd);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= totalBytes) {
    return new Response('Rango fuera de los límites.', {
      status: 416,
      headers: { 'content-range': `bytes */${totalBytes}` },
    });
  }

  const clampedEnd = Math.min(end, totalBytes - 1);
  const stream = Readable.toWeb(
    readFileStream(file.storage_path, { start, end: clampedEnd }),
  ) as ReadableStream<Uint8Array>;

  return new Response(stream, {
    status: 206,
    headers: {
      'content-type': contentType,
      'content-length': String(clampedEnd - start + 1),
      'content-range': `bytes ${start}-${clampedEnd}/${totalBytes}`,
      'accept-ranges': 'bytes',
      ...downloadHeaders,
    },
  });
}
