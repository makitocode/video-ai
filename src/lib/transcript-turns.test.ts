import { describe, expect, it } from 'vitest';
import { groupConsecutiveTurns, type SpeakerTurn } from './transcript-turns';

const segments: SpeakerTurn[] = [
  { startMs: 1_000, endMs: 4_000, speakerLabel: 'A', text: 'Buenos días.' },
  { startMs: 4_200, endMs: 7_000, speakerLabel: 'A', text: 'Vamos a empezar.' },
  { startMs: 7_500, endMs: 9_000, speakerLabel: 'B', text: 'De acuerdo.' },
];

describe('groupConsecutiveTurns', () => {
  it('funde los segmentos seguidos del mismo hablante', () => {
    const turns = groupConsecutiveTurns(segments);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.text).toBe('Buenos días. Vamos a empezar.');
  });

  it('conserva el inicio del primer segmento y el final del último', () => {
    // El inicio es la marca que se cita y a la que se salta: cambiarla rompería la navegación.
    const [first] = groupConsecutiveTurns(segments);
    expect(first?.startMs).toBe(1_000);
    expect(first?.endMs).toBe(7_000);
  });

  it('no agrupa cuando el hablante cambia y vuelve', () => {
    const alternating: SpeakerTurn[] = [
      { startMs: 0, endMs: 1_000, speakerLabel: 'A', text: 'Uno.' },
      { startMs: 1_000, endMs: 2_000, speakerLabel: 'B', text: 'Dos.' },
      { startMs: 2_000, endMs: 3_000, speakerLabel: 'A', text: 'Tres.' },
    ];
    expect(groupConsecutiveTurns(alternating)).toHaveLength(3);
  });

  it('no muta la entrada', () => {
    const input: SpeakerTurn[] = [
      { startMs: 0, endMs: 1_000, speakerLabel: 'A', text: 'Uno.' },
      { startMs: 1_000, endMs: 2_000, speakerLabel: 'A', text: 'Dos.' },
    ];
    groupConsecutiveTurns(input);
    expect(input[0]?.text).toBe('Uno.');
    expect(input[0]?.endMs).toBe(1_000);
  });

  it('devuelve lista vacía sin segmentos', () => {
    expect(groupConsecutiveTurns([])).toEqual([]);
  });
});
