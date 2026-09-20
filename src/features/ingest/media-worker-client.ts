import type {
  AudioExtractionResult,
  ExtractionProgress,
  MediaWorkerRequest,
  MediaWorkerResponse,
  ProbeResult,
} from './types';

type PendingTask = {
  resolve: (value: never) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: ExtractionProgress) => void;
};

/**
 * Envoltura tipada sobre el worker de medios.
 *
 * Convierte el protocolo de mensajes en promesas, que es lo que la interfaz quiere consumir.
 * Mantiene un único worker vivo para no pagar el arranque en cada archivo.
 */
export class MediaWorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingTask>();
  private nextRequestId = 0;

  private ensureWorker(): Worker {
    if (this.worker !== null) return this.worker;

    const worker = new Worker(new URL('./workers/media.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.addEventListener('message', (event: MessageEvent<MediaWorkerResponse>) => {
      this.handleMessage(event.data);
    });

    // Un worker que muere deja promesas colgadas para siempre si no se rechazan.
    worker.addEventListener('error', (event) => {
      this.failAll(new Error(event.message || 'El worker de medios falló inesperadamente.'));
    });

    this.worker = worker;
    return worker;
  }

  private handleMessage(response: MediaWorkerResponse): void {
    const task = this.pending.get(response.requestId);
    if (task === undefined) return;

    switch (response.kind) {
      case 'progress':
        task.onProgress?.(response.progress);
        return;

      case 'probe-result':
      case 'extract-result':
        this.pending.delete(response.requestId);
        (task.resolve as (value: unknown) => void)(response.result);
        return;

      case 'error':
        this.pending.delete(response.requestId);
        task.reject(new Error(response.message));
        return;
    }
  }

  private failAll(error: Error): void {
    for (const task of this.pending.values()) task.reject(error);
    this.pending.clear();
  }

  private send<T>(
    request: Omit<MediaWorkerRequest, 'requestId'> & { requestId?: string },
    onProgress?: (progress: ExtractionProgress) => void,
  ): Promise<T> {
    const worker = this.ensureWorker();
    const requestId = `req-${this.nextRequestId++}`;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (value: never) => void,
        reject,
        onProgress,
      });
      worker.postMessage({ ...request, requestId } as MediaWorkerRequest);
    });
  }

  /** Examina el archivo: formato, pistas, duración y qué ruta debe seguir. */
  probe(file: File): Promise<ProbeResult> {
    return this.send<ProbeResult>({ kind: 'probe', file });
  }

  /** Extrae y recomprime la pista de audio, informando del progreso. */
  extractAudio(
    file: File,
    onProgress?: (progress: ExtractionProgress) => void,
  ): Promise<AudioExtractionResult> {
    return this.send<AudioExtractionResult>({ kind: 'extract-audio', file }, onProgress);
  }

  /** Libera el worker. Las tareas en vuelo se rechazan en vez de quedar colgadas. */
  dispose(): void {
    this.failAll(new Error('El procesamiento se canceló.'));
    this.worker?.terminate();
    this.worker = null;
  }
}
