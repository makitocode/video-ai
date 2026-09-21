import { describe, expect, it } from 'vitest';
import { buildAnchoredTranscript, formatAnchor } from './anchored-transcript';

describe('formatAnchor', () => {
  it('formatea con horas, minutos, segundos y milisegundos', () => {
    expect(formatAnchor(0)).toBe('0:00:00.000');
    expect(formatAnchor(1_500)).toBe('0:00:01.500');
    expect(formatAnchor(3_725_400)).toBe('1:02:05.400');
  });

  it('no produce marcas negativas', () => {
    expect(formatAnchor(-10)).toBe('0:00:00.000');
  });
});

describe('buildAnchoredTranscript', () => {
  const segments = [
    { startMs: 1_000, endMs: 4_000, speakerLabel: 'Speaker A', text: 'Buenos días.' },
    { startMs: 4_200, endMs: 7_000, speakerLabel: 'Speaker A', text: 'Vamos a empezar.' },
    { startMs: 7_500, endMs: 9_000, speakerLabel: 'Speaker B', text: 'De acuerdo.' },
  ];

  it('antepone marca de tiempo y hablante a cada intervención', () => {
    const output = buildAnchoredTranscript([segments[2]!]);
    expect(output).toBe('[0:00:07.500] Speaker B: De acuerdo.');
  });

  it('agrupa turnos contiguos del mismo hablante', () => {
    const lines = buildAnchoredTranscript(segments).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('[0:00:01.000] Speaker A: Buenos días. Vamos a empezar.');
  });

  it('conserva el inicio del primer turno al agrupar: es el ancla que se citará', () => {
    // Si se conservara el del último, las citas del resumen apuntarían tarde.
    expect(buildAnchoredTranscript(segments)).toContain('[0:00:01.000] Speaker A');
    expect(buildAnchoredTranscript(segments)).not.toContain('[0:00:04.200]');
  });

  it('no agrupa cuando cambia el hablante y vuelve el anterior', () => {
    const alternating = [
      { startMs: 0, endMs: 1_000, speakerLabel: 'Speaker A', text: 'Uno.' },
      { startMs: 1_000, endMs: 2_000, speakerLabel: 'Speaker B', text: 'Dos.' },
      { startMs: 2_000, endMs: 3_000, speakerLabel: 'Speaker A', text: 'Tres.' },
    ];
    expect(buildAnchoredTranscript(alternating).split('\n')).toHaveLength(3);
  });

  it('devuelve cadena vacía sin segmentos', () => {
    expect(buildAnchoredTranscript([])).toBe('');
  });
});
