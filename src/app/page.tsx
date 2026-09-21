import Link from 'next/link';
import { UploadPanel } from '@/features/ingest/components/upload-panel';
import { formatDuration } from '@/lib/format';
import { describeProviders } from '@/server/config';
import { listMediaAssets } from '@/server/repositories';

export const dynamic = 'force-dynamic';

const STATE_LABEL: Record<string, string> = {
  created: 'preparando',
  uploading_audio: 'subiendo',
  transcribing: 'transcribiendo',
  summarizing: 'resumiendo',
  ready: 'listo',
  failed: 'falló',
};

export default function HomePage() {
  const assets = listMediaAssets();
  const providers = describeProviders();
  const simulated = [providers.transcription, providers.summary].filter((p) => !p.real);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">video-ai</h1>
        <p className="text-muted text-sm text-balance">
          Sube un video y obtén su transcripción con separación de hablantes y un resumen con
          referencias al minuto exacto.
        </p>
      </header>

      {simulated.length > 0 && (
        <div className="border-warning/40 bg-warning/5 space-y-1 rounded-md border px-4 py-3 text-sm">
          <p className="text-warning font-medium">Ejecutando con proveedores simulados</p>
          <ul className="text-muted list-inside list-disc text-xs">
            {simulated.map((provider) => (
              <li key={provider.hint}>{provider.hint}</li>
            ))}
          </ul>
          <p className="text-muted text-xs">
            Todo el flujo funciona igual: sólo el contenido del transcript y del resumen es
            sintético.
          </p>
        </div>
      )}

      <UploadPanel />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Análisis</h2>

        {assets.length === 0 ? (
          <p className="text-muted text-sm">Todavía no has analizado ningún video.</p>
        ) : (
          <ul className="space-y-2">
            {assets.map((asset) => (
              <li key={asset.id}>
                <Link
                  href={`/media/${asset.id}`}
                  className="border-border bg-surface hover:border-accent flex items-center justify-between gap-4 rounded-md border px-4 py-3 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {asset.originalFilename}
                    </span>
                    <span className="text-muted text-xs">
                      {asset.durationMs !== null && (
                        <>{formatDuration(asset.durationMs / 1000)} · </>
                      )}
                      {STATE_LABEL[asset.job.state] ?? asset.job.state}
                    </span>
                  </span>
                  <span className="text-muted shrink-0 text-xs">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="border-border border-t pt-6">
        <Link href="/spike" className="text-muted text-xs hover:underline">
          Banco de pruebas de extracción (Fase 1)
        </Link>
      </footer>
    </main>
  );
}
