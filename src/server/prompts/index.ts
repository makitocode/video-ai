import type { AnalyzeInput, IdentifySpeakersInput } from '@/server/ports/analysis';
import { analysisPrompts } from './catalog';

export { PromptRenderError } from './render';
export { analysisPrompts } from './catalog';

/**
 * Cara pública de los prompts del análisis.
 *
 * Aquí vive lo que las plantillas no deben contener: la lógica. Ordenar la lista de hablantes
 * o decidir cuántos párrafos pide una reunión son decisiones de producto, se prueban como
 * código, y entran en el prompt ya resueltas. Así la plantilla se lee tal cual se envía.
 *
 * Los dos proveedores llaman a estas mismas funciones **a propósito**: si Claude y OpenAI
 * recibieran instrucciones distintas, comparar cuál lo hace mejor no mediría los modelos sino
 * los prompts.
 */

/** Por encima de esta duración el resumen general pasa de dos párrafos a tres. */
const THREE_PARAGRAPH_THRESHOLD_MS = 90 * 60 * 1000;

export function paragraphsFor(durationMs: number): number {
  return durationMs > THREE_PARAGRAPH_THRESHOLD_MS ? 3 : 2;
}

/**
 * Huella de la redacción con la que se produjo un resultado.
 *
 * Se guarda junto al resumen. Es lo que convierte «me parece que antes salía mejor» en una
 * comparación: dos resúmenes de la misma grabación con huellas distintas no son comparables,
 * y con la misma huella la diferencia está en otro sitio.
 */
export const ANALYSIS_PROMPT_STAMP = [
  analysisPrompts.system.stamp,
  analysisPrompts.identify.stamp,
  analysisPrompts.analyze.stamp,
].join(' ');

/** Bloque de sistema, idéntico en las dos fases para que la caché sobreviva entre ellas. */
export function systemPrompt(): string {
  return analysisPrompts.system.render({});
}

export function identifyTask(input: IdentifySpeakersInput): string {
  const roster = input.speakers
    .map(
      (speaker) =>
        `- ${speaker.label} (habla ${Math.round(speaker.totalSpeakingMs / 60_000)} min en total)`,
    )
    .join('\n');

  return analysisPrompts.identify.render({ roster, languageCode: input.languageCode });
}

export function analyzeTask(input: AnalyzeInput, paragraphs: number): string {
  return analysisPrompts.analyze.render({
    durationMinutes: Math.round(input.durationMs / 60_000),
    languageCode: input.languageCode,
    paragraphs,
  });
}
