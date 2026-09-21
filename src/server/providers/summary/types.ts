import { z } from 'zod';

/**
 * Puerto de resumen.
 *
 * La estructura de salida es deliberadamente estricta: cada afirmación **debe** traer al menos
 * una cita temporal. Lo que el modelo no pueda respaldar, no entra. Ver
 * doc/05-pipeline-analisis.md § La regla que hace esto fiable.
 */

export const CitationSchema = z.object({
  startMs: z.number().int().min(0).describe('Marca de tiempo en milisegundos del momento citado'),
  speakerLabel: z.string().describe('Etiqueta del hablante que lo dijo, por ejemplo "Speaker A"'),
});

const ClaimSchema = z.object({
  text: z.string().describe('La afirmación, en una frase'),
  ownerSpeakerLabel: z
    .string()
    .nullable()
    .describe('Hablante responsable, si aplica; null si no corresponde a nadie en concreto'),
  citations: z
    .array(CitationSchema)
    .min(1)
    .describe('Al menos una cita que respalde la afirmación'),
});

export const SummarySchema = z.object({
  language: z.string().describe('Código ISO del idioma del resumen, que debe ser el del audio'),
  headline: z.string().describe('Una frase que capture de qué va la grabación'),
  abstract: z.string().describe('Resumen de tres a cinco frases'),
  keyPoints: z.array(ClaimSchema),
  decisions: z.array(ClaimSchema).describe('Decisiones tomadas; vacío si no se tomó ninguna'),
  actionItems: z.array(ClaimSchema).describe('Tareas pendientes acordadas'),
  chapters: z
    .array(
      z.object({
        title: z.string(),
        startMs: z.number().int().min(0),
        endMs: z.number().int().min(0),
      }),
    )
    .describe('Secciones temáticas en orden cronológico'),
  speakerNameSuggestions: z
    .array(
      z.object({
        label: z.string().describe('Etiqueta del proveedor, por ejemplo "Speaker B"'),
        suggestedName: z.string(),
        evidenceMs: z.number().int().min(0).describe('Dónde se dice el nombre en la grabación'),
        confidence: z.enum(['high', 'medium', 'low']),
      }),
    )
    .describe('Nombres reales inferidos del diálogo. Vacío si no hay pistas suficientes.'),
});

export type SummaryPayload = z.infer<typeof SummarySchema>;

export type SummarizeInput = {
  /** Transcript ya anclado: cada línea lleva su marca de tiempo y su hablante. */
  anchoredTranscript: string;
  languageCode: string;
  durationMs: number;
};

export interface SummaryProvider {
  readonly name: string;
  readonly model: string;
  summarize(input: SummarizeInput): Promise<SummaryPayload>;
}
