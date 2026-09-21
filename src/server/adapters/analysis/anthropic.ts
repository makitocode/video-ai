import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
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
import { analyzeTask, identifyTask, paragraphsFor, systemPrompt } from '@/server/prompts';

/**
 * Adaptador de análisis sobre Claude.
 *
 * Cuatro decisiones que importan más que la redacción de los prompts:
 *
 * 1. **Salida estructurada obligatoria.** El modelo devuelve un objeto que cumple el esquema o
 *    la petición falla. Eso también acota el daño de una inyección desde el transcript: un
 *    modelo desviado sólo puede producir JSON que será rechazado.
 *
 * 2. **El transcript es entrada no confiable**, va delimitado como datos, y este pipeline no
 *    tiene herramientas, ni red, ni acceso a la base de datos.
 *
 * 3. **Las marcas de tiempo no se creen.** Que cada cita apunte a un segmento real se verifica
 *    al guardar, no aquí.
 *
 * 4. **Caché de prompt entre las dos fases.** Identificar y analizar envían exactamente el
 *    mismo transcript —decenas de miles de tokens— con minutos de diferencia. Compartiendo
 *    system y poniendo el transcript delante del punto de corte, la segunda llamada lo lee al
 *    10 % del precio. Es la optimización de coste que no cuesta calidad, y por eso va antes
 *    que cualquier idea de bajar de modelo.
 */
export class AnthropicAnalysisAdapter implements AnalysisPort {
  readonly provider = 'anthropic';

  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly models: { identify: string; analyze: string },
    /**
     * Workspace al que imputar el gasto. Sólo lo necesitan las claves que no pertenecen a
     * ninguno: la API las rechaza con un 400 hasta que la cabecera viaja en la petición.
     */
    workspaceId?: string,
  ) {
    this.client = new Anthropic({
      apiKey,
      ...(workspaceId === undefined
        ? {}
        : { defaultHeaders: { 'anthropic-workspace-id': workspaceId } }),
    });
  }

  async identifySpeakers(
    input: IdentifySpeakersInput,
  ): Promise<AnalysisResult<SpeakerIdentificationPayload>> {
    return this.request({
      model: this.models.identify,
      schema: SpeakerIdentificationSchema,
      transcript: input.anchoredTranscript,
      task: identifyTask(input),
      maxTokens: 16_000,
      what: 'identificar a los hablantes',
    });
  }

  async analyze(input: AnalyzeInput): Promise<AnalysisResult<AnalysisPayload>> {
    return this.request({
      model: this.models.analyze,
      schema: AnalysisSchema,
      transcript: input.anchoredTranscript,
      task: analyzeTask(input, paragraphsFor(input.durationMs)),
      // Una reunión larga produce bastante texto, y el razonamiento del modelo también
      // consume presupuesto: quedarse corto trunca la respuesta y la invalida entera.
      maxTokens: 32_000,
      what: 'analizar la reunión',
    });
  }

  private async request<T>(options: {
    model: string;
    schema: Parameters<typeof zodOutputFormat>[0];
    transcript: string;
    task: string;
    maxTokens: number;
    what: string;
  }): Promise<AnalysisResult<T>> {
    try {
      // **Streaming obligatorio.** El SDK estima cuánto puede tardar una llamada
      // (60 min × max_tokens / 128.000) y se niega a hacerla sin streaming si pasa de diez
      // minutos. Con los 32.000 tokens que pide el informe eso da 15 minutos, así que la
      // llamada ni siquiera salía. No es una optimización: es la única forma de pedir una
      // respuesta larga.
      const response = await this.client.messages
        .stream({
          model: options.model,
          max_tokens: options.maxTokens,
          // System idéntico en las dos fases: es requisito para que el prefijo cacheado
          // sobreviva de una llamada a la otra.
          system: systemPrompt(),
          thinking: { type: 'adaptive' },
          output_config: { effort: 'high', format: zodOutputFormat(options.schema) },
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `<transcript>\n${options.transcript}\n</transcript>`,
                  // El corte va justo después del transcript: lo anterior se reutiliza entre
                  // fases, y la instrucción concreta, que sí cambia, queda fuera.
                  cache_control: { type: 'ephemeral' },
                },
                { type: 'text', text: options.task },
              ],
            },
          ],
        })
        // La salida estructurada se sigue validando igual: `finalMessage` devuelve el mensaje
        // ya parseado contra el esquema cuando se pidió con `output_config.format`.
        .finalMessage();

      if (response.stop_reason === 'refusal') {
        throw new Error(
          `Claude declinó ${options.what} por sus políticas de seguridad` +
            (response.stop_details?.explanation !== undefined
              ? `: ${response.stop_details.explanation}`
              : '.'),
        );
      }

      if (response.parsed_output === null) {
        throw new Error(
          response.stop_reason === 'max_tokens'
            ? `Se agotó el presupuesto de tokens al ${options.what}: la grabación puede ser ` +
                'demasiado larga para una sola pasada.'
            : `Claude respondió pero la salida no cumplía el esquema al ${options.what}.`,
        );
      }

      const usage: TokenUsage = {
        provider: this.provider,
        model: options.model,
        // Los tokens escritos en caché se cobran como entrada con recargo; se suman aquí
        // para no subestimar el coste de la primera llamada.
        inputTokens:
          response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0),
        cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
        outputTokens: response.usage.output_tokens,
      };

      return { payload: response.parsed_output as T, usage };
    } catch (error) {
      // Se distinguen los fallos recuperables de los que no lo son, para que el mensaje que
      // ve el usuario diga qué hacer.
      if (error instanceof Anthropic.AuthenticationError) {
        throw new Error('La clave de Anthropic no es válida. Revisa ANTHROPIC_API_KEY.');
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new Error(
          'Se alcanzó el límite de peticiones de Anthropic. Reintenta en un momento.',
        );
      }
      // El 400 por workspace es el único error de configuración que la API devuelve con un
      // texto que no dice dónde arreglarlo. Se traduce a la acción concreta.
      if (error instanceof Anthropic.BadRequestError && error.message.includes('workspace')) {
        throw new Error(
          'Tu clave de Anthropic tiene alcance de organización, así que hay que decirle a qué ' +
            'workspace imputar el gasto. Añade ANTHROPIC_WORKSPACE_ID a .env.local con el ID ' +
            'del workspace (Console → Organization settings → Workspaces; empieza por ' +
            '«wrkspc_») y reinicia el servidor.',
        );
      }
      if (error instanceof Anthropic.APIError) {
        throw new Error(`La API de Anthropic devolvió un error ${error.status}: ${error.message}`);
      }
      throw error;
    }
  }
}
