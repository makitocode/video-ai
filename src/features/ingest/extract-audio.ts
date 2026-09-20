import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  type OutputFormat,
} from 'mediabunny';
import type { AudioExtractionResult, AudioProfile, ExtractionProgress } from './types';

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

function createOutputFormat(profile: AudioProfile): OutputFormat {
  return profile.container === 'ogg' ? new OggOutputFormat() : new Mp4OutputFormat();
}

/** Motivos de descarte de Mediabunny, en lenguaje que un usuario pueda entender. */
const DISCARD_REASONS: Record<string, string> = {
  unknown_source_codec: 'el códec de la pista es desconocido',
  undecodable_source_codec: 'este navegador no puede decodificar el códec de la pista',
  no_encodable_target_codec: 'no hay ningún encoder disponible para el formato de salida',
  cannot_copy: 'la pista no se puede copiar sin recodificar',
  max_track_count_reached: 'el formato de salida no admite más pistas',
  max_track_count_of_type_reached: 'el formato de salida no admite pistas de ese tipo',
};

/**
 * Extrae la pista de audio de un archivo de medios y la recomprime a un formato apto para ASR.
 *
 * Esta función es el corazón de la arquitectura. Es lo que convierte "subir 5 GB antes de
 * empezar" en "subir 22 MB y empezar ya", y por tanto lo que hace innecesario un backend con
 * ffmpeg. Ver doc/04-ingesta-y-upload.md § 2.
 *
 * Se ejecuta **siempre dentro de un Web Worker**: aunque WebCodecs decodifica en hilos propios,
 * la orquestación y el trasiego de muestras bastan para hacer saltar el frame budget del hilo
 * principal en archivos largos.
 */
export async function extractAudio(
  file: File,
  profile: AudioProfile,
  /** Duración del medio, ya conocida por el sondeo. Evita recorrer el archivo otra vez. */
  mediaSeconds: number,
  onProgress?: (progress: ExtractionProgress) => void,
): Promise<AudioExtractionResult> {
  const startedAt = performance.now();

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: createOutputFormat(profile), target });

  try {
    const conversion = await Conversion.init({
      input,
      output,
      // Descartar el video es lo que hace que esto sea rápido: no se decodifica ni un frame.
      video: { discard: true },
      audio: {
        codec: profile.codec,
        numberOfChannels: profile.numberOfChannels,
        sampleRate: profile.sampleRate,
        quality: new Quality({ bitrate: profile.bitrate }),
        // Sin esto, Mediabunny copiaría los paquetes originales cuando el códec coincide,
        // y nos quedaríamos con los 170 MB de la pista intacta en vez de los 22 MB que
        // buscamos. La recompresión es justamente el objetivo.
        forceTranscode: true,
      },
    });

    if (!conversion.isValid) {
      // El video aparece siempre aquí porque lo descartamos nosotros: no es un problema.
      const problems = conversion.discardedTracks
        .filter((discarded) => discarded.reason !== 'discarded_by_user')
        .map((discarded) => DISCARD_REASONS[discarded.reason] ?? discarded.reason);

      const detail = problems.length > 0 ? ` Motivo: ${[...new Set(problems)].join('; ')}.` : '';
      throw new ExtractionError(`No se pudo preparar la extracción de audio.${detail}`);
    }

    if (onProgress) {
      conversion.onProgress = (progress, processedTime) => {
        onProgress({ stage: 'extracting', progress, processedSeconds: processedTime });
      };
    }

    await conversion.execute();

    const buffer = target.buffer;
    if (buffer === null) {
      throw new ExtractionError('La conversión terminó sin producir datos de audio.');
    }

    const blob = new Blob([buffer], { type: profile.mimeType });

    return {
      blob,
      profile,
      mediaSeconds,
      elapsedMs: performance.now() - startedAt,
      sourceBytes: file.size,
      outputBytes: blob.size,
      compressionRatio: blob.size > 0 ? file.size / blob.size : 0,
    };
  } finally {
    input.dispose();
  }
}
