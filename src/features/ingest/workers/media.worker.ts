/// <reference lib="webworker" />

/**
 * Worker de procesamiento de medios.
 *
 * Todo el trabajo pesado del pipeline de ingesta vive aquí para que el hilo principal no se
 * bloquee nunca. El presupuesto declarado en doc/06-frontend.md es explícito: 0 ms de bloqueo
 * del hilo principal durante la extracción, y es uno de los criterios de salida de la Fase 1.
 *
 * El protocolo de mensajes está en `../types.ts`.
 */

import { extractAudio } from '../extract-audio';
import { probeFile } from '../probe';
import type { MediaWorkerRequest, MediaWorkerResponse } from '../types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function reply(response: MediaWorkerResponse): void {
  ctx.postMessage(response);
}

/** Convierte cualquier excepción en un mensaje presentable, sin filtrar internals. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Error desconocido durante el procesamiento del archivo.';
}

async function handleProbe(requestId: string, file: File): Promise<void> {
  const result = await probeFile(file);
  reply({ kind: 'probe-result', requestId, result });
}

async function handleExtract(requestId: string, file: File): Promise<void> {
  reply({
    kind: 'progress',
    requestId,
    progress: { stage: 'probing', progress: 0, processedSeconds: 0 },
  });

  const probe = await probeFile(file);

  if (probe.audioProfile === null) {
    throw new Error(probe.routeReason);
  }

  const result = await extractAudio(file, probe.audioProfile, probe.durationSeconds, (progress) => {
    reply({ kind: 'progress', requestId, progress });
  });

  reply({ kind: 'extract-result', requestId, result });
}

ctx.addEventListener('message', (event: MessageEvent<MediaWorkerRequest>) => {
  const request = event.data;

  const task =
    request.kind === 'probe'
      ? handleProbe(request.requestId, request.file)
      : handleExtract(request.requestId, request.file);

  task.catch((error: unknown) => {
    reply({ kind: 'error', requestId: request.requestId, message: describeError(error) });
  });
});
