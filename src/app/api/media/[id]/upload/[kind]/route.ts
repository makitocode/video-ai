import { NextResponse } from 'next/server';
import {
  getMediaAsset,
  getMediaFile,
  recordUploadProgress,
  upsertMediaFile,
} from '@/server/repositories';
import { appendChunk, buildStoragePath, fileSize } from '@/server/storage';
import type { MediaFileKind } from '@/lib/domain';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; kind: string }> };

function parseKind(raw: string): MediaFileKind | null {
  return raw === 'audio' || raw === 'source' ? raw : null;
}

/**
 * Consulta cuántos bytes tiene ya el servidor.
 *
 * Es la primitiva que hace reanudable la subida: el cliente pregunta el offset y continúa
 * desde ahí. Es la misma idea del protocolo TUS que usa la versión en la nube, reducida a lo
 * imprescindible porque aquí no hay que hablar con un servicio externo.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id, kind: rawKind } = await params;
  const kind = parseKind(rawKind);
  if (kind === null) return NextResponse.json({ error: 'Tipo inválido.' }, { status: 400 });

  const file = getMediaFile(id, kind);
  if (file === null) return NextResponse.json({ bytesUploaded: 0, complete: false });

  return NextResponse.json({
    bytesUploaded: fileSize(file.storage_path),
    complete: file.upload_state === 'complete',
  });
}

/**
 * Añade un trozo al archivo.
 *
 * El cliente indica en qué offset cree estar; si no coincide con lo que hay en disco, se
 * rechaza con el offset real en vez de escribir datos desalineados. Un archivo de medios con
 * un hueco o un solape en medio es peor que una subida fallida: falla más tarde y de forma
 * más confusa.
 */
export async function POST(request: Request, { params }: Context) {
  const { id, kind: rawKind } = await params;
  const kind = parseKind(rawKind);
  if (kind === null) return NextResponse.json({ error: 'Tipo inválido.' }, { status: 400 });

  if (getMediaAsset(id) === null) {
    return NextResponse.json({ error: 'No existe ese análisis.' }, { status: 404 });
  }

  const offset = Number(request.headers.get('x-upload-offset') ?? '0');
  const totalBytes = Number(request.headers.get('x-total-bytes') ?? '0');
  const contentType = request.headers.get('x-file-type') ?? 'application/octet-stream';
  const extension = request.headers.get('x-file-extension') ?? 'bin';

  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return NextResponse.json({ error: 'Cabeceras de subida inválidas.' }, { status: 400 });
  }

  let file = getMediaFile(id, kind);
  if (file === null) {
    const storagePath = buildStoragePath(id, kind, extension);
    upsertMediaFile({ assetId: id, kind, storagePath, sizeBytes: totalBytes, contentType });
    file = getMediaFile(id, kind);
    if (file === null) {
      return NextResponse.json({ error: 'No se pudo registrar el archivo.' }, { status: 500 });
    }
  }

  const currentSize = fileSize(file.storage_path);
  if (offset !== currentSize) {
    return NextResponse.json(
      { error: 'Offset desalineado.', expectedOffset: currentSize },
      { status: 409 },
    );
  }

  const chunk = Buffer.from(await request.arrayBuffer());
  if (chunk.byteLength === 0) {
    return NextResponse.json({ error: 'Trozo vacío.' }, { status: 400 });
  }

  const bytesUploaded = await appendChunk(file.storage_path, chunk);
  const complete = bytesUploaded >= totalBytes;

  recordUploadProgress({ assetId: id, kind, bytesUploaded, complete });

  return NextResponse.json({ bytesUploaded, complete });
}
