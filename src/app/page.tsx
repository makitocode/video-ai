import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-4 py-16">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">video-ai</h1>
        <p className="text-muted text-balance">
          Transcripción con diarización y resumen con referencias temporales, sin esperar a que suba
          el video.
        </p>
      </div>

      <div className="border-border bg-surface space-y-3 rounded-lg border p-5">
        <h2 className="font-medium">Fase 1 — spike técnico</h2>
        <p className="text-muted text-sm">
          Antes de construir producto hay que validar la hipótesis que sostiene toda la
          arquitectura: que el navegador puede extraer el audio de un video de varios GB de forma
          rápida y fiable. El banco de pruebas lo mide sobre archivos reales.
        </p>
        <Link
          href="/spike"
          className="bg-accent inline-flex rounded-md px-4 py-2 text-sm font-medium text-white"
        >
          Abrir el banco de pruebas
        </Link>
      </div>
    </main>
  );
}
