/**
 * Puerto de transcripción.
 *
 * El resto del sistema sólo conoce esta interfaz. Es lo que hace que cambiar de proveedor
 * —o pasar del simulado al real— sea sustituir una implementación, no reescribir el pipeline
 * (ver doc/05-pipeline-analisis.md).
 */

export type TranscriptionResult = {
  languageCode: string;
  languageConfidence: number | null;
  modelVersion: string | null;
  speakers: Array<{ label: string; totalSpeakingMs: number }>;
  segments: Array<{
    startMs: number;
    endMs: number;
    speakerLabel: string;
    text: string;
    confidence: number | null;
  }>;
};

export type TranscribeInput = {
  /** Ruta en el almacenamiento local del audio ya extraído y comprimido. */
  audioStoragePath: string;
  durationMs: number;
  /** Progreso entre 0 y 1 dentro de la etapa de transcripción. */
  onProgress?: (progress: number) => void;
};

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(input: TranscribeInput): Promise<TranscriptionResult>;
}
