import { readFileStream } from '@/server/storage';
import type {
  TranscribeInput,
  TranscriptionPort,
  TranscriptionResult,
} from '@/server/ports/transcription';

/**
 * Transcripción real con AssemblyAI: idioma automático y diarización en una sola llamada.
 *
 * **Diferencia con la versión en la nube**: allí se le pasa al proveedor una *signed URL* y
 * la respuesta llega por webhook. Aquí no hay URL pública que ofrecer —estamos en localhost—
 * así que se suben los bytes del audio directamente a su endpoint de subida y se consulta el
 * estado por sondeo.
 *
 * Eso es lo que permite que la versión local no necesite ni S3 ni un túnel: el audio pesa
 * ~22 MB por cada 2 h de video, así que subirlo es cuestión de segundos.
 */

const API_BASE = 'https://api.assemblyai.com/v2';

/**
 * Modelos por defecto, en orden de preferencia.
 *
 * `speech_models` es una **lista de reserva ordenada**, no ejecución en paralelo: se intenta
 * el primero y, si no está disponible para la cuenta, se cae al siguiente. Un transcript lo
 * produce exactamente un modelo.
 *
 * Enviarlo es importante: **si se omite, la API usa `universal-3-pro` por defecto**, no el
 * modelo insignia. `universal-3-5-pro` transcribe 18 idiomas de forma nativa —español
 * incluido— y para el resto cae solo a `universal-2`, que cubre 99.
 */
export const DEFAULT_SPEECH_MODELS = ['universal-3-5-pro', 'universal-2'] as const;

export type AssemblyAiOptions = {
  /** Idioma fijado. Si es `undefined`, se le pide al proveedor que lo detecte. */
  languageCode: string | undefined;
  /** Lista de reserva ordenada de modelos. */
  speechModels: readonly string[];
  /**
   * Descripción en lenguaje natural del audio: dominio, escenario, nombres propios.
   * Mejora notablemente la precisión sobre jerga y nombres que el modelo no conoce.
   */
  prompt: string | undefined;
  /** Vocabulario específico: nombres de personas, productos, siglas. Hasta 1.000 frases. */
  keyterms: readonly string[];
};

/** Cadencia de sondeo. El tope da una hora larga de margen antes de rendirse. */
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 1_200; // ~1 hora de margen

type UploadResponse = { upload_url: string };

type TranscriptResponse = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string | null;
  language_code?: string | null;
  language_confidence?: number | null;
  /** Qué modelo produjo realmente el transcript, tras aplicar la lista de reserva. */
  speech_model?: string | null;
  audio_duration?: number | null;
  utterances?: Array<{
    start: number;
    end: number;
    speaker: string;
    text: string;
    confidence: number | null;
  }> | null;
  text?: string | null;
};

export class AssemblyAiTranscriptionAdapter implements TranscriptionPort {
  readonly provider = 'assemblyai';

  get model(): string {
    return this.options.speechModels[0] ?? 'universal-3-5-pro';
  }

  constructor(
    private readonly apiKey: string,
    private readonly options: AssemblyAiOptions,
  ) {}

  private get headers(): Record<string, string> {
    // AssemblyAI espera el token crudo, sin el prefijo `Bearer`.
    return { authorization: this.apiKey };
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    const audioUrl = await this.uploadAudio(input.audioStoragePath);
    const jobId = await this.submit(audioUrl);
    const result = await this.poll(jobId);

    return this.toResult(result);
  }

  /** Sube los bytes del audio y devuelve la URL interna que AssemblyAI usará para leerlo. */
  private async uploadAudio(storagePath: string): Promise<string> {
    const stream = readFileStream(storagePath);

    const response = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: { ...this.headers, 'content-type': 'application/octet-stream' },
      // El stream de Node se adapta a la Fetch API; `duplex` es obligatorio al enviar
      // un cuerpo en streaming.
      body: stream as unknown as BodyInit,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    if (!response.ok) {
      throw new Error(`AssemblyAI rechazó la subida del audio (${response.status}).`);
    }

    const payload = (await response.json()) as UploadResponse;
    return payload.upload_url;
  }

