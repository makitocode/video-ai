/**
 * Construye la vista del transcript que se le pasa al modelo de resumen.
 *
 * No se le da el texto crudo: se le da cada intervención precedida de su marca de tiempo
 * exacta y su hablante. Esas marcas son las anclas que el modelo debe copiar en sus citas, y
 * lo que después permite verificar el resumen contra el transcript
 * (ver doc/05-pipeline-analisis.md § Entrada al modelo).
 *
 * Los turnos contiguos del mismo hablante se agrupan: reduce tokens de forma notable sin
 * perder granularidad, porque la marca que importa es la del inicio de la intervención.
 */

export type AnchorableSegmentInput = {
  startMs: number;
  endMs: number;
  speakerLabel: string;
  text: string;
};

/** Formatea milisegundos como `hh:mm:ss.mmm`, el formato que el prompt pide copiar. */
export function formatAnchor(totalMs: number): string {
  const safeMs = Math.max(0, Math.round(totalMs));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1_000);
  const millis = safeMs % 1_000;

  const pad = (value: number, width = 2) => value.toString().padStart(width, '0');
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

export function buildAnchoredTranscript(segments: readonly AnchorableSegmentInput[]): string {
  const grouped: AnchorableSegmentInput[] = [];

  for (const segment of segments) {
    const previous = grouped[grouped.length - 1];

    if (previous !== undefined && previous.speakerLabel === segment.speakerLabel) {
      // Se conserva el inicio del primer turno del bloque: es el ancla que el modelo citará.
      previous.endMs = segment.endMs;
      previous.text = `${previous.text} ${segment.text}`.trim();
      continue;
    }

    grouped.push({ ...segment });
  }

  return grouped
    .map((segment) => `[${formatAnchor(segment.startMs)}] ${segment.speakerLabel}: ${segment.text}`)
    .join('\n');
}
