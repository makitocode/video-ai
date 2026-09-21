/**
 * Agrupado de segmentos en turnos de conversación.
 *
 * El ASR devuelve intervenciones sueltas; cuando la misma persona encadena varias seguidas,
 * lo natural es leerlas como un solo turno. Lo usan tanto la vista que se le pasa al modelo
 * de resumen como las exportaciones legibles, así que vive aquí en vez de duplicado.
 */

export type SpeakerTurn = {
  startMs: number;
  endMs: number;
  speakerLabel: string;
  text: string;
};

/**
 * Funde los segmentos contiguos del mismo hablante en un único turno.
 *
 * **El turno conserva el inicio del primer segmento**, que es la marca que se cita y a la que
 * se salta. Quedarse con la del último haría que las citas del resumen apuntaran tarde.
 *
 * No muta la entrada: devuelve objetos nuevos.
 */
export function groupConsecutiveTurns(segments: readonly SpeakerTurn[]): SpeakerTurn[] {
  const turns: SpeakerTurn[] = [];

  for (const segment of segments) {
    const previous = turns[turns.length - 1];

    if (previous !== undefined && previous.speakerLabel === segment.speakerLabel) {
      previous.endMs = segment.endMs;
      previous.text = `${previous.text} ${segment.text}`.trim();
      continue;
    }

    turns.push({ ...segment });
  }

  return turns;
}
