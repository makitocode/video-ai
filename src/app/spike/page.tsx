import Link from 'next/link';
import { ExtractionSpike } from '@/features/ingest/components/extraction-spike';

export const metadata = {
  title: 'Spike de extracción · video-ai',
};

export default function SpikePage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-8 px-4 py-12">
      <header className="space-y-3">
        <Link href="/" className="text-muted text-sm hover:underline">
          ← Inicio
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Spike de extracción de audio</h1>
        <p className="text-muted text-sm text-balance">
          Mide la hipótesis sobre la que descansa toda la arquitectura: que este navegador puede
          extraer la pista de audio de un video grande, rápido y sin bloquear la interfaz. Los
          umbrales son los criterios de salida de la Fase 1.
        </p>
      </header>

      <ExtractionSpike />

      <footer className="text-muted border-border space-y-1 border-t pt-6 text-xs">
        <p>
          Prueba con archivos variados: MP4/H.264, MOV/HEVC, MKV, WebM, y duraciones de 10 min, 1 h
          y 3 h. Lo que interesa no es el mejor caso, sino cuántas combinaciones caen en la ruta de
          escape.
        </p>
        <p>Los resultados se anotan en doc/11-resultados-spike.md.</p>
      </footer>
    </main>
  );
}
