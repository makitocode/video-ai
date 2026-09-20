import * as tus from 'tus-js-client';
import { clientEnv } from '@/lib/env';
import { MEDIA_BUCKET } from '@/lib/supabase/storage';
import { TUS_CHUNK_BYTES } from '@/lib/constants';

export type UploadProgress = {
  bytesUploaded: number;
  bytesTotal: number;
  /** Entre 0 y 1. */
  progress: number;
};

export type ResumableUploadOptions = {
  file: Blob;
  storagePath: string;
  contentType: string;
  /** JWT del usuario. La política RLS de storage.objects decide si puede escribir ahí. */
  accessToken: string;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
};

/**
 * Sube un archivo a Supabase Storage con el protocolo TUS, directamente desde el navegador.
 *
 * Los bytes **no pasan por ningún servidor nuestro**: ni por Vercel (cuyo límite de 4,5 MB
 * por petición lo haría imposible de todos modos) ni por una Edge Function. La autorización
 * la resuelve la política RLS sobre `storage.objects`.
 *
 * Lo relevante de TUS no es la velocidad — el ancho de banda de subida es una constante
 * física — sino la **reanudabilidad**: una caída de red a los once minutos no reinicia desde
 * cero. Ver doc/04-ingesta-y-upload.md § 1.
 */
export function uploadResumable(options: ResumableUploadOptions): Promise<void> {
  const { file, storagePath, contentType, accessToken, onProgress, signal } = options;

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('La subida se canceló antes de empezar.'));
      return;
    }

    const upload = new tus.Upload(file, {
      endpoint: `${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        // Permite reanudar sobre un objeto parcialmente escrito en un intento anterior.
        'x-upsert': 'true',
      },
      // Supabase exige exactamente 6 MB por chunk; otro valor rompe la subida.
      chunkSize: TUS_CHUNK_BYTES,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      // Backoff exponencial ante cortes de red. El primer reintento es inmediato
      // porque muchos fallos son transitorios de un solo paquete.
      retryDelays: [0, 2_000, 4_000, 8_000, 16_000],
      metadata: {
        bucketName: MEDIA_BUCKET,
        objectName: storagePath,
        contentType,
        cacheControl: '3600',
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        onProgress?.({
          bytesUploaded,
          bytesTotal,
          progress: bytesTotal > 0 ? bytesUploaded / bytesTotal : 0,
        });
      },
      onSuccess: () => resolve(),
      onError: (error) => reject(error),
    });

    signal?.addEventListener('abort', () => {
      // `false` conserva el estado en el servidor para poder reanudar después.
      void upload.abort(false);
      reject(new Error('La subida se canceló.'));
    });

    // Reanuda desde el último chunk confirmado si existe una subida previa de
    // este mismo archivo; si no, empieza de cero.
    void upload.findPreviousUploads().then((previous) => {
      const [mostRecent] = previous;
      if (mostRecent !== undefined) upload.resumeFromPreviousUpload(mostRecent);
      upload.start();
    });
  });
}
