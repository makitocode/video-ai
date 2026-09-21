import { readFileStream } from '@/server/storage';
import type { TranscribeInput, TranscriptionProvider, TranscriptionResult } from './types';

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

/** Cadencia de sondeo. AssemblyAI tarda en torno al 20-25 % de la duración del audio. */
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 1_200; // ~1 hora de margen

type UploadResponse = { upload_url: string };

type TranscriptResponse = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string | null;
  language_code?: string | null;
  language_confidence?: number | null;
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

export class AssemblyAiTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'assemblyai';

  constructor(
    private readonly apiKey: string,
    /** Idioma fijado. Si es `undefined`, se le pide al proveedor que lo detecte. */
    private readonly languageCode: string | undefined,
  ) {}

  private get headers(): Record<string, string> {
    // AssemblyAI espera el token crudo, sin el prefijo `Bearer`.
    return { authorization: this.apiKey };
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    const audioUrl = await this.uploadAudio(input.audioStoragePath);
    const jobId = await this.submit(audioUrl);
    const result = await this.poll(jobId, input);

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
        // Las dos capacidades que definen el producto, en la misma petición.
        speaker_labels: true,
        // Detección automática sólo si no se fijó el idioma: los dos parámetros son
        // mutuamente excluyentes, y fijarlo es más fiable cuando ya se sabe cuál es.
        ...(this.languageCode === undefined
          ? { language_detection: true }
          : { language_code: this.languageCode }),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`AssemblyAI rechazó el trabajo (${response.status}): ${detail}`);
    }

    const payload = (await response.json()) as TranscriptResponse;
    return payload.id;
  }

  private async poll(jobId: string, input: TranscribeInput): Promise<TranscriptResponse> {
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

      // No hay porcentaje real en la API, así que se estima contra el tiempo típico
      // (~25 % de la duración del audio) y se corta en 0,95 para no prometer el final.
      const expectedMs = Math.max(input.durationMs * 0.25, 30_000);
      input.onProgress?.(Math.min(((attempt + 1) * POLL_INTERVAL_MS) / expectedMs, 0.95));
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
        modelVersion: 'assemblyai',
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
      modelVersion: 'assemblyai',
      speakers: [...speakingMs.entries()].map(([label, totalSpeakingMs]) => ({
        label,
        totalSpeakingMs,
      })),
      segments,
    };
  }
}
