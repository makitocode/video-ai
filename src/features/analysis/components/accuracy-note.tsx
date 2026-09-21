/**
 * Aviso de fiabilidad, en una frase y colocado antes del contenido.
 *
 * No al final en letra pequeña: el objetivo es que nadie reenvíe un acta de reunión sin
 * haberla revisado. El texto compartido con las exportaciones vive en `lib/accuracy-note`.
 */
export function AccuracyNote({ className }: { className?: string }) {
  return (
    <p className={className}>
      Esta transcripción y su análisis se generaron automáticamente a partir del audio, así que
      pueden contener errores de interpretación.{' '}
      <strong>Verifica siempre la información antes de usarla o compartirla.</strong>
    </p>
  );
}
