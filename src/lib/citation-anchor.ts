/**
 * Anclaje de citas del resumen contra segmentos reales del transcript.
 *
 * Es el mecanismo que hace verificable la promesa del producto: una afirmación del resumen
 * sólo se guarda si su marca de tiempo cae dentro de algo que alguien dijo de verdad. Vive
 * en un módulo puro porque es lógica crítica y merece tests directos.
 */

export type AnchorableSegment = {
  id: string;
  startMs: number;
  endMs: number;
};

/**
 * Encuentra el segmento al que pertenece una marca de tiempo, por búsqueda binaria.
 *
 * Si la marca cae en un hueco entre segmentos (un silencio), se acepta el segmento
 * inmediatamente anterior: un modelo tiende a citar el inicio aproximado de una intervención,
 * y ser estrictos ahí descartaría citas correctas por unos milisegundos. Lo que sí se rechaza
 * es una marca **anterior al primer segmento**, porque no apunta a nada real.
 */
export function findSegmentAt(
  segments: readonly AnchorableSegment[],
  targetMs: number,
): AnchorableSegment | null {
  let low = 0;
  let high = segments.length - 1;
  let candidate: AnchorableSegment | null = null;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const segment = segments[mid];
    if (segment === undefined) break;

    if (segment.startMs <= targetMs) {
      candidate = segment;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return candidate;
}
