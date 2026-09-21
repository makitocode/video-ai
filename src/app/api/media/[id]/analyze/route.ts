import { NextResponse } from 'next/server';
import { getMediaAsset, getMediaFile, setAssetDuration, updateJob } from '@/server/repositories';
import { isRunning, runAnalysis } from '@/server/pipeline';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Lanza el análisis y responde de inmediato.
 *
 * El trabajo real (transcripción y resumen) corre en segundo plano y el navegador sigue el
 * avance por SSE. Es el mismo contrato que en la nube, donde la Edge Function devuelve 202 y
 * el resultado llega después por webhook.
 */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const asset = getMediaAsset(id);

  if (asset === null) {
    return NextResponse.json({ error: 'No existe ese análisis.' }, { status: 404 });
  }

  const audio = getMediaFile(id, 'audio');
  if (audio === null || audio.upload_state !== 'complete') {
    return NextResponse.json(
      { error: 'El audio todavía no ha terminado de subirse.' },
      { status: 409 },
    );
  }

  if (isRunning(id)) {
    return NextResponse.json({ status: 'already_running' }, { status: 202 });
  }

  // La duración la mide el navegador al extraer el audio; es más fiable que deducirla
  // aquí, y el servidor ya no tiene que abrir el archivo.
  const body = (await request.json().catch(() => ({}))) as { durationMs?: number };
  const durationMs = body.durationMs ?? asset.durationMs ?? 0;

  if (durationMs <= 0) {
    return NextResponse.json({ error: 'Falta la duración del medio.' }, { status: 400 });
  }
  if (asset.durationMs === null) setAssetDuration(id, durationMs);

  updateJob(id, { state: 'transcribing', progress: 0, lastError: null });
  void runAnalysis(id, durationMs);

  return NextResponse.json({ status: 'started' }, { status: 202 });
}
