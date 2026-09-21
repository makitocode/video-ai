import {
  buildExportFileName,
  EXPORT_FORMAT_META,
  exportTranscript,
  isExportFormat,
} from '@/lib/transcript-export';
import { getMediaAssetDetail } from '@/server/repositories';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Descarga el transcript en el formato pedido.
 *
 * Se genera en el servidor y no en el cliente a propósito: así la descarga es un enlace
 * normal —funciona con «guardar enlace como», se puede pedir con `curl` y el nombre del
 * archivo lo fija el servidor— en vez de depender de construir un Blob en JavaScript.
 *
 * El contenido se calcula en el momento, no se guarda: si el usuario renombra un hablante,
 * la siguiente descarga ya lleva el nombre nuevo sin tener que invalidar nada.
 */
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get('format') ?? 'txt';

  if (!isExportFormat(format)) {
    return new Response(`Formato no soportado: ${format}`, { status: 400 });
  }

  const asset = getMediaAssetDetail(id);
  if (asset === null) return new Response('No existe ese análisis.', { status: 404 });

  if (asset.transcript === null) {
    return new Response('Todavía no hay transcripción que descargar.', { status: 409 });
  }

  const body = exportTranscript(format, {
    fileName: asset.originalFilename,
    durationMs: asset.durationMs,
    transcript: asset.transcript,
    summary: asset.summary,
    generatedAt: new Date(),
  });

  const fileName = buildExportFileName(asset.originalFilename, format);

  return new Response(body, {
    headers: {
      'content-type': EXPORT_FORMAT_META[format].mimeType,
      // `buildExportFileName` ya restringe el nombre a caracteres seguros, así que aquí no
      // puede colarse un salto de línea que parta la cabecera.
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  });
}
