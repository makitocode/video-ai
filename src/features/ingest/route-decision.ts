import type { AudioTrackSummary, IngestRoute } from './types';

export type RouteDecision = {
  route: IngestRoute;
  /** Explicación legible de por qué se eligió esa ruta. Se muestra al usuario tal cual. */
  reason: string;
};

/**
 * Decide por qué ruta pasa un archivo.
 *
 * La ruta rápida exige dos capacidades a la vez: poder **leer** el audio de este archivo y
 * poder **escribir** audio comprimido. Si falta cualquiera de las dos, ruta de escape: se sube
 * el original y el demux lo hace el proveedor de ASR. Más lento, pero nunca un callejón sin
 * salida (doc/02-adr-backend-serverless.md § La ruta de escape).
 *
 * Es una función pura y sin dependencias del navegador a propósito: es la bifurcación más
 * importante del pipeline y merece estar cubierta por tests directos.
 */
export function decideRoute(audioTracks: AudioTrackSummary[], canEncode: boolean): RouteDecision {
  if (audioTracks.length === 0) {
    return {
      route: 'escape',
      reason:
        'El archivo no tiene pista de audio, así que no hay nada que transcribir. ' +
        'Revisa que sea el archivo correcto.',
    };
  }

  const decodable = audioTracks.filter((track) => track.canDecode);

  if (decodable.length === 0) {
    const codecs = [...new Set(audioTracks.map((track) => track.codec ?? 'desconocido'))].join(
      ', ',
    );
    return {
      route: 'escape',
      reason:
        `Este navegador no puede decodificar el audio (${codecs}). Se subirá el archivo ` +
        'original y la extracción la hará el proveedor de transcripción.',
    };
  }

  if (!canEncode) {
    return {
      route: 'escape',
      reason:
        'Este navegador no ofrece ningún encoder de audio compatible, así que no se puede ' +
        'comprimir aquí. Se subirá el archivo original.',
    };
  }

  return {
    route: 'fast',
    reason:
      'El navegador puede decodificar y recomprimir el audio, así que el análisis arranca ' +
      'sin esperar a que suba el video.',
  };
}
