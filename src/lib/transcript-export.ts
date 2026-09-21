import { speakerName, type Speaker, type Summary, type Transcript } from './domain';
import { groupConsecutiveTurns, type SpeakerTurn } from './transcript-turns';

/**
 * Exportación del transcript a formatos estándar.
 *
 * Funciones puras: entra el transcript, sale texto. Están aquí y no en la ruta de API para
 * poder cubrirlas con tests directos — el formato de marca de tiempo de SRT es de esas cosas
 * que fallan en silencio y sólo se notan cuando otro programa rechaza el archivo.
 */

export const EXPORT_FORMATS = ['txt', 'srt', 'vtt', 'md'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_FORMAT_META: Record<
  ExportFormat,
  { label: string; extension: string; mimeType: string; description: string }
> = {
  txt: {
    label: 'Texto plano',
    extension: 'txt',
    mimeType: 'text/plain; charset=utf-8',
    description: 'Legible, con hablantes y marcas de tiempo. Para leer o pegar en cualquier sitio.',
  },
  srt: {
    label: 'SubRip (.srt)',
    extension: 'srt',
    mimeType: 'application/x-subrip; charset=utf-8',
    description:
      'El formato de transcript más compatible: editores de video, reproductores y herramientas de subtítulos.',
  },
  vtt: {
    label: 'WebVTT (.vtt)',
    extension: 'vtt',
    mimeType: 'text/vtt; charset=utf-8',
    description:
      'Estándar web. Se puede cargar como pista de subtítulos en un <video> del navegador.',
  },
  md: {
    label: 'Markdown (.md)',
    extension: 'md',
    mimeType: 'text/markdown; charset=utf-8',
    description:
      'Resumen con sus citas más el transcript completo. Para compartir o archivar la reunión.',
  },
};

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

// --- Marcas de tiempo ---------------------------------------------------------

/**
 * `HH:MM:SS,mmm` — el formato de SubRip, con **coma** antes de los milisegundos y horas
 * siempre a dos dígitos. Usar punto es el error clásico que hace que otros programas
 * rechacen el archivo sin explicar por qué.
 */
export function formatSrtTime(totalMs: number): string {
  return formatClock(totalMs, ',');
}

/** `HH:MM:SS.mmm` — el formato de WebVTT, idéntico pero con punto. */
export function formatVttTime(totalMs: number): string {
  return formatClock(totalMs, '.');
}

function formatClock(totalMs: number, millisSeparator: ',' | '.'): string {
  const safeMs = Math.max(0, Math.round(totalMs));
  const pad = (value: number, width = 2) => value.toString().padStart(width, '0');

  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1_000);
  const millis = safeMs % 1_000;

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${millisSeparator}${pad(millis, 3)}`;
}

/** `hh:mm:ss` para las cabeceras legibles de texto y Markdown. */
function formatReadableTime(totalMs: number): string {
  const safeMs = Math.max(0, Math.round(totalMs));
  const pad = (value: number) => value.toString().padStart(2, '0');

  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1_000);

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

// --- Datos de apoyo -----------------------------------------------------------

export type ExportContext = {
  fileName: string;
  durationMs: number | null;
  transcript: Transcript;
  summary: Summary | null;
  generatedAt: Date;
};

/**
 * Convierte los segmentos a turnos con el **nombre visible** del hablante.
 *
 * Es lo que hace que renombrar a alguien en la interfaz se refleje en la descarga: la
 * exportación resuelve el nombre en el momento de generarla, no cuando se transcribió.
 */
function toNamedTurns(transcript: Transcript, grouped: boolean): SpeakerTurn[] {
  const nameById = new Map(
    transcript.speakers.map((speaker) => [speaker.id, speakerName(speaker)]),
  );

  const turns: SpeakerTurn[] = transcript.segments.map((segment) => ({
    startMs: segment.startMs,
    endMs: segment.endMs,
    speakerLabel:
      segment.speakerId === null
        ? 'Hablante desconocido'
        : (nameById.get(segment.speakerId) ?? 'Hablante desconocido'),
    text: segment.text,
  }));

  return grouped ? groupConsecutiveTurns(turns) : turns;
}

function describeSpeakers(speakers: readonly Speaker[]): string {
  return speakers.map((speaker) => speakerName(speaker)).join(', ');
}

// --- Formatos -----------------------------------------------------------------

/**
 * Texto plano legible.
 *
 * Agrupa los turnos contiguos del mismo hablante: leer diez líneas seguidas repitiendo el
 * mismo nombre es peor que leer un párrafo.
 */
export function toPlainText(context: ExportContext): string {
  const { transcript } = context;
  const turns = toNamedTurns(transcript, true);

  const header = [
    `Transcripción — ${context.fileName}`,
    [
      context.durationMs !== null ? `Duración: ${formatReadableTime(context.durationMs)}` : null,
      `Idioma: ${transcript.languageCode}`,
      `Hablantes: ${describeSpeakers(transcript.speakers)}`,
    ]
      .filter((part) => part !== null)
      .join(' · '),
    `Generado: ${context.generatedAt.toISOString()}`,
    '',
    '='.repeat(72),
    '',
  ].join('\n');

  const body = turns
    .map((turn) => `[${formatReadableTime(turn.startMs)}] ${turn.speakerLabel}\n${turn.text}`)
    .join('\n\n');

  return `${header}${body}\n`;
}

/**
 * SubRip.
 *
 * **Sin agrupar**: cada segmento es su propio bloque. Fundir turnos produciría bloques de
 * medio minuto, inservibles como subtítulos y peores incluso para revisar el transcript.
 */
export function toSubRip(context: ExportContext): string {
  const turns = toNamedTurns(context.transcript, false);

  return (
    turns
      .map((turn, index) =>
        [
          index + 1,
          `${formatSrtTime(turn.startMs)} --> ${formatSrtTime(turn.endMs)}`,
          `${turn.speakerLabel}: ${turn.text}`,
        ].join('\n'),
      )
      // SubRip separa los bloques con una línea en blanco y espera una al final.
      .join('\n\n') + '\n'
  );
}

/**
 * WebVTT.
 *
 * Usa la etiqueta de voz `<v Nombre>`, que es la forma estándar de atribuir hablante en este
 * formato, en vez de meter el nombre dentro del texto del subtítulo.
 */
export function toWebVtt(context: ExportContext): string {
  const turns = toNamedTurns(context.transcript, false);

  const cues = turns.map((turn, index) =>
    [
      index + 1,
      `${formatVttTime(turn.startMs)} --> ${formatVttTime(turn.endMs)}`,
      `<v ${escapeVttVoice(turn.speakerLabel)}>${escapeVttText(turn.text)}`,
    ].join('\n'),
  );

  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

/**
 * En WebVTT, `<`, `>` y `&` tienen significado propio (etiquetas y entidades), así que el
 * texto hablado que los contenga hay que escaparlo o el archivo queda mal formado.
 */
function escapeVttText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** El nombre del hablante va dentro de la etiqueta, donde un `>` la cerraría antes de tiempo. */
function escapeVttVoice(name: string): string {
  return name.replace(/[<>]/g, '');
}

/** Markdown: el resumen con sus citas y, debajo, el transcript completo. */
export function toMarkdown(context: ExportContext): string {
  const { transcript, summary } = context;
  const turns = toNamedTurns(transcript, true);
  const parts: string[] = [];

  parts.push(`# ${context.fileName}`);
  parts.push(
    [
      context.durationMs !== null
        ? `**Duración:** ${formatReadableTime(context.durationMs)}`
        : null,
      `**Idioma:** ${transcript.languageCode}`,
      `**Hablantes:** ${describeSpeakers(transcript.speakers)}`,
    ]
      .filter((part) => part !== null)
      .join(' · '),
  );

  if (summary !== null) {
    parts.push(`## Resumen\n\n### ${summary.headline}\n\n${summary.abstract}`);

    const sections = [
      { kind: 'key_point' as const, title: 'Puntos clave' },
      { kind: 'decision' as const, title: 'Decisiones' },
      { kind: 'action_item' as const, title: 'Tareas pendientes' },
    ];

    for (const section of sections) {
      const claims = summary.claims.filter((claim) => claim.kind === section.kind);
      if (claims.length === 0) continue;

      const lines = claims.map((claim) => {
        // Las marcas se conservan porque son verificables: cada una corresponde a un
        // segmento real del transcript que aparece más abajo en este mismo archivo.
        const citations = claim.citations
          .map((citation) => `\`${formatReadableTime(citation.startMs)}\``)
          .join(' ');
        return `- ${claim.text} ${citations}`.trim();
      });

      parts.push(`### ${section.title}\n\n${lines.join('\n')}`);
    }

    if (summary.chapters.length > 0) {
      const chapters = summary.chapters
        .map((chapter) => `- \`${formatReadableTime(chapter.startMs)}\` ${chapter.title}`)
        .join('\n');
      parts.push(`### Capítulos\n\n${chapters}`);
    }
  }

  const body = turns
    .map(
      (turn) => `**${turn.speakerLabel}** \`${formatReadableTime(turn.startMs)}\`\n\n${turn.text}`,
    )
    .join('\n\n');

  parts.push(`## Transcripción\n\n${body}`);

  return `${parts.join('\n\n')}\n`;
}

