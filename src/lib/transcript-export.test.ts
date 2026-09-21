import { describe, expect, it } from 'vitest';
import {
  buildExportFileName,
  exportTranscript,
  formatSrtTime,
  formatVttTime,
  toMarkdown,
  toPlainText,
  toSubRip,
  toWebVtt,
  type ExportContext,
} from './transcript-export';
import type { Speaker, Summary, Transcript, TranscriptSegment } from './domain';

function speaker(id: string, label: string, displayName: string | null = null): Speaker {
  return {
    id,
    label,
    displayName,
    suggestedName: null,
    suggestionEvidenceMs: null,
    suggestionConfidence: null,
    role: null,
    identifiedBy: null,
    colorIndex: 0,
    totalSpeakingMs: 1_000,
  };
}

function segment(
  idx: number,
  startMs: number,
  endMs: number,
  speakerId: string | null,
  text: string,
): TranscriptSegment {
  return { id: `seg-${idx}`, idx, startMs, endMs, speakerId, text, confidence: null };
}

const transcript: Transcript = {
  languageCode: 'es',
  languageConfidence: 0.99,
  provider: 'mock',
  modelVersion: null,
  speakersIdentifiedAt: '2026-09-21 10:00:00',
  wordCount: 12,
  speakers: [speaker('sp-a', 'Speaker A', 'María'), speaker('sp-b', 'Speaker B')],
  segments: [
    segment(0, 1_000, 4_000, 'sp-a', 'Buenos días.'),
    segment(1, 4_200, 7_000, 'sp-a', 'Vamos a empezar.'),
    segment(2, 7_500, 9_000, 'sp-b', 'De acuerdo.'),
  ],
};

const summary: Summary = {
  headline: 'Revisión trimestral',
  overview: [
    'Se revisaron los números del trimestre.',
    'Quedó pendiente confirmar el presupuesto de marketing.',
  ],
  topics: [
    {
      id: 't1',
      title: 'Apertura',
      startMs: 0,
      endMs: 9_000,
      claims: [
        {
          id: 'c1',
          kind: 'key_point',
          text: 'La reunión abrió con la revisión del trimestre.',
          ownerSpeakerId: 'sp-a',
          citations: [{ segmentId: 'seg-0', startMs: 1_000 }],
        },
      ],
    },
  ],
  decisions: [],
  actionItems: [
    {
      id: 'a1',
      kind: 'action_item',
      text: 'Desbloquear el presupuesto de marketing.',
      ownerSpeakerId: 'sp-b',
      citations: [{ segmentId: 'seg-2', startMs: 7_500 }],
    },
  ],
  model: 'mock',
  promptStamp: 'analysis/system@1.0.0',
};

function context(overrides: Partial<ExportContext> = {}): ExportContext {
  return {
    fileName: 'reunión Q3.mp4',
    durationMs: 9_000,
    transcript,
    summary,
    generatedAt: new Date('2026-09-21T10:00:00Z'),
    ...overrides,
  };
}

describe('formato de marcas de tiempo', () => {
  it('SubRip usa coma antes de los milisegundos y horas a dos dígitos', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
    expect(formatSrtTime(3_725_400)).toBe('01:02:05,400');
  });

  it('WebVTT usa punto', () => {
    expect(formatVttTime(3_725_400)).toBe('01:02:05.400');
  });

  it('no produce marcas negativas', () => {
    expect(formatSrtTime(-5)).toBe('00:00:00,000');
  });
});

describe('toPlainText', () => {
  it('agrupa los turnos seguidos del mismo hablante', () => {
    const output = toPlainText(context());
    expect(output).toContain('Buenos días. Vamos a empezar.');
    // Dos turnos, no tres: los dos de María se fundieron.
    expect(output.match(/^\[\d/gm)).toHaveLength(2);
  });

  it('usa el nombre que puso el usuario, no la etiqueta del proveedor', () => {
    const output = toPlainText(context());
    expect(output).toContain('María');
    expect(output).not.toContain('Speaker A');
  });

  it('incluye una cabecera con duración, idioma y hablantes', () => {
    const output = toPlainText(context());
    expect(output).toContain('Transcripción — reunión Q3.mp4');
    expect(output).toContain('Idioma: es');
  });
});

describe('toSubRip', () => {
  it('numera los bloques desde 1 y los separa con una línea en blanco', () => {
    const blocks = toSubRip(context()).trim().split('\n\n');
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.startsWith('1\n')).toBe(true);
    expect(blocks[2]?.startsWith('3\n')).toBe(true);
  });

  it('NO agrupa turnos: un bloque por segmento', () => {
    // Fundir turnos produciría bloques de medio minuto, inservibles como subtítulos.
    expect(toSubRip(context())).toContain('00:00:01,000 --> 00:00:04,000');
    expect(toSubRip(context())).toContain('00:00:04,200 --> 00:00:07,000');
  });

  it('antepone el hablante al texto del bloque', () => {
    expect(toSubRip(context())).toContain('María: Buenos días.');
  });

  it('termina con salto de línea, como espera el formato', () => {
    expect(toSubRip(context()).endsWith('\n')).toBe(true);
  });
});

