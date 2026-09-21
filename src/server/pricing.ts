import type { TokenUsage } from './ports/analysis';

/**
 * Tabla de precios por millón de tokens.
 *
 * Precios de Anthropic verificados contra su documentación oficial el 2026-09-21. Los de
 * OpenAI provienen de fuentes secundarias porque su web no era accesible al escribir esto:
 * **trátalos como orientativos y contrástalos antes de tomar una decisión de coste**.
 *
 * Sirve para dos cosas: estimar antes de gastar, y —sobre todo— convertir el consumo real que
 * reportan los proveedores en dinero, que es la única medición que no se equivoca.
 */

export type ModelPrice = {
  /** Dólares por millón de tokens de entrada. */
  input: number;
  /** Lectura desde caché. En ambos proveedores ronda el 10 % de la entrada. */
  cachedInput: number;
  /** Escritura en caché de 5 minutos. */
  cacheWrite: number;
  output: number;
  /** `true` cuando el precio no viene de la documentación oficial del proveedor. */
  unverified?: boolean;
};

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // --- Anthropic (verificado el 2026-09-21) ---
  'claude-opus-5': { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  'claude-opus-4-8': { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  'claude-sonnet-5': { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
  'claude-haiku-4-5': { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
  'claude-fable-5-1': { input: 10, cachedInput: 0.25, cacheWrite: 12.5, output: 50 },

  // --- OpenAI (sin verificar contra fuente oficial) ---
  'gpt-6-astra': { input: 10, cachedInput: 1, cacheWrite: 10, output: 50, unverified: true },
  'gpt-5.6-sol': { input: 4, cachedInput: 0.4, cacheWrite: 4, output: 20, unverified: true },
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, cacheWrite: 2, output: 12, unverified: true },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, cacheWrite: 0.2, output: 1.2, unverified: true },
  'gpt-5.2': { input: 1.75, cachedInput: 0.175, cacheWrite: 1.75, output: 14, unverified: true },
};

/** Coste en millonésimas de dólar. Enteros para no arrastrar errores de coma flotante. */
export function estimateCostMicros(usage: TokenUsage): number {
  const price = MODEL_PRICES[usage.model];
  if (price === undefined) return 0;

  // Los tokens de caché vienen ya descontados de `inputTokens` en ambos proveedores, así que
  // se cobran aparte en vez de restarlos.
  const dollars =
    (usage.inputTokens * price.input +
      usage.cachedInputTokens * price.cachedInput +
      usage.outputTokens * price.output) /
    1_000_000;

  return Math.round(dollars * 1_000_000);
}

export function formatCost(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}
