/**
 * Aviso de transcripción simulada.
 *
 * Existe porque un contenido de ejemplo que parece una reunión real es una trampa: se lee
 * como bueno y hace perder el tiempo a quien lo revisa. El aviso va **encima del reproductor**,
 * antes que cualquier otra cosa, y no se puede cerrar.
 */
export function SimulatedTranscriptBanner() {
  return (
    <div
      role="alert"
      className="border-danger/50 bg-danger/10 space-y-2 rounded-md border-2 px-4 py-3"
    >
      <p className="text-danger text-sm font-semibold">
        ⚠ Esta transcripción es simulada — no proviene de tu audio
      </p>
      <p className="text-sm leading-relaxed">
        No hay ninguna clave de transcripción configurada, así que se generó una conversación de
        ejemplo. Nada de lo que leas abajo corresponde a lo que se dijo en tu grabación.
      </p>
      <p className="text-muted text-xs">
        Para transcribir de verdad: consigue una clave en{' '}
        <a
          href="https://www.assemblyai.com/"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline"
        >
          assemblyai.com
        </a>{' '}
        (sin tarjeta, con crédito gratis), ponla como <code>ASSEMBLYAI_API_KEY</code> en{' '}
        <code>.env.local</code>, reinicia el servidor y vuelve a subir el video.
      </p>
    </div>
  );
}