describe('toWebVtt', () => {
  it('empieza por la cabecera WEBVTT', () => {
    expect(toWebVtt(context()).startsWith('WEBVTT\n\n')).toBe(true);
  });

  it('atribuye el hablante con la etiqueta de voz estándar', () => {
    expect(toWebVtt(context())).toContain('<v María>Buenos días.');
  });

  it('escapa los caracteres que romperían el formato', () => {
    const hostile: Transcript = {
      ...transcript,
      segments: [segment(0, 0, 1_000, 'sp-b', 'Uso <b>etiquetas</b> y A & B')],
    };
    const output = toWebVtt(context({ transcript: hostile }));
    expect(output).toContain('&lt;b&gt;etiquetas&lt;/b&gt;');
    expect(output).toContain('A &amp; B');
  });

  it('no deja que un nombre de hablante cierre la etiqueta de voz', () => {
    const tricky: Transcript = {
      ...transcript,
      speakers: [speaker('sp-b', 'Speaker B', 'Ana>malicia')],
      segments: [segment(0, 0, 1_000, 'sp-b', 'Hola.')],
    };
    expect(toWebVtt(context({ transcript: tricky }))).toContain('<v Anamalicia>Hola.');
  });
});

describe('toMarkdown', () => {
  it('incluye el informe completo y el transcript', () => {
    const output = toMarkdown(context());
    expect(output).toContain('## Revisión trimestral');
    expect(output).toContain('## Puntos clave');
    expect(output).toContain('### Apertura');
    expect(output).toContain('## Decisiones');
    expect(output).toContain('## Tareas pendientes');
    expect(output).toContain('`00:01`'); // cita verificable
    expect(output).toContain('## Transcripción');
  });

  it('dice explícitamente cuando no hubo decisiones, en vez de callarlo', () => {
    // Una sección vacía sin explicación se lee como un fallo del análisis.
    expect(toMarkdown(context())).toContain('No se tomó ninguna decisión en firme');
  });

  it('omite el informe si todavía no existe, pero conserva el transcript', () => {
    const output = toMarkdown(context({ summary: null }));
    expect(output).not.toContain('## Puntos clave');
    expect(output).toContain('## Transcripción');
  });

  it('arrastra el aviso de fiabilidad: el documento se lee fuera de la aplicación', () => {
    expect(toMarkdown(context())).toContain('VERIFICA SIEMPRE LA INFORMACIÓN');
    expect(toPlainText(context())).toContain('VERIFICA SIEMPRE LA INFORMACIÓN');
  });
});

describe('buildExportFileName', () => {
  it('deriva el nombre del original y cambia la extensión', () => {
    expect(buildExportFileName('reunion-q3.mp4', 'srt')).toBe('reunion-q3.srt');
  });

  it('quita acentos y sustituye lo que no sea seguro', () => {
    expect(buildExportFileName('reunión Q3 (final).mov', 'txt')).toBe('reunion-Q3-final.txt');
  });

  it('neutraliza un nombre que intentara inyectar cabeceras HTTP', () => {
    const malicious = 'archivo\r\nContent-Type: text/html.mp4';
    const result = buildExportFileName(malicious, 'txt');
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
  });

  it('usa un nombre por defecto si no queda nada utilizable', () => {
    expect(buildExportFileName('...', 'vtt')).toBe('transcripcion.vtt');
  });
});

describe('exportTranscript', () => {
  it('despacha a cada formato', () => {
    expect(exportTranscript('srt', context())).toContain('-->');
    expect(exportTranscript('vtt', context())).toContain('WEBVTT');
    expect(exportTranscript('md', context())).toContain('# reunión Q3.mp4');
    expect(exportTranscript('txt', context())).toContain('Transcripción —');
  });
});
