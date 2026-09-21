import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AnalysisView } from '@/features/analysis/components/analysis-view';
import { getMediaAssetDetail } from '@/server/repositories';

export const dynamic = 'force-dynamic';

/**
 * Carga el análisis en el servidor y lo entrega ya renderizado.
 *
 * Al leer directamente del repositorio se evita la cascada "pintar vacío → pedir por fetch →
 * repintar" que tendría un componente de cliente. El componente interactivo sólo recibe el
 * estado inicial y se encarga de mantenerlo vivo.
 */
export default async function MediaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = getMediaAssetDetail(id);

  if (asset === null) notFound();

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-10">
      <Link href="/" className="text-muted text-sm hover:underline">
        ← Todos los análisis
      </Link>
      <AnalysisView initial={asset} />
    </main>
  );
}
