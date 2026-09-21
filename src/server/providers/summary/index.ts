import { config } from '@/server/config';
import { AnthropicAnalysisProvider } from './anthropic';
import { MockAnalysisProvider } from './mock';
import type { AnalysisProvider } from './types';

/**
 * Selecciona el proveedor de análisis según la configuración.
 * Sin clave, el simulado; con clave, Claude. Ningún otro archivo sabe cuál está activo.
 */
export function getAnalysisProvider(): AnalysisProvider {
  if (config.summary === 'anthropic' && config.anthropicKey !== undefined) {
    return new AnthropicAnalysisProvider(config.anthropicKey, config.anthropicModel);
  }
  return new MockAnalysisProvider();
}

export type { AnalysisPayload, AnalysisProvider } from './types';
