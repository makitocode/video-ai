import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import {
  AnalysisSchema,
  SpeakerIdentificationSchema,
  type AnalysisPayload,
  type AnalysisPort,
  type AnalysisResult,
  type AnalyzeInput,
  type IdentifySpeakersInput,
  type SpeakerIdentificationPayload,
  type TokenUsage,
} from '@/server/ports/analysis';
import { ANALYZE_TASK, IDENTIFY_TASK, SHARED_SYSTEM_PROMPT, paragraphsFor } from './prompts';

/**
 * Adaptador de análisis sobre OpenAI.
 *
 * Usa **los mismos prompts y los mismos esquemas** que el adaptador de Claude, a propósito: si
 * cada proveedor recibiera instrucciones distintas, comparar cuál lo hace mejor no
 * significaría nada. Lo único que cambia es cómo se le habla a cada API.
 *
 * Diferencias de la plataforma que este adaptador absorbe:
 * - La salida estructurada se declara con `text.format` y se lee en `output_parsed`, no con
 *   `output_config.format` / `parsed_output`.
 * - El almacenamiento en caché es automático por prefijo: no hay que marcar dónde cortar, pero
 *   tampoco se controla. Se reporta lo que la respuesta diga que se sirvió desde caché.
 */
export class OpenAiAnalysisAdapter implements AnalysisPort {
  readonly provider = 'openai';

  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly models: { identify: string; analyze: string },
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async identifySpeakers(
    input: IdentifySpeakersInput,
  ): Promise<AnalysisResult<SpeakerIdentificationPayload>> {
    return this.request({
      model: this.models.identify,
      schema: SpeakerIdentificationSchema,
      schemaName: 'speaker_identification',
      transcript: input.anchoredTranscript,
      task: IDENTIFY_TASK(input),
      what: 'identificar a los hablantes',
    });
  }

  async analyze(input: AnalyzeInput): Promise<AnalysisResult<AnalysisPayload>> {
    return this.request({
      model: this.models.analyze,
      schema: AnalysisSchema,
      schemaName: 'meeting_analysis',
      transcript: input.anchoredTranscript,
      task: ANALYZE_TASK(input, paragraphsFor(input.durationMs)),
      what: 'analizar la reunión',
    });
  }

  private async request<T>(options: {
    model: string;
    schema: Parameters<typeof zodTextFormat>[0];
    schemaName: string;
    transcript: string;
    task: string;
    what: string;
  }): Promise<AnalysisResult<T>> {
    try {
      const response = await this.client.responses.parse({
        model: options.model,
        input: [
          { role: 'system', content: SHARED_SYSTEM_PROMPT },
          // El transcript va primero y la instrucción después, igual que en el otro
          // adaptador: la caché de OpenAI funciona por prefijo, así que el contenido
          // estable delante es lo que permite reutilizarlo entre las dos fases.
          { role: 'user', content: `<transcript>\n${options.transcript}\n</transcript>` },
          { role: 'user', content: options.task },
        ],
        text: { format: zodTextFormat(options.schema, options.schemaName) },
      });

      if (response.output_parsed === null || response.output_parsed === undefined) {
        throw new Error(
          `OpenAI respondió pero la salida no cumplía el esquema al ${options.what}.`,
        );
      }

      const usage: TokenUsage = {
        provider: this.provider,
        model: options.model,
        // `input_tokens` incluye los servidos desde caché, así que se restan para no
        // contarlos dos veces al calcular el coste.
        inputTokens:
          (response.usage?.input_tokens ?? 0) -
          (response.usage?.input_tokens_details?.cached_tokens ?? 0),
        cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      };

      return { payload: response.output_parsed as T, usage };
    } catch (error) {
      if (error instanceof OpenAI.AuthenticationError) {
        throw new Error('La clave de OpenAI no es válida. Revisa OPENAI_API_KEY.');
      }
      if (error instanceof OpenAI.RateLimitError) {
        throw new Error('Se alcanzó el límite de peticiones de OpenAI. Reintenta en un momento.');
      }
      if (error instanceof OpenAI.APIError) {
        throw new Error(`La API de OpenAI devolvió un error ${error.status}: ${error.message}`);
      }
      throw error;
    }
  }
}
