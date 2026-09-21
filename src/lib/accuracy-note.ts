/**
 * Aviso de fiabilidad del análisis.
 *
 * Todo lo que produce la aplicación —transcripción, nombres de los participantes, resumen—
 * se dedujo del audio y nada más. Cuando la gente se interrumpe o el micrófono falla, la
 * transcripción se equivoca, y el análisis hereda ese error.
 *
 * Vive en `lib/` y no junto al componente porque lo usan también las exportaciones: el aviso
 * tiene que viajar con el documento, que es justo donde nadie tiene la interfaz delante.
 */
export const ACCURACY_NOTE_TEXT =
  'Esta transcripción y su análisis se generaron automáticamente a partir del audio, así que ' +
  'pueden contener errores de interpretación. VERIFICA SIEMPRE LA INFORMACIÓN antes de usarla ' +
  'o compartirla.';
