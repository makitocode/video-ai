'use client';

import { useState } from 'react';

/**
 * Aviso de transcripción simulada.
 *
 * Existe porque un contenido de ejemplo que parece una reunión real es una trampa: se lee
 * como bueno y hace perder el tiempo a quien lo revisa. El aviso va **encima del reproductor**,
 * antes que cualquier otra cosa, y no se puede cerrar.
 *
 * Incluye el botón para relanzar el análisis: quien ve este aviso está, casi por definición,
 * a un paso de configurar la clave, y obligarle a volver a subir el video después sería
 * gratuito — el audio ya está en el servidor.
 */
export function SimulatedTranscriptBanner({ onReanalyze }: { onReanalyze: () => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'working'>('idle');

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

      <ol className="text-muted list-inside list-decimal space-y-1 text-xs">
        <li>
          Consigue una clave en{' '}
          <a
            href="https://www.assemblyai.com/dashboard/api-keys"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            assemblyai.com
          </a>{' '}
          (sin tarjeta, con crédito gratis).
        </li>
        <li>
          Ponla en <code>.env.local</code> como{' '}
          <code className="text-foreground">ASSEMBLYAI_API_KEY=&quot;...&quot;</code> —{' '}
          <strong>sin el «#» delante</strong>, o la línea queda comentada y no se lee.
        </li>
        <li>Reinicia el servidor: Next sólo lee ese archivo al arrancar.</li>
        <li>Vuelve aquí y pulsa el botón de abajo.</li>
      </ol>

      <button
        type="button"
        disabled={state === 'working'}
        onClick={() => {
          setState('working');
          // El estado no se restaura al terminar: el análisis relanzado actualiza la vista
          // por su cuenta, y dejar el botón deshabilitado evita dispararlo dos veces.
          void onReanalyze().catch(() => setState('idle'));
        }}
        className="border-danger/40 hover:bg-danger/10 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
      >
        {state === 'working' ? 'Relanzando…' : 'Ya configuré la clave — volver a analizar'}
      </button>

      <p className="text-muted text-xs">
        El audio ya está subido, así que relanzar no vuelve a subir el video.
      </p>
    </div>
  );
}
