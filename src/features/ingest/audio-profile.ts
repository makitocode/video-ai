import { canEncodeAudio, Quality } from 'mediabunny';
import { AUDIO_CHANNELS, AUDIO_PROFILE_CANDIDATES } from '@/lib/constants';
import type { AudioProfile } from './types';

const CONTAINER_METADATA = {
  ogg: { fileExtension: 'ogg', mimeType: 'audio/ogg' },
  mp4: { fileExtension: 'm4a', mimeType: 'audio/mp4' },
} as const;

/**
 * Elige el primer perfil de audio que este navegador sabe codificar de verdad.
 *
 * No damos por hecho que Opus a 16 kHz funcione en todas partes: los encoders de WebCodecs
 * varían entre navegadores y plataformas, y algunos rechazan frecuencias de muestreo que
 * el códec sí admite sobre el papel. Preguntar es barato; fallar a mitad de una conversión
 * de 2 h no lo es.
 *
 * El orden de preferencia está en `AUDIO_PROFILE_CANDIDATES`. Devuelve `null` si ninguno
 * sirve, lo que manda el archivo a la ruta de escape.
 */
export async function resolveAudioProfile(): Promise<AudioProfile | null> {
  for (const candidate of AUDIO_PROFILE_CANDIDATES) {
    const supported = await canEncodeAudio(candidate.codec, {
      numberOfChannels: AUDIO_CHANNELS,
      sampleRate: candidate.sampleRate,
      quality: new Quality({ bitrate: candidate.bitrate }),
    });

    if (!supported) continue;

    return {
      codec: candidate.codec,
      container: candidate.container,
      sampleRate: candidate.sampleRate,
      numberOfChannels: AUDIO_CHANNELS,
      bitrate: candidate.bitrate,
      ...CONTAINER_METADATA[candidate.container],
    };
  }

  return null;
}

/** Estimación del tamaño de salida a partir del bitrate. Sirve para la UI antes de empezar. */
export function estimateAudioBytes(profile: AudioProfile, durationSeconds: number): number {
  // El overhead del contenedor es despreciable frente al payload a estos bitrates.
  return Math.round((profile.bitrate / 8) * durationSeconds);
}
