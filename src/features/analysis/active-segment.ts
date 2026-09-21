import type { TranscriptSegment } from '@/lib/domain';

/**
 * Encuentra qué segmento del transcript está sonando en un instante dado.
 *
 * Se ejecuta en **cada frame** de reproducción, así que tiene que ser `O(log n)`: un
 * `.findIndex()` sobre los 2.000-3.000 segmentos de una grabación de dos horas, sesenta veces
 * por segundo, es exactamente el tipo de cosa que hunde el INP
 * (ver doc/06-frontend.md § El transcript largo es donde todo se rompe).
 *
 * Devuelve `-1` si el instante es anterior al primer segmento.
 */
export function findActiveSegmentIndex(
  segments: readonly TranscriptSegment[],
  timeMs: number,
): number {
  let low = 0;
  let high = segments.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const segment = segments[mid];
    if (segment === undefined) break;

    if (segment.startMs <= timeMs) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return candidate;
}