/** Punto de entrada único: elige el formato y devuelve el contenido. */
export function exportTranscript(format: ExportFormat, context: ExportContext): string {
  switch (format) {
    case 'txt':
      return toPlainText(context);
    case 'srt':
      return toSubRip(context);
    case 'vtt':
      return toWebVtt(context);
    case 'md':
      return toMarkdown(context);
  }
}

/**
 * Nombre de archivo seguro derivado del original.
 *
 * Se restringe a un juego de caracteres conservador por dos motivos: el nombre acaba en una
 * cabecera HTTP, donde un salto de línea permitiría inyectar cabeceras, y además tiene que
 * ser un nombre válido en cualquier sistema de archivos.
 */
export function buildExportFileName(originalFileName: string, format: ExportFormat): string {
  return `${sanitizeFileBase(originalFileName)}.${EXPORT_FORMAT_META[format].extension}`;
}

/** Igual, para archivos que no son transcripciones: el audio extraído, por ejemplo. */
export function buildMediaFileName(originalFileName: string, extension: string): string {
  const safeExtension = extension
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    .slice(0, 8);

  return `${sanitizeFileBase(originalFileName)}.${safeExtension.length > 0 ? safeExtension : 'bin'}`;
}

function sanitizeFileBase(originalFileName: string): string {
  const safe = originalFileName
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    // Quita los diacríticos y conserva la letra base: "reunión" queda como "reunion".
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return safe.length > 0 ? safe : 'transcripcion';
}