  private async submit(audioUrl: string): Promise<string> {
    const response = await fetch(`${API_BASE}/transcript`, {
      method: 'POST',
      headers: { ...this.headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: audioUrl,
        // Sin esto la API usa su modelo por defecto en vez del insignia.
        speech_models: this.options.speechModels,
        // Las dos capacidades que definen el producto, en la misma petición.
        speaker_labels: true,
        // Detección automática sólo si no se fijó el idioma: los dos parámetros son
        // mutuamente excluyentes, y fijarlo es más fiable cuando ya se sabe cuál es.
        ...(this.options.languageCode === undefined
          ? { language_detection: true }
          : { language_code: this.options.languageCode }),
        ...(this.options.prompt === undefined ? {} : { prompt: this.options.prompt }),
        ...(this.options.keyterms.length === 0 ? {} : { keyterms_prompt: this.options.keyterms }),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`AssemblyAI rechazó el trabajo (${response.status}): ${detail}`);
    }

    const payload = (await response.json()) as TranscriptResponse;
    return payload.id;
  }

  private async poll(jobId: string): Promise<TranscriptResponse> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const response = await fetch(`${API_BASE}/transcript/${jobId}`, { headers: this.headers });
      if (!response.ok) {
        throw new Error(`AssemblyAI no devolvió el estado del trabajo (${response.status}).`);
      }

      const payload = (await response.json()) as TranscriptResponse;

      if (payload.status === 'completed') return payload;
      if (payload.status === 'error') {
        throw new Error(payload.error ?? 'AssemblyAI terminó el trabajo con error.');
      }

      // AssemblyAI no informa de avance: `processing` es todo lo que dice hasta terminar.
      // Aquí se estimaba un porcentaje dividiendo el tiempo de espera entre una duración
      // supuesta, y sobre una grabación larga eso pintaba un 2 % con el trabajo bien avanzado.
      // Un número inventado que parece atascado es peor que ninguno: la interfaz muestra el
      // tiempo transcurrido, que sí es cierto.
    }

    throw new Error('AssemblyAI no devolvió resultado dentro del tiempo máximo de espera.');
  }

  private toResult(payload: TranscriptResponse): TranscriptionResult {
    const utterances = payload.utterances ?? [];

    if (utterances.length === 0) {
      // Sin diarización sólo tenemos un bloque de texto. Es mejor devolverlo como un
      // único hablante que fallar: el usuario prefiere un transcript plano a nada.
      const text = payload.text?.trim() ?? '';
      if (text.length === 0) {
        throw new Error('AssemblyAI no devolvió texto: ¿el audio contiene voz?');
      }

      const durationMs = Math.round((payload.audio_duration ?? 0) * 1000);
      return {
        languageCode: payload.language_code ?? 'und',
        languageConfidence: payload.language_confidence ?? null,
        modelVersion: payload.speech_model ?? 'assemblyai',
        speakers: [{ label: 'Speaker A', totalSpeakingMs: durationMs }],
        segments: [
          { startMs: 0, endMs: durationMs, speakerLabel: 'Speaker A', text, confidence: null },
        ],
      };
    }

    const speakingMs = new Map<string, number>();
    const segments = utterances.map((utterance) => {
      const label = `Speaker ${utterance.speaker}`;
      speakingMs.set(label, (speakingMs.get(label) ?? 0) + (utterance.end - utterance.start));
      return {
        startMs: utterance.start,
        endMs: utterance.end,
        speakerLabel: label,
        text: utterance.text,
        confidence: utterance.confidence,
      };
    });

    return {
      languageCode: payload.language_code ?? 'und',
      languageConfidence: payload.language_confidence ?? null,
      modelVersion: payload.speech_model ?? 'assemblyai',
      speakers: [...speakingMs.entries()].map(([label, totalSpeakingMs]) => ({
        label,
        totalSpeakingMs,
      })),
      segments,
    };
  }
}
