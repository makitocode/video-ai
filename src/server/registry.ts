import { config, DEFAULT_ANALYSIS_MODELS } from './config';
import { AnthropicAnalysisAdapter } from './adapters/analysis/anthropic';
import { MockAnalysisAdapter } from './adapters/analysis/mock';
import { OpenAiAnalysisAdapter } from './adapters/analysis/openai';
import { AssemblyAiTranscriptionAdapter } from './adapters/transcription/assemblyai';
import { MockTranscriptionAdapter } from './adapters/transcription/mock';
import { DEFAULT_SPEECH_MODELS } from './adapters/transcription/assemblyai';
import type { AnalysisPort } from './ports/analysis';
import type { TranscriptionPort } from './ports/transcription';

/**
 * Composición: el único sitio donde se decide qué adaptador ocupa cada puerto.
 *
 * El pipeline nunca importa un adaptador concreto; pide un puerto y recibe el que la
 * configuración diga. Añadir ElevenLabs o cambiar de LLM es escribir un adaptador y añadir
 * una rama aquí — nada más del sistema se entera.
 */

export function getTranscriptionPort(): TranscriptionPort {
  if (config.transcription === 'assemblyai' && config.assemblyAiKey !== undefined) {
    return new AssemblyAiTranscriptionAdapter(config.assemblyAiKey, {
      languageCode: config.transcriptionLanguage,
      speechModels: config.speechModels.length > 0 ? config.speechModels : DEFAULT_SPEECH_MODELS,
      prompt: config.transcriptionPrompt,
      keyterms: config.transcriptionKeyterms,
    });
  }
  return new MockTranscriptionAdapter();
}

export function getAnalysisPort(): AnalysisPort {
  const models = resolveModels(config.analysis);

  if (config.analysis === 'anthropic' && config.anthropicKey !== undefined) {
    return new AnthropicAnalysisAdapter(config.anthropicKey, models);
  }
  if (config.analysis === 'openai' && config.openAiKey !== undefined) {
    return new OpenAiAnalysisAdapter(config.openAiKey, models);
  }
  return new MockAnalysisAdapter();
}

/**
 * Modelo de cada fase: lo que diga la configuración, o el por defecto del proveedor.
 *
 * Se resuelve por fase y no de forma global porque los dos trabajos piden cosas distintas, y
 * poder medir cada uno por separado es el requisito para optimizar coste sin perder calidad a
 * ciegas.
 */
function resolveModels(provider: keyof typeof DEFAULT_ANALYSIS_MODELS): {
  identify: string;
  analyze: string;
} {
  const defaults = DEFAULT_ANALYSIS_MODELS[provider];
  return {
    identify: config.identifyModel ?? defaults.identify,
    analyze: config.analyzeModel ?? defaults.analyze,
  };
}
