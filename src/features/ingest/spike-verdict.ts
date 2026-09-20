import type { AudioExtractionResult } from './types';
import type { MainThreadStats } from './use-main-thread-monitor';

/**
 * Evaluación automática contra los criterios de salida de la Fase 1
 * (doc/10-roadmap.md § Fase 1).
 *
 * El objetivo de un spike es responder sí o no a una hipótesis, no producir una sensación.
 * Por eso los umbrales viven en código y el veredicto se calcula, en vez de mirar los
 * números y opinar.
 */

/** "Extracción de 2 h de video en menos de 60 s" equivale a 120× tiempo real. */
const MIN_REALTIME_FACTOR = 120;

export type CriterionStatus = 'pass' | 'fail' | 'unknown';

export type Criterion = {
  id: string;
  label: string;
  target: string;
  measured: string;
  status: CriterionStatus;
};

export function evaluateSpike(
  result: AudioExtractionResult,
  mainThread: MainThreadStats,
): Criterion[] {
  const elapsedSeconds = result.elapsedMs / 1000;
  const realtimeFactor = elapsedSeconds > 0 ? result.mediaSeconds / elapsedSeconds : 0;

  // El monitor necesita haber observado frames para decir algo: con una extracción
  // muy corta puede no haber muestras suficientes.
  const hasFrameSamples = mainThread.frames > 10;

  return [
    {
      id: 'speed',
      label: 'Velocidad de extracción',
      target: `≥ ${MIN_REALTIME_FACTOR}× tiempo real (2 h en menos de 60 s)`,
      measured: `${realtimeFactor.toFixed(1)}×`,
      status: realtimeFactor >= MIN_REALTIME_FACTOR ? 'pass' : 'fail',
    },
    {
      id: 'main-thread',
      label: 'Bloqueo del hilo principal',
      target: '0 frames largos durante la extracción',
      measured: hasFrameSamples
        ? `${mainThread.longFrames} frames largos · peor frame ${mainThread.longestFrameMs.toFixed(0)} ms`
        : 'sin muestras suficientes',
      status: hasFrameSamples ? (mainThread.longFrames === 0 ? 'pass' : 'fail') : 'unknown',
    },
    {
      id: 'compression',
      label: 'Reducción de tamaño',
      target: 'el audio debe pesar una fracción mínima del original',
      measured: `${result.compressionRatio.toFixed(0)}× más pequeño`,
      // Un archivo que ya era casi todo audio (un MP3, por ejemplo) no puede
      // comprimirse 200×, y eso no invalida la hipótesis.
      status: result.compressionRatio >= 10 ? 'pass' : 'unknown',
    },
  ];
}

/** Segundos que tardaría en subirse un archivo a un ancho de banda dado. */
export function estimateUploadSeconds(bytes: number, megabitsPerSecond: number): number {
  return (bytes * 8) / (megabitsPerSecond * 1_000_000);
}
