import type { MediaFileKind } from '@/lib/domain';

/**
 * Subida por trozos al API local.
 *
 * Es el adaptador local del puerto que en la nube ocupa `resumable-upload.ts` (TUS contra
 * Supabase Storage). Mantiene la misma forma —trozos, reanudación, progreso, cancelación—
 * porque los motivos no cambian al mover el destino:
 *
 * - **Reanudable**: preguntar al servidor cuánto tiene ya y continuar desde ahí.
 * - **Memoria acotada**: nunca se carga el archivo entero en RAM, se corta con `Blob.slice()`.
 * - **Progreso real**: bytes confirmados por el servidor, no estimados.
 *
 * Ver doc/04-ingesta-y-upload.md § 1.
 */

/** Más pequeño que los 6 MB de Supabase: en local la latencia es cero y afina el progreso. */
const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_RETRIES = 4;

export type UploadProgress = {
  bytesUploaded: number;
  bytesTotal: number;
  /** Entre 0 y 1. */
  progress: number;
};

export type LocalUploadOptions = {
  assetId: string;
  kind: MediaFileKind;
  blob: Blob;
  fileExtension: string;
  contentType: string;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
};

export async function uploadInChunks(options: LocalUploadOptions): Promise<void> {
  const { assetId, kind, blob, fileExtension, contentType, onProgress, signal } = options;
  const endpoint = `/api/media/${assetId}/upload/${kind}`;

  let offset = await readServerOffset(endpoint, signal);

  // Si el servidor ya tiene más bytes de los que trae este blob, la subida terminó antes.
  if (offset >= blob.size) {
    onProgress?.({ bytesUploaded: blob.size, bytesTotal: blob.size, progress: 1 });
    return;
  }

  while (offset < blob.size) {
    signal?.throwIfAborted();

    const chunk = blob.slice(offset, Math.min(offset + CHUNK_BYTES, blob.size));
    const result = await sendChunk({
      endpoint,
      chunk,
      offset,
      totalBytes: blob.size,
      contentType,
      fileExtension,
      signal,
    });

    offset = result.bytesUploaded;
    onProgress?.({
      bytesUploaded: offset,
      bytesTotal: blob.size,
      progress: blob.size > 0 ? offset / blob.size : 1,
    });
  }
}

async function readServerOffset(endpoint: string, signal?: AbortSignal): Promise<number> {
  const response = await fetch(endpoint, { signal });
  if (!response.ok) return 0;

  const payload = (await response.json()) as { bytesUploaded?: number };
  return payload.bytesUploaded ?? 0;
}

async function sendChunk(input: {
  endpoint: string;
  chunk: Blob;
  offset: number;
  totalBytes: number;
  contentType: string;
  fileExtension: string;
  signal?: AbortSignal;
}): Promise<{ bytesUploaded: number }> {
  let attempt = 0;
  let offset = input.offset;

  for (;;) {
    input.signal?.throwIfAborted();

    const response = await fetch(input.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-upload-offset': String(offset),
        'x-total-bytes': String(input.totalBytes),
        'x-file-type': input.contentType,
        'x-file-extension': input.fileExtension,
      },
      body: input.chunk,
      signal: input.signal,
    });

    if (response.ok) {
      return (await response.json()) as { bytesUploaded: number };
    }

    // 409 significa que el servidor tiene un offset distinto del que creíamos: no es un
    // error de red, es una desincronización. Se corrige y se reintenta sin gastar intento.
    if (response.status === 409) {
      const payload = (await response.json()) as { expectedOffset?: number };
      if (payload.expectedOffset !== undefined && payload.expectedOffset !== offset) {
        offset = payload.expectedOffset;
        continue;
      }
    }

    attempt++;
    if (attempt > MAX_RETRIES) {
      throw new Error(`La subida falló tras ${MAX_RETRIES} reintentos (HTTP ${response.status}).`);
    }

    // Backoff exponencial: 1 s, 2 s, 4 s, 8 s.
    await new Promise((resolve) => setTimeout(resolve, 2 ** (attempt - 1) * 1000));
  }
}
