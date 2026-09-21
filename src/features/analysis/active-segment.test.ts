import { describe, expect, it } from 'vitest';
import { findActiveSegmentIndex } from './active-segment';
import type { TranscriptSegment } from '@/lib/domain';

function segment(idx: number, startMs: number, endMs: number): TranscriptSegment {
  return { id: `s${idx}`, idx, startMs, endMs, speakerId: null, text: '…', confidence: null };
}

const segments = [segment(0, 0, 3_000), segment(1, 3_000, 8_000), segment(2, 10_000, 15_000)];

describe('findActiveSegmentIndex', () => {
  it('localiza el segmento que suena en ese instante', () => {
    expect(findActiveSegmentIndex(segments, 1_500)).toBe(0);
    expect(findActiveSegmentIndex(segments, 5_000)).toBe(1);
    expect(findActiveSegmentIndex(segments, 12_000)).toBe(2);
  });

  it('es exacto en la frontera entre segmentos', () => {
    expect(findActiveSegmentIndex(segments, 3_000)).toBe(1);
  });

  it('mantiene el último hablante durante un silencio', () => {
    // Entre 8 s y 10 s no habla nadie. Dejar de resaltar ahí haría parpadear la interfaz.
    expect(findActiveSegmentIndex(segments, 9_000)).toBe(1);
  });

  it('devuelve -1 antes de que empiece el primer segmento', () => {
    expect(findActiveSegmentIndex([segment(0, 5_000, 9_000)], 1_000)).toBe(-1);
  });

  it('se mantiene en el último segmento al terminar la reproducción', () => {
    expect(findActiveSegmentIndex(segments, 999_999)).toBe(2);
  });

  it('devuelve -1 sin segmentos', () => {
    expect(findActiveSegmentIndex([], 1_000)).toBe(-1);
  });
});
