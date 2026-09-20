import type { ContainerKind } from './container-sniff';

/**
 * La ruta que sigue un archivo por el pipeline de ingesta.
 *
 * - `fast`: el navegador puede decodificar el audio, así que lo extraemos aquí y subimos
 *   ~22 MB en vez de varios GB. El análisis arranca en segundos.
 * - `escape`: el navegador no puede con este códec. Se sube el archivo original y el
 *   demux lo hace el proveedor de ASR. Más lento, pero nunca un callejón sin salida.
 *
 * Ver doc/02-adr-backend-serverless.md § La ruta de escape.
 */
export type IngestRoute = 'fast' | 'escape';

/** Configuración de codificación de audio resuelta contra las capacidades del navegador. */
export type AudioProfile = {
  codec: 'opus' | 'aac';
  container: 'ogg' | 'mp4';
  sampleRate: number;
  numberOfChannels: number;
  bitrate: number;
  fileExtension: string;
  mimeType: string;
};

export type VideoTrackSummary = {
  codec: string | null;
  codecString: string | null;
  canDecode: boolean;
  displayWidth: number;
  displayHeight: number;
};

export type AudioTrackSummary = {
  codec: string | null;
  codecString: string | null;
  canDecode: boolean;
  sampleRate: number;
  numberOfChannels: number;
  languageCode: string;
};

/** Todo lo que sabemos de un archivo antes de gastar CPU o red en él. */
export type ProbeResult = {
  fileName: string;
  fileBytes: number;
  container: ContainerKind;
  formatName: string;
  mimeType: string;
  durationSeconds: number;
  videoTracks: VideoTrackSummary[];
  audioTracks: AudioTrackSummary[];
  route: IngestRoute;
  /** Explicación legible de por qué se eligió esa ruta. Se muestra al usuario. */
  routeReason: string;
  /** Perfil de audio elegido, o `null` si este navegador no puede codificar nada útil. */
  audioProfile: AudioProfile | null;
  elapsedMs: number;
};

/** Resultado de la extracción de audio, la métrica clave de la Fase 1. */
export type AudioExtractionResult = {
  blob: Blob;
  profile: AudioProfile;
  /** Duración del medio procesado, en segundos. */
  mediaSeconds: number;
  elapsedMs: number;
  sourceBytes: number;
  outputBytes: number;
  /** `sourceBytes / outputBytes`. El número que justifica toda la arquitectura. */
  compressionRatio: number;
};

export type ExtractionStage = 'probing' | 'extracting';

export type ExtractionProgress = {
  stage: ExtractionStage;
  /** Entre 0 y 1. */
  progress: number;
  processedSeconds: number;
};

// --- Protocolo del Web Worker -------------------------------------------------
//
// El worker existe para que el hilo principal no se bloquee ni un milisegundo
// durante la decodificación (ver doc/06-frontend.md § Regla número uno).

export type MediaWorkerRequest =
  | { kind: 'probe'; requestId: string; file: File }
  | { kind: 'extract-audio'; requestId: string; file: File };

export type MediaWorkerResponse =
  | { kind: 'progress'; requestId: string; progress: ExtractionProgress }
  | { kind: 'probe-result'; requestId: string; result: ProbeResult }
  | { kind: 'extract-result'; requestId: string; result: AudioExtractionResult }
  | { kind: 'error'; requestId: string; message: string };
