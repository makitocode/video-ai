'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import type { JobState, MediaAssetDetail } from '@/lib/domain';
import { findActiveSegmentIndex } from '../active-segment';
import { useJobStream } from '../use-job-stream';
import { useMediaSync } from '../use-media-sync';
import { AccuracyNote } from './accuracy-note';
import { CostLine } from './cost-line';
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
  identifying_speakers: 'Identificando a los participantes',
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

  // Cada cambio de etapa trae datos nuevos y se recarga en todas, no sólo al final: el
  // transcript existe ya al entrar en `identifying_speakers`, los nombres al entrar en
  // `summarizing` y el resumen al llegar a `ready`. Recargar en cada una es lo que hace que
  // cada pieza aparezca en cuanto está, en vez de todas juntas al terminar.
  const status = useJobStream(initial.id, initial.job, (next) => {
    if (next.state !== 'created' && next.state !== 'uploading_audio') void refresh();
  });

  const durationMs = asset.durationMs ?? 0;

  /**
   * El transcript se muestra en cuanto existe, sin esperar a saber quién es quién.
   *
   * Antes se retenía para no obligar a releer cuando «Speaker C» se convierte en un nombre.
   * Con grabaciones reales el cálculo sale al revés: identificar a siete personas en dos horas
   * de audio son minutos de pantalla vacía teniendo el transcript ya guardado, y leerlo es lo
   * primero que la gente quiere hacer. Los nombres entran solos cuando llegan, y mientras
   * tanto la lista de hablantes dice que se están buscando — releer una etiqueta es barato;
   * esperar sin nada delante, no.
   */
  const transcript = asset.transcript;
  const identifyingSpeakers = status.state === 'identifying_speakers';

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

      <AccuracyNote className="text-muted border-border bg-surface rounded-md border px-4 py-2.5 text-xs leading-relaxed" />

      <CostLine usage={asset.usage} />

      {status.state !== 'ready' && (
        <StageBanner
          // La clave remonta el aviso en cada cambio de etapa, y con él el cronómetro: el
          // tiempo que se muestra es el de la etapa en curso, no el del trabajo entero.
          key={status.state}
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
            <div className="space-y-2">
              {identifyingSpeakers && (
                <p className="text-muted flex items-center gap-2 text-xs" aria-live="polite">
                  <span className="bg-accent inline-block size-1.5 animate-pulse rounded-full" />
                  Deduciendo quién es cada hablante; los nombres sustituirán a las etiquetas al
                  terminar.
                </p>
              )}
              <SpeakerList
                speakers={transcript.speakers}
                onRename={renameSpeaker}
                onSeek={seekTo}
              />
            </div>
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

/**
 * Segundos transcurridos desde que se montó el componente.
 *
 * El reinicio no se hace aquí sino remontando con `key`: así no hay que escribir estado
 * dentro de un efecto, que es justo el patrón que provoca renders en cascada.
 */
function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => setSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return seconds;
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
  const elapsed = useElapsedSeconds();

  /**
   * Hay etapas cuyo avance nadie conoce.
   *
   * Ni AssemblyAI ni el modelo de análisis informan de por dónde van: sólo se sabe cuándo
   * terminan. El porcentaje que se pintaba era una regla de tres sobre una duración supuesta,
   * y en una grabación de dos horas se arrastraba por el 2 % mientras el trabajo iba por la
   * mitad — parecía atascado. Un cronómetro no promete nada que no pueda cumplir.
   */
  const indeterminate = !failed && state !== 'uploading_audio';

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
        {!failed && (
          <span className="tabular text-muted">
            {indeterminate ? formatDuration(elapsed) : `${Math.round(progress * 100)}%`}
          </span>
        )}
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
            className={cn(
              'bg-accent h-full',
              indeterminate ? 'w-full animate-pulse' : 'transition-[width] duration-300',
            )}
            style={indeterminate ? undefined : { width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
