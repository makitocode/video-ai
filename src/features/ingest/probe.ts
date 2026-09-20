import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { CONTAINER_SNIFF_BYTES } from '@/lib/constants';
import { isAcceptedContainer, sniffContainer } from './container-sniff';
import { resolveAudioProfile } from './audio-profile';
import { decideRoute } from './route-decision';
import type { AudioTrackSummary, ProbeResult, VideoTrackSummary } from './types';

/** Error de sondeo con mensaje pensado para mostrarse al usuario tal cual. */
export class ProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProbeError';
  }
}

/**
 * Examina un archivo sin descargarlo ni copiarlo entero: Mediabunny lee por rangos sobre el
 * `File` local, así que esto cuesta milisegundos incluso con 5 GB.
 *
 * Decide además qué ruta seguirá el archivo, que es la decisión más importante del pipeline.
 */
export async function probeFile(file: File): Promise<ProbeResult> {
  const startedAt = performance.now();

  // 1. Filtro barato: ¿esto es siquiera un archivo de medios?
  const headerBytes = new Uint8Array(await file.slice(0, CONTAINER_SNIFF_BYTES).arrayBuffer());
  const container = sniffContainer(headerBytes);

  if (!isAcceptedContainer(container)) {
    throw new ProbeError(
      'El archivo no parece ser de audio ni de video. Sus primeros bytes no corresponden a ' +
        'ningún contenedor conocido.',
    );
  }

  // 2. Identificación autoritativa con Mediabunny.
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  try {
    if (!(await input.canRead())) {
      throw new ProbeError('El archivo está corrupto o su formato no se puede leer.');
    }

    const [format, mimeType, durationSeconds, videoTracks, audioTracks] = await Promise.all([
      input.getFormat(),
      input.getMimeType(),
      readDuration(input),
      input.getVideoTracks(),
      input.getAudioTracks(),
    ]);

    const videoSummaries: VideoTrackSummary[] = await Promise.all(
      videoTracks.map(async (track) => ({
        codec: track.codec,
        codecString: await track.getCodecParameterString(),
        canDecode: await track.canDecode(),
        displayWidth: track.displayWidth,
        displayHeight: track.displayHeight,
      })),
    );

    const audioSummaries: AudioTrackSummary[] = await Promise.all(
      audioTracks.map(async (track) => ({
        codec: track.codec,
        codecString: await track.getCodecParameterString(),
        canDecode: await track.canDecode(),
        sampleRate: track.sampleRate,
        numberOfChannels: track.numberOfChannels,
        languageCode: track.languageCode,
      })),
    );

    const audioProfile = await resolveAudioProfile();
    const { route, reason } = decideRoute(audioSummaries, audioProfile !== null);

    return {
      fileName: file.name,
      fileBytes: file.size,
      container,
      formatName: format.name,
      mimeType,
      durationSeconds,
      videoTracks: videoSummaries,
      audioTracks: audioSummaries,
      route,
      routeReason: reason,
      audioProfile,
      elapsedMs: performance.now() - startedAt,
    };
  } finally {
    // Libera los recursos del demuxer aunque el sondeo haya fallado.
    input.dispose();
  }
}

/**
 * Lee la duración por el camino barato.
 *
 * `computeDuration()` es exacto pero recorre todos los paquetes de todas las pistas: sobre un
 * archivo de varios GB eso convierte un sondeo de milisegundos en uno de minutos. Los metadatos
 * del contenedor ya traen la duración en la práctica totalidad de los archivos reales, así que
 * el cálculo exacto queda sólo como reserva.
 */
async function readDuration(input: Input): Promise<number> {
  const fromMetadata = await input.getDurationFromMetadata();
  return fromMetadata ?? (await input.computeDuration());
}
