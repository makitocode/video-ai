import { config } from '@/server/config';
import { AssemblyAiTranscriptionProvider } from './assemblyai';
import { MockTranscriptionProvider } from './mock';
import type { TranscriptionProvider } from './types';

/**
 * Selecciona el proveedor según la configuración. Sin clave, el simulado; con clave, el real.
 * Ningún otro archivo necesita saber cuál está activo.
 */
export function getTranscriptionProvider(): TranscriptionProvider {
  if (config.transcription === 'assemblyai' && config.assemblyAiKey !== undefined) {
    return new AssemblyAiTranscriptionProvider(config.assemblyAiKey);
  }
  return new MockTranscriptionProvider();
}

export type { TranscriptionProvider, TranscriptionResult } from './types';
