import { NextResponse } from 'next/server';
import {
  getMediaAsset,
  getMediaFile,
  getTranscript,
  setAssetDuration,
  updateJob,
} from '@/server/repositories';
import { isRunning, runIdentification, runSummary, runTranscription } from '@/server/pipeline';
import type { JobState } from '@/lib/domain';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Las tres fases se piden por separado. */
const PHASES = ['transcribe', 'identify', 'summarize'] as const;
type Phase = (typeof PHASES)[number];

const INITIAL_STATE: Record<Phase, JobState> = {
  transcribe: 'transcribing',
  identify: 'identifying_speakers',
  summarize: 'summarizing',
};

/**
 * Lanza una fase y responde de inmediato.
 *
 * El trabajo real corre en segundo plano y el navegador sigue el avance por SSE. Es el mismo
 * contrato que en la nube, donde la Edge Function devuelve 202 y el resultado llega después
 * por webhook.
 *
 * Cada fase se pide por su nombre en vez de encadenarlas: las dos que llaman a un modelo
 * cuestan dinero, y quien las paga decide cuándo. Reintentar una fallida tampoco vuelve a
 * pagar la que ya salió bien.
 */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const asset = getMediaAsset(id);

  if (asset === null) {
    return NextResponse.json({ error: 'No existe ese análisis.' }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    durationMs?: number;
    phase?: string;
  };

  // Sin fase explícita se transcribe: es lo que pide la subida, que es anterior a esta
  // distinción y no tiene por qué conocerla.
  const phase: Phase = PHASES.includes(body.phase as Phase) ? (body.phase as Phase) : 'transcribe';

  if (isRunning(id)) {
    return NextResponse.json({ status: 'already_running' }, { status: 202 });
  }

  const durationMs = body.durationMs ?? asset.durationMs ?? 0;
  if (durationMs <= 0) {
    return NextResponse.json({ error: 'Falta la duración del medio.' }, { status: 400 });
  }
  // La duración la mide el navegador al extraer el audio; es más fiable que deducirla aquí,
  // y el servidor ya no tiene que abrir el archivo.
  if (asset.durationMs === null) setAssetDuration(id, durationMs);

  if (phase === 'transcribe') {
    const audio = getMediaFile(id, 'audio');
    if (audio === null || audio.upload_state !== 'complete') {
      return NextResponse.json(
        { error: 'El audio todavía no ha terminado de subirse.' },
        { status: 409 },
      );
    }
  } else if (getTranscript(id) === null) {
    // Las dos fases de modelo leen el transcript guardado. Sin él no hay nada que enviar, y
    // dejarlas arrancar sólo produciría un fallo más caro de diagnosticar.
    return NextResponse.json(
      { error: 'Todavía no hay transcripción que analizar.' },
      { status: 409 },
    );
  }

  updateJob(id, { state: INITIAL_STATE[phase], progress: 0, lastError: null });

  if (phase === 'transcribe') void runTranscription(id, durationMs);
  else if (phase === 'identify') void runIdentification(id);
  else void runSummary(id, durationMs);

  return NextResponse.json({ status: 'started', phase }, { status: 202 });
}
