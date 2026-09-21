import type {
  AnalysisPayload,
  AnalysisPort,
  AnalysisResult,
  AnalyzeInput,
  IdentifySpeakersInput,
  SpeakerIdentificationPayload,
} from '@/server/ports/analysis';

/** El simulado no gasta tokens, y decirlo explícitamente evita que el coste parezca perdido. */
const NO_USAGE = {
  provider: 'mock',
  model: 'mock-analysis-1',
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
} as const;

/**
 * Análisis simulado.
 *
 * Como el simulado de transcripción, existe para que todo el flujo funcione sin claves. Dos
 * decisiones para que no engañe a nadie:
 *
 * - **No inventa nombres de hablante.** Devuelve todo en null con confianza baja, que es el
 *   resultado honesto de no tener un modelo detrás. Poner nombres falsos sería justo el tipo
 *   de dato plausible-pero-falso que hace perder el tiempo.
 * - **Las citas son reales.** Los puntos clave se extraen de líneas existentes del transcript
 *   con su marca de tiempo verdadera, así que la navegación funciona de verdad. Lo único
 *   falso es el criterio de selección.
 */
export class MockAnalysisAdapter implements AnalysisPort {
  readonly provider = 'mock';
  readonly models = { identify: 'mock-analysis-1', analyze: 'mock-analysis-1' };

  async identifySpeakers(
    input: IdentifySpeakersInput,
  ): Promise<AnalysisResult<SpeakerIdentificationPayload>> {
    const speakers = {
      speakers: input.speakers.map((speaker) => ({
        label: speaker.label,
        name: null,
        role: null,
        confidence: 'low' as const,
        evidenceMs: null,
        evidenceQuote: null,
        sameAsLabel: null,
      })),
    };

    return { payload: speakers, usage: { ...NO_USAGE } };
  }

  async analyze(input: AnalyzeInput): Promise<AnalysisResult<AnalysisPayload>> {
    const lines = parseAnchoredLines(input.anchoredTranscript);

    if (lines.length === 0) {
      return {
        usage: { ...NO_USAGE },
        payload: {
          language: input.languageCode,
          headline: 'Grabación sin contenido transcrito',
          overview: [
            'No se encontró texto en el transcript sobre el que construir un análisis.',
            'Revisa que el audio contenga voz.',
          ],
          topics: [],
          decisions: [],
          actionItems: [],
        },
      };
    }

    const paragraphs = input.durationMs > 90 * 60 * 1000 ? 3 : 2;

    return {
      usage: { ...NO_USAGE },
      payload: {
        language: input.languageCode,
        headline: `[Simulado] Reunión de ${Math.round(input.durationMs / 60_000)} minutos`,
        overview: Array.from({ length: paragraphs }, (_, index) =>
          index === 0
            ? '[Análisis simulado] Este texto no lo generó un modelo de lenguaje. Las citas sí ' +
              'son reales: apuntan a momentos existentes del transcript, así que la navegación ' +
              'funciona. Define ANTHROPIC_API_KEY para generar el análisis de verdad con Claude.'
            : `Párrafo ${index + 1} de relleno, para que la interfaz reciba la misma forma de ` +
              'datos que produciría el análisis real.',
        ),
        topics: buildTopics(lines, input.durationMs),
        decisions: [],
        actionItems: [],
      },
    };
  }
}

type AnchoredLine = { startMs: number; speakerLabel: string; text: string };

/** Lee las líneas con el formato `[hh:mm:ss.mmm] Hablante: texto` que produce el prompt. */
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

/**
 * Divide la grabación en bloques cronológicos y toma una línea real de cada uno.
 *
 * Reparte por toda la duración en vez de coger las primeras líneas: un resumen que sólo
 * cubre los tres primeros minutos no es un resumen, y la interfaz no se probaría de verdad.
 */
function buildTopics(lines: AnchoredLine[], durationMs: number): AnalysisPayload['topics'] {
  const topicCount = Math.min(4, Math.max(1, Math.round(durationMs / 1_800_000)));
  const span = durationMs / topicCount;

  return Array.from({ length: topicCount }, (_, index) => {
    const startMs = Math.round(index * span);
    const endMs = Math.round((index + 1) * span);
    const within = lines.filter((line) => line.startMs >= startMs && line.startMs < endMs);
    const picks = within.slice(0, 3);

    return {
      title: `[Simulado] Bloque ${index + 1}`,
      startMs,
      endMs,
      points: picks.map((line) => ({
        text: line.text.length > 160 ? `${line.text.slice(0, 157)}…` : line.text,
        speakerLabel: line.speakerLabel,
        citations: [{ startMs: line.startMs }],
      })),
    };
  }).filter((topic) => topic.points.length > 0);
}
