'use client';

import { EXPORT_FORMATS, EXPORT_FORMAT_META } from '@/lib/transcript-export';

/**
 * Descarga del transcript.
 *
 * Son enlaces normales, no botones con JavaScript: el navegador ya sabe descargar archivos, y
 * así funcionan «abrir en pestaña nueva» y «guardar enlace como» sin que tengamos que
 * reimplementarlos. El desplegable es un `<details>` nativo, que se abre con teclado sin
 * necesidad de gestionar foco a mano.
 */
export function ExportMenu({ assetId }: { assetId: string }) {
  return (
    <details className="relative">
      <summary className="border-border hover:bg-surface cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium">
        Descargar
      </summary>

      <div className="border-border bg-background absolute right-0 z-10 mt-1 w-80 rounded-md border p-1 shadow-lg">
        <ul>
          {EXPORT_FORMATS.map((format) => {
            const meta = EXPORT_FORMAT_META[format];
            return (
              <li key={format}>
                <a
                  href={`/api/media/${assetId}/export?format=${format}`}
                  download
                  className="hover:bg-surface block rounded px-3 py-2"
                >
                  <span className="block text-sm font-medium">{meta.label}</span>
                  <span className="text-muted block text-xs">{meta.description}</span>
                </a>
              </li>
            );
          })}
        </ul>

        <hr className="border-border my-1" />

        <a
          href={`/api/media/${assetId}/file/audio?download=1`}
          download
          className="hover:bg-surface block rounded px-3 py-2"
        >
          <span className="block text-sm font-medium">Audio extraído (.ogg)</span>
          <span className="text-muted block text-xs">
            Opus mono 16 kHz, el audio que se envió a transcribir. Lo aceptan AssemblyAI, Whisper y
            la mayoría de herramientas de voz.
          </span>
        </a>
      </div>
    </details>
  );
}
