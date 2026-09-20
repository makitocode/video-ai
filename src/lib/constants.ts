/**
 * Parámetros del pipeline de ingesta.
 *
 * Ver doc/04-ingesta-y-upload.md para el razonamiento detrás de estos valores.
 */

/** Bytes leídos del inicio del archivo para identificar el contenedor por firma binaria. */
export const CONTAINER_SNIFF_BYTES = 512;

/**
 * Perfiles de codificación de audio, en orden de preferencia.
 *
 * El objetivo no es calidad musical: es el formato que los modelos de ASR consumen
 * internamente. Mono a bitrate bajo reduce el audio de 2 h de ~170 MB a ~22 MB sin
 * pérdida de precisión de transcripción.
 *
 * Opus se prefiere porque a 24 kbps ya es inteligible; AAC es el plan B para navegadores
 * sin encoder de Opus.
 */
export const AUDIO_PROFILE_CANDIDATES = [
  { codec: 'opus', container: 'ogg', sampleRate: 16_000, bitrate: 24_000 },
  { codec: 'opus', container: 'ogg', sampleRate: 24_000, bitrate: 24_000 },
  { codec: 'opus', container: 'ogg', sampleRate: 48_000, bitrate: 32_000 },
  { codec: 'aac', container: 'mp4', sampleRate: 16_000, bitrate: 32_000 },
  { codec: 'aac', container: 'mp4', sampleRate: 44_100, bitrate: 48_000 },
] as const;

/** El audio se remezcla siempre a mono: la diarización no gana nada con estéreo. */
export const AUDIO_CHANNELS = 1;

/** Límite de tamaño de archivo aceptado (ver doc/09-costes-y-limites.md). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024;

/** Supabase Storage exige exactamente 6 MB por chunk en subidas TUS. No es negociable. */
export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
