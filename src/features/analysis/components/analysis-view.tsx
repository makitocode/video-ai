'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import type { JobState, MediaAssetDetail } from '@/lib/domain';
import { findActiveSegmentIndex } from '../active-segment';
import { useJobStream } from '../use-job-stream';
import { useMediaSync } from '../use-media-sync';
import { ExportMenu } from './export-menu';
import { SimulatedTranscriptBanner } from './simulated-banner';
import { SpeakerList } from './speaker-list';
import { SpeakerTimeline } from './speaker-timeline';
import { SummaryPanel } from './summary-panel';
import { TranscriptPanel } from './transcript-panel';

const STAGE_LABEL: Record<JobState, string> = {
  created: 'Preparando',
  uploading_audio: 'Subiendo el audio',
  transcribing: 'Transcribiendo y separando voces',
  summarizing: 'Redactando el resumen',
  ready: 'Listo',
  failed: 'Falló',
};

export function AnalysisView({ initial }: { initial: MediaAssetDetail }) {
  const [asset, setAsset] = useState(initial);

  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const { timeMs, seekTo } = useMediaSync(mediaRef);
  const [followPlayback, setFollowPlayback] = useState(true);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/media/${initial.id}`);
    if (response.ok) setAsset((await response.json()) as MediaAssetDetail);
  }, [initial.id]);

  // Cada cambio de etapa puede traer datos nuevos: el transcript aparece al terminar la
  // transcripción y el resumen al terminar el suyo. Se recarga en ambos casos en vez de
  // esperar a `ready`, para que el transcript sea utilizable cuanto antes.
  const status = useJobStream(initial.id, initial.job, (next) => {
    if (next.state === 'summarizing' || next.state === 'ready') void refresh();
  });

  const transcript = asset.transcript;
  const durationMs = asset.durationMs ?? 0;

  const activeIndex = useMemo(
    () => (transcript === null ? -1 : findActiveSegmentIndex(transcript.segments, timeMs)),
    [transcript, timeMs],
  );

  const renameSpeaker = useCallback(
    async (speakerId: string, displayName: string | null) => {
      // Actualización optimista: renombrar debe sentirse instantáneo.
      setAsset((prev) =>
        prev.transcript === null
          ? prev
          : {
              ...prev,
              transcript: {
                ...prev.transcript,
                speakers: prev.transcript.speakers.map((speaker) =>
                  speaker.id === speakerId ? { ...speaker, displayName } : speaker,
                ),
              },
            },
      );

      const response = await fetch(`/api/speakers/${speakerId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });

      // Si el servidor lo rechaza, se recarga el estado real en vez de dejar una mentira
      // en pantalla.
      if (!response.ok) void refresh();
    },
    [refresh],
  );

  /**
   * Relanza el análisis sin volver a subir nada.
   *
   * Cubre dos casos que comparten la misma necesidad: un análisis que falló, y uno que
   * terminó con el proveedor simulado y hay que rehacer con el real. En ambos, repetir la
   * subida de un video de gigas sería un castigo desproporcionado: el audio ya está en el
   * servidor, así que el trabajo arranca directamente desde la transcripción.
   */
  const reanalyze = useCallback(async () => {
    const response = await fetch(`/api/media/${initial.id}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ durationMs: asset.durationMs ?? 0 }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? 'No se pudo relanzar el análisis.');
    }
    await refresh();
  }, [initial.id, asset.durationMs, refresh]);

  const mediaSource = asset.hasSource
    ? `/api/media/${asset.id}/file/source`
    : `/api/media/${asset.id}/file/audio`;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight text-balance">
          {asset.originalFilename}
        </h1>
        <p className="text-muted text-sm">
          {durationMs > 0 && <>{formatDuration(durationMs / 1000)} · </>}
          {transcript !== null && (
            <>
              idioma {transcript.languageCode} · {transcript.speakers.length} hablantes ·{' '}
              {transcript.wordCount ?? 0} palabras
            </>
          )}
        </p>
      </header>

      {/* Antes que nada: si el transcript no salió del audio del usuario, hay que decirlo
          donde no se pueda pasar por alto. */}
      {transcript?.provider === 'mock' && <SimulatedTranscriptBanner onReanalyze={reanalyze} />}

      {status.state !== 'ready' && (
        <StageBanner
          state={status.state}
          progress={status.progress}
          error={status.lastError}
          onRetry={() => void reanalyze()}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          {/* El elemento es siempre <video>: con un asset sólo de audio simplemente no
              pinta imagen, y así no hay dos ramas de reproductor que mantener. */}
          <video
            ref={mediaRef}
            src={mediaSource}
            controls
            className="border-border w-full rounded-lg border bg-black"
          />

          {transcript !== null && durationMs > 0 && (
            <SpeakerTimeline
              segments={transcript.segments}
              speakers={transcript.speakers}
              durationMs={durationMs}
              timeMs={timeMs}
              onSeek={seekTo}
            />
          )}

          {transcript !== null && (
            <SpeakerList speakers={transcript.speakers} onRename={renameSpeaker} onSeek={seekTo} />
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-wide uppercase">Transcripción</h2>

            <div className="flex items-center gap-3">
              <label className="text-muted flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={followPlayback}
                  onChange={(event) => setFollowPlayback(event.target.checked)}
                />
                Seguir la reproducción
              </label>
              {/* Sólo hay algo que descargar cuando la transcripción existe. */}
              {transcript !== null && <ExportMenu assetId={asset.id} />}
            </div>
          </div>

          {transcript === null ? (
            <p className="text-muted border-border rounded-lg border border-dashed p-6 text-center text-sm">
              La transcripción aparecerá aquí en cuanto termine.
            </p>
          ) : (
            <TranscriptPanel
              segments={transcript.segments}
              speakers={transcript.speakers}
              activeIndex={activeIndex}
              followPlayback={followPlayback}
              onSeek={seekTo}
            />
          )}
        </div>
      </div>

      <section className="border-border border-t pt-6">
        <h2 className="mb-4 text-sm font-semibold tracking-wide uppercase">Resumen</h2>
        {asset.summary === null || transcript === null ? (
          <p className="text-muted text-sm">El resumen se genera después de la transcripción.</p>
        ) : (
          <SummaryPanel summary={asset.summary} speakers={transcript.speakers} onSeek={seekTo} />
        )}
      </section>
    </div>
  );
}

function StageBanner({
  state,
  progress,
  error,
  onRetry,
}: {
  state: JobState;
  progress: number;
  error: string | null;
  onRetry?: () => void;
}) {
  const failed = state === 'failed';

  return (
    <div
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        failed ? 'border-danger/40 bg-danger/5 text-danger' : 'border-border bg-surface',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="font-medium">{STAGE_LABEL[state]}</span>
        {!failed && <span className="tabular text-muted">{Math.round(progress * 100)}%</span>}
      </div>

      {failed && error !== null && <p className="mt-1">{error}</p>}

      {failed && onRetry !== undefined && (
        <div className="mt-3 space-y-1">
          <button
            type="button"
            onClick={onRetry}
            className="border-danger/40 hover:bg-danger/10 rounded-md border px-3 py-1.5 text-xs font-medium"
          >
            Reintentar el análisis
          </button>
          {/* El audio ya está en el servidor: reintentar no vuelve a subir nada, así que
              tras un fallo a los treinta minutos no hay que repetir la subida del video. */}
          <p className="text-muted text-xs">
            El audio ya está subido; el reintento arranca directamente desde la transcripción.
          </p>
        </div>
      )}

      {!failed && (
        <div className="border-border mt-2 h-1.5 overflow-hidden rounded-full border">
          <div
            className="bg-accent h-full transition-[width] duration-300"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
