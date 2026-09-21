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

import { groupConsecutiveTurns, type SpeakerTurn } from './transcript-turns';

export type AnchorableSegmentInput = SpeakerTurn;

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
  return groupConsecutiveTurns(segments)
    .map((turn) => `[${formatAnchor(turn.startMs)}] ${turn.speakerLabel}: ${turn.text}`)
    .join('\n');
}
