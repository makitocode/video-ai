'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_FILE_BYTES } from '@/lib/constants';
import { MediaWorkerClient } from './media-worker-client';
import { uploadInChunks } from './local-upload';
import type { AudioExtractionResult, ProbeResult } from './types';

/**
 * Orquesta la ingesta completa en el navegador.
 *
 * El orden de las operaciones **es** la arquitectura: se extrae el audio y se sube primero
 * (~22 MB) para que el análisis arranque en segundos, y sólo después se sube el video
 * original en segundo plano para poder reproducirlo. El usuario ve el transcript mientras el
 * video todavía se está copiando.
 *
 * Ver doc/04-ingesta-y-upload.md § 2.
 */

export type IngestPhase =
  'idle' | 'probing' | 'extracting' | 'uploading_audio' | 'starting' | 'analyzing' | 'error';

export type IngestState = {
  phase: IngestPhase;
  file: File | null;
  probe: ProbeResult | null;
  extraction: AudioExtractionResult | null;
  /** Progreso de la etapa actual del carril rápido, entre 0 y 1. */
  progress: number;
  /** Progreso de la copia del video original, que corre en paralelo. */
  sourceProgress: number;
  assetId: string | null;
  error: string | null;
};

const INITIAL: IngestState = {
  phase: 'idle',
  file: null,
  probe: null,
  extraction: null,
  progress: 0,
  sourceProgress: 0,
  assetId: null,
  error: null,
};

export function useIngest() {
  const [state, setState] = useState<IngestState>(INITIAL);
  const workerRef = useRef<MediaWorkerClient | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const getWorker = useCallback((): MediaWorkerClient => {
    workerRef.current ??= new MediaWorkerClient();
    return workerRef.current;
  }, []);

  useEffect(
    () => () => {
      workerRef.current?.dispose();
      abortRef.current?.abort();
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, []);

  const start = useCallback(
    async (file: File) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const fail = (message: string) =>
        setState((prev) => ({ ...prev, phase: 'error', error: message }));

      setState({ ...INITIAL, file, phase: 'probing' });

      if (file.size > MAX_FILE_BYTES) {
        fail('El archivo supera el límite configurado.');
        return;
      }

      try {
        // 1. Sondeo: decide la ruta antes de gastar CPU o disco.
        const probe = await getWorker().probe(file);
        setState((prev) => ({ ...prev, probe }));

        if (probe.route !== 'fast') {
          // La ruta de escape (subir el original y que el demux lo haga el proveedor) aún
          // no está implementada en la versión local: se dice claramente en vez de fallar
          // con un error críptico a mitad del proceso.
          fail(
            `${probe.routeReason} La ruta de escape todavía no está disponible en la versión local.`,
          );
          return;
        }

        // 2. Extracción del audio en un worker. Es lo que hace que todo lo demás sea rápido.
        setState((prev) => ({ ...prev, phase: 'extracting', progress: 0 }));
        const extraction = await getWorker().extractAudio(file, (update) => {
          setState((prev) => ({ ...prev, progress: update.progress }));
        });
        setState((prev) => ({ ...prev, extraction, progress: 1 }));

        // 3. Registro del asset en el servidor.
        const durationMs = Math.round(extraction.mediaSeconds * 1000);
        const assetId = await createAsset({
          originalFilename: file.name,
          sizeBytes: file.size,
          durationMs,
          container: probe.container,
          ingestRoute: probe.route,
        });
        setState((prev) => ({ ...prev, assetId }));

        // 4. Carril rápido: subir el audio. Segundos, no minutos.
        setState((prev) => ({ ...prev, phase: 'uploading_audio', progress: 0 }));
        await uploadInChunks({
          assetId,
          kind: 'audio',
          blob: extraction.blob,
          fileExtension: extraction.profile.fileExtension,
          contentType: extraction.profile.mimeType,
          signal: controller.signal,
          onProgress: (update) => setState((prev) => ({ ...prev, progress: update.progress })),
        });

        // 5. Arrancar el análisis sin esperar al video.
        setState((prev) => ({ ...prev, phase: 'starting' }));
        await startAnalysis(assetId, durationMs);
        setState((prev) => ({ ...prev, phase: 'analyzing' }));

        // 6. Carril lento: copiar el original en segundo plano, sólo para reproducirlo.
        //    Que falle aquí no invalida el análisis, que ya está en marcha.
        void uploadInChunks({
          assetId,
          kind: 'source',
          blob: file,
          fileExtension: extractExtension(file.name),
          contentType: file.type !== '' ? file.type : 'video/mp4',
          signal: controller.signal,
          onProgress: (update) =>
            setState((prev) => ({ ...prev, sourceProgress: update.progress })),
        }).catch(() => {
          // Silencioso a propósito: el usuario ya tiene su transcript. La interfaz
          // muestra que la copia del video no llegó al 100 %.
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        fail(error instanceof Error ? error.message : 'Fallo inesperado durante la ingesta.');
      }
    },
    [getWorker],
  );

  return { state, start, reset };
}

function extractExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? (parts.pop() ?? 'mp4') : 'mp4';
}

async function createAsset(input: {
  originalFilename: string;
  sizeBytes: number;
  durationMs: number;
  container: string;
  ingestRoute: string;
}): Promise<string> {
  const response = await fetch('/api/media', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) throw new Error('No se pudo registrar el análisis en el servidor.');
  return ((await response.json()) as { id: string }).id;
}

async function startAnalysis(assetId: string, durationMs: number): Promise<void> {
  const response = await fetch(`/api/media/${assetId}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ durationMs }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? 'No se pudo iniciar el análisis.');
  }
}
