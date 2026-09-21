import { config, DEFAULT_ANALYSIS_MODELS } from './config';
import { MockAnalysisAdapter } from './adapters/analysis/mock';
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
 *
 * Los adaptadores que dependen del SDK de un proveedor se cargan **dinámicamente**, dentro de
 * su rama: el SDK del proveedor que no se elige nunca llega a cargarse en memoria. Los dos
 * siguen siendo dependencias del proyecto y deben estar instalados para compilar —el bundler
 * resuelve las dos ramas—, así que esto no ahorra un `pnpm install`; lo que da es que un
 * proveedor mal configurado o un SDK que falle al inicializarse no afecte al que sí se usa.
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

export async function getAnalysisPort(): Promise<AnalysisPort> {
  const models = resolveModels(config.analysis);

  if (config.analysis === 'anthropic' && config.anthropicKey !== undefined) {
    const { AnthropicAnalysisAdapter } = await load(
      () => import('./adapters/analysis/anthropic'),
      '@anthropic-ai/sdk',
    );
    return new AnthropicAnalysisAdapter(config.anthropicKey, models, config.anthropicWorkspaceId);
  }
  if (config.analysis === 'openai' && config.openAiKey !== undefined) {
    const { OpenAiAnalysisAdapter } = await load(
      () => import('./adapters/analysis/openai'),
      'openai',
    );
    return new OpenAiAnalysisAdapter(config.openAiKey, models);
  }
  return new MockAnalysisAdapter();
}

/**
 * Carga un adaptador traduciendo el fallo de resolución a una instrucción.
 *
 * Que falte el SDK de un proveedor tiene una única causa realista —se añadió la dependencia y
 * no se instaló— y una única solución. Decirla aquí ahorra el rato de leer un «Cannot find
 * module» y deducir qué se hace con él.
 */
async function load<T>(importer: () => Promise<T>, packageName: string): Promise<T> {
  try {
    return await importer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(packageName)) {
      throw new Error(
        `Falta el paquete «${packageName}», que necesita el proveedor «${config.analysis}». ` +
          'Ejecuta `pnpm install` y reinicia el servidor.',
      );
    }
    throw error;
  }
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
