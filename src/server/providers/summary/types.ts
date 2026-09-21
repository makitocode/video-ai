import { z } from 'zod';

/**
 * Puerto de análisis del transcript.
 *
 * Son **dos pases separados** sobre el mismo transcript, y la separación es deliberada:
 *
 * 1. **Identificar hablantes.** La diarización sólo da «Speaker A»; quién es cada uno se
 *    deduce de lo que se dice («soy María», «Carlos, ¿qué opinas?»). Va primero porque el
 *    segundo pase escribe mucho mejor cuando puede nombrar a la gente.
 * 2. **Analizar.** Resumen, temas, decisiones y tareas, todo anclado a marcas de tiempo.
 *
 * Hacerlo en una sola llamada saldría más barato, pero mezcla dos trabajos distintos en un
 * prompt y hace imposible saber cuál de los dos falló.
 */

// --- Pase 1: identificación de hablantes -------------------------------------

export const SpeakerIdentificationSchema = z.object({
  speakers: z.array(
    z.object({
      label: z.string().describe('La etiqueta del proveedor, por ejemplo "Speaker A"'),
      name: z
        .string()
        .nullable()
        .describe('Nombre real si se puede deducir del diálogo; null si no hay pistas'),
      role: z
        .string()
        .nullable()
        .describe('Papel en la reunión: quien modera, el cliente, quien presenta…'),
      confidence: z.enum(['high', 'medium', 'low']),
      evidenceMs: z
        .number()
        .int()
        .min(0)
        .nullable()
        .describe('Marca de tiempo donde se apoya la deducción'),
      evidenceQuote: z
        .string()
        .nullable()
        .describe('La frase exacta del transcript que lo justifica'),
      sameAsLabel: z
        .string()
        .nullable()
        .describe(
          'Si esta etiqueta es en realidad la misma persona que otra, indica la otra etiqueta. ' +
            'La diarización tiende a partir a un mismo hablante en varias cuando hay ' +
            'interrupciones.',
        ),
    }),
  ),
});

export type SpeakerIdentificationPayload = z.infer<typeof SpeakerIdentificationSchema>;

export type IdentifySpeakersInput = {
  anchoredTranscript: string;
  /** Etiquetas que devolvió la diarización, con cuánto habló cada una. */
  speakers: ReadonlyArray<{ label: string; totalSpeakingMs: number }>;
  languageCode: string;
};

// --- Pase 2: análisis ---------------------------------------------------------

const CitationSchema = z.object({
  startMs: z.number().int().min(0).describe('Marca de tiempo exacta de una línea del transcript'),
});

const ClaimSchema = z.object({
  text: z.string().describe('La afirmación, en una frase'),
  speakerLabel: z.string().nullable().describe('Etiqueta del hablante al que corresponde, o null'),
  citations: z.array(CitationSchema).min(1).describe('Al menos una cita que la respalde'),
});

export const AnalysisSchema = z.object({
  language: z.string().describe('Código ISO del idioma, que debe ser el del audio'),
  headline: z.string().describe('Una frase que capture de qué fue la reunión'),
  overview: z
    .array(z.string())
    .min(2)
    .max(3)
    .describe('Resumen general en párrafos completos, no en viñetas'),
  topics: z
    .array(
      z.object({
        title: z.string().describe('De qué trata este bloque de la conversación'),
        startMs: z.number().int().min(0),
        endMs: z.number().int().min(0),
        points: z.array(ClaimSchema).describe('Puntos clave de este tema'),
      }),
    )
    .describe('Temas en ORDEN CRONOLÓGICO, sin solaparse'),
  decisions: z
    .array(ClaimSchema)
    .describe('Acuerdos explícitos. Vacío si no se decidió nada en firme.'),
  actionItems: z
    .array(
      ClaimSchema.extend({
        owner: z.string().nullable().describe('Quién queda a cargo, si se dijo'),
      }),
    )
    .describe('Tareas pendientes acordadas'),
});

export type AnalysisPayload = z.infer<typeof AnalysisSchema>;

export type AnalyzeInput = {
  /** Transcript ya anclado: cada línea con su marca de tiempo y su hablante. */
  anchoredTranscript: string;
  languageCode: string;
  durationMs: number;
};

export interface AnalysisProvider {
  readonly name: string;
  readonly model: string;
  identifySpeakers(input: IdentifySpeakersInput): Promise<SpeakerIdentificationPayload>;
  analyze(input: AnalyzeInput): Promise<AnalysisPayload>;
}
