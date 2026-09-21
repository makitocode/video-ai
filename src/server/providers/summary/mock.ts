import type { SummarizeInput, SummaryPayload, SummaryProvider } from './types';

/**
 * Proveedor de resumen simulado.
 *
 * Como el simulado de transcripción, existe para que todo el flujo funcione sin claves. En vez
 * de inventarse contenido, **extrae frases reales del transcript** y las cita con su marca de
 * tiempo real. Así las citas del resumen son navegables de verdad y la interfaz se puede
 * probar en serio: lo único falso es el criterio de selección.
 */
export class MockSummaryProvider implements SummaryProvider {
  readonly name = 'mock';
  readonly model = 'mock-summary-1';

  async summarize(input: SummarizeInput): Promise<SummaryPayload> {
    const lines = parseAnchoredLines(input.anchoredTranscript);

    if (lines.length === 0) {
      return {
        language: input.languageCode,
        headline: 'Grabación sin contenido transcrito',
        abstract: 'No se encontró texto en el transcript sobre el que construir un resumen.',
        keyPoints: [],
        decisions: [],
        actionItems: [],
        chapters: [],
        speakerNameSuggestions: [],
      };
    }

    // Se eligen frases repartidas por toda la duración en vez de las primeras:
    // un resumen que sólo cubre los tres primeros minutos no es un resumen.
    const picks = spreadPicks(lines, 5);

    return {
      language: input.languageCode,
      headline: `[Simulado] Grabación de ${Math.round(input.durationMs / 60_000)} minutos con ${countSpeakers(lines)} hablantes`,
      abstract:
        '[Resumen simulado] Este texto no lo generó un modelo de lenguaje. Las citas sí son ' +
        'reales: apuntan a momentos existentes del transcript, así que la navegación funciona. ' +
        'Define ANTHROPIC_API_KEY para generar el resumen de verdad con Claude.',
      keyPoints: picks.map((line) => ({
        text: line.text.length > 160 ? `${line.text.slice(0, 157)}…` : line.text,
        ownerSpeakerLabel: line.speakerLabel,
        citations: [{ startMs: line.startMs, speakerLabel: line.speakerLabel }],
      })),
      decisions: [],
      actionItems: [],
      chapters: buildChapters(lines, input.durationMs),
      speakerNameSuggestions: [],
    };
  }
}

type AnchoredLine = { startMs: number; speakerLabel: string; text: string };

/** Lee las líneas con el formato `[hh:mm:ss.mmm] Speaker X: texto` que produce el prompt. */
function parseAnchoredLines(transcript: string): AnchoredLine[] {
  const lines: AnchoredLine[] = [];

  for (const raw of transcript.split('\n')) {
    const match = /^\[(\d+):(\d{2}):(\d{2})\.(\d{3})\]\s+([^:]+):\s*(.+)$/.exec(raw.trim());
    if (match === null) continue;

    const [, hours, minutes, seconds, millis, speaker, text] = match;
    lines.push({
      startMs:
        Number(hours) * 3_600_000 +
        Number(minutes) * 60_000 +
        Number(seconds) * 1_000 +
        Number(millis),
      speakerLabel: (speaker ?? '').trim(),
      text: (text ?? '').trim(),
    });
  }

  return lines;
}

function spreadPicks(lines: AnchoredLine[], count: number): AnchoredLine[] {
  if (lines.length <= count) return lines;

  const step = lines.length / count;
  return Array.from({ length: count }, (_, index) => lines[Math.floor(index * step)]).filter(
    (line): line is AnchoredLine => line !== undefined,
  );
}

function countSpeakers(lines: AnchoredLine[]): number {
  return new Set(lines.map((line) => line.speakerLabel)).size;
}

function buildChapters(lines: AnchoredLine[], durationMs: number): SummaryPayload['chapters'] {
  const chapterCount = Math.min(4, Math.max(1, Math.floor(durationMs / 300_000)));
  const span = durationMs / chapterCount;

  return Array.from({ length: chapterCount }, (_, index) => ({
    title: `[Simulado] Bloque ${index + 1}`,
    startMs: Math.round(index * span),
    endMs: Math.round((index + 1) * span),
  }));
}
