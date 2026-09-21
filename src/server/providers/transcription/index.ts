import { config } from '@/server/config';
import { AssemblyAiTranscriptionProvider, DEFAULT_SPEECH_MODELS } from './assemblyai';
import { MockTranscriptionProvider } from './mock';
import type { TranscriptionProvider } from './types';

/**
 * Selecciona el proveedor según la configuración. Sin clave, el simulado; con clave, el real.
 * Ningún otro archivo necesita saber cuál está activo.
 */
export function getTranscriptionProvider(): TranscriptionProvider {
  if (config.transcription === 'assemblyai' && config.assemblyAiKey !== undefined) {
    return new AssemblyAiTranscriptionProvider(config.assemblyAiKey, {
      languageCode: config.transcriptionLanguage,
      // Si no se configuró nada, el proveedor aplica su propia lista por defecto.
      speechModels: config.speechModels.length > 0 ? config.speechModels : DEFAULT_SPEECH_MODELS,
      prompt: config.transcriptionPrompt,
      keyterms: config.transcriptionKeyterms,
    });
  }
  return new MockTranscriptionProvider();
}

export type { TranscriptionProvider, TranscriptionResult } from './types';
