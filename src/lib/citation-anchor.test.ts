import { describe, expect, it } from 'vitest';
import { findSegmentAt, type AnchorableSegment } from './citation-anchor';

const segments: AnchorableSegment[] = [
  { id: 'a', startMs: 1_000, endMs: 4_000 },
  { id: 'b', startMs: 4_000, endMs: 9_000 },
  // Hueco deliberado entre 9 s y 12 s: un silencio en la conversación.
  { id: 'c', startMs: 12_000, endMs: 20_000 },
];

describe('findSegmentAt', () => {
  it('encuentra el segmento que contiene la marca', () => {
    expect(findSegmentAt(segments, 2_000)?.id).toBe('a');
    expect(findSegmentAt(segments, 5_000)?.id).toBe('b');
    expect(findSegmentAt(segments, 19_999)?.id).toBe('c');
  });

  it('ancla exactamente en el inicio de un segmento', () => {
    expect(findSegmentAt(segments, 4_000)?.id).toBe('b');
    expect(findSegmentAt(segments, 12_000)?.id).toBe('c');
  });

  it('acepta el segmento anterior cuando la marca cae en un silencio', () => {
    // El modelo citó 10 s, donde nadie hablaba. La intervención relevante es la anterior.
    expect(findSegmentAt(segments, 10_000)?.id).toBe('b');
  });

  it('rechaza una marca anterior al primer segmento: no respalda nada', () => {
    expect(findSegmentAt(segments, 0)).toBeNull();
    expect(findSegmentAt(segments, 999)).toBeNull();
  });

  it('acepta una marca posterior al final anclándola al último segmento', () => {
    expect(findSegmentAt(segments, 60_000)?.id).toBe('c');
  });

  it('devuelve null si no hay transcript', () => {
    expect(findSegmentAt([], 1_000)).toBeNull();
  });
});
