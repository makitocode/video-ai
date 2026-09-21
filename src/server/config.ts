import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Configuración de la versión local.
 *
 * El principio que rige este archivo: **la aplicación arranca sin configurar nada**. Sin
 * claves, el pipeline funciona de extremo a extremo con proveedores simulados, de modo que
 * la interfaz y el flujo completo se pueden probar sin gastar un céntimo ni dar de alta
 * ninguna cuenta.
 *
 * En cuanto aparece una clave en el entorno, ese proveedor pasa a ser el real. No hay ningún
 * otro interruptor que tocar.
 */

/** Todo el estado local vive aquí: base de datos y archivos de medios. */
export const DATA_DIR = process.env.VIDEO_AI_DATA_DIR ?? join(process.cwd(), '.data');
export const MEDIA_DIR = join(DATA_DIR, 'media');
export const DATABASE_PATH = join(DATA_DIR, 'video-ai.db');

export function ensureDataDirs(): void {
  mkdirSync(MEDIA_DIR, { recursive: true });
}

/** Lee una variable separada por comas y la deja limpia de espacios y entradas vacías. */
function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// `|| undefined` y no `?.trim()` a secas: una variable presente pero vacía tiene que
// comportarse igual que una ausente. Si no, se intentaría autenticar con una cadena vacía
// y el error sería un 401 críptico en vez del aviso de proveedor simulado.
const assemblyAiKey = process.env.ASSEMBLYAI_API_KEY?.trim() || undefined;
const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;
const anthropicWorkspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim() || undefined;
const openAiKey = process.env.OPENAI_API_KEY?.trim() || undefined;

export const config = {
  /** `mock` no requiere clave y produce un transcript diarizado sintético coherente. */
  transcription: assemblyAiKey ? ('assemblyai' as const) : ('mock' as const),
  assemblyAiKey,

  /**
   * Idioma del audio, en código ISO (`es`, `en`, …).
   *
   * Si se deja vacío, el proveedor lo detecta solo. Fijarlo es más fiable cuando ya se sabe:
   * la detección automática puede equivocarse con audio ruidoso o con alguna palabra suelta
   * en otro idioma, y un idioma mal detectado arruina el transcript entero.
   */
  transcriptionLanguage: process.env.TRANSCRIPTION_LANGUAGE?.trim() || undefined,

  /**
   * Modelos de transcripción, del preferido al de reserva.
   *
   * Es una lista ordenada: se intenta el primero y se cae al siguiente si no está disponible.
   * Sólo se toca para probar un modelo nuevo o volver a uno anterior.
   */
  speechModels: splitList(process.env.ASSEMBLYAI_SPEECH_MODELS),

  /**
   * Descripción del audio en lenguaje natural: dominio, escenario, de qué va la reunión.
   *
   * Es la palanca de precisión más rentable que existe sobre grabaciones reales. El modelo
   * usa esta descripción para desambiguar jerga y nombres propios que de otro modo
   * transcribiría mal.
   */
  transcriptionPrompt: process.env.TRANSCRIPTION_PROMPT?.trim() || undefined,

  /** Vocabulario exacto: nombres de personas, empresas, productos, siglas. */
  transcriptionKeyterms: splitList(process.env.TRANSCRIPTION_KEYTERMS),

  /**
   * Proveedor de análisis.
   *
   * Se elige explícitamente con ANALYSIS_PROVIDER; si no, gana la primera clave disponible.
   * Sin ninguna, el simulado.
   */
  analysis: resolveAnalysisProvider(),
  anthropicKey,

  /**
   * Workspace de Anthropic al que imputar el gasto.
   *
   * Las claves que crea hoy la Console tienen alcance de **organización**, y con ellas la API
   * no sabe a qué workspace cargar el gasto: responde 400 pidiendo la cabecera
   * `anthropic-workspace-id`. Esta variable la aporta. Sólo sobra con las claves de tipo
   * «Workspace», que ya lo llevan implícito y hoy figuran como heredadas.
   */
  anthropicWorkspaceId,
  openAiKey,

  /**
   * Modelo por fase.
   *
   * Las dos fases piden cosas distintas: identificar hablantes es deducción sobre texto largo
   * con salida corta; analizar es redacción y juicio con salida larga. Poder elegir modelo en
   * cada una permite medir el equilibrio coste/calidad sin tocar código.
   */
  identifyModel: process.env.ANALYSIS_MODEL_IDENTIFY?.trim() || undefined,
  analyzeModel: process.env.ANALYSIS_MODEL_ANALYZE?.trim() || undefined,
} as const;

/** Modelos por defecto de cada proveedor, por fase. */
export const DEFAULT_ANALYSIS_MODELS = {
  anthropic: { identify: 'claude-opus-5', analyze: 'claude-opus-5' },
  openai: { identify: 'gpt-6-astra', analyze: 'gpt-6-astra' },
  mock: { identify: 'mock-analysis-1', analyze: 'mock-analysis-1' },
} as const;

function resolveAnalysisProvider(): 'anthropic' | 'openai' | 'mock' {
  const requested = process.env.ANALYSIS_PROVIDER?.trim().toLowerCase();

  if (requested === 'anthropic' || requested === 'openai' || requested === 'mock') {
    return requested;
  }
  if (anthropicKey !== undefined) return 'anthropic';
  if (openAiKey !== undefined) return 'openai';
  return 'mock';
}

/** Resumen legible del estado de configuración, para mostrarlo en la interfaz. */
export function describeProviders(): {
  transcription: { provider: string; real: boolean; hint: string };
  summary: { provider: string; real: boolean; hint: string };
} {
  return {
    transcription: {
      provider: config.transcription,
      real: config.transcription !== 'mock',
      hint:
        config.transcription === 'mock'
          ? 'Transcripción simulada. Define ASSEMBLYAI_API_KEY para transcribir de verdad.'
          : `Transcripción real con AssemblyAI y diarización, ${
              config.transcriptionLanguage === undefined
                ? 'detectando el idioma automáticamente'
                : `en ${config.transcriptionLanguage}`
            }.`,
    },
    summary: {
      provider: config.analysis,
      real: config.analysis !== 'mock',
      hint:
        config.analysis === 'mock'
          ? 'Análisis simulado. Define ANTHROPIC_API_KEY (o OPENAI_API_KEY) para generarlo de verdad.'
          : `Análisis con ${config.analysis}.`,
    },
  };
}
