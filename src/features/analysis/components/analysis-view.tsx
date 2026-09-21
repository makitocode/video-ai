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

/** Las tres fases que se pueden pedir. Coincide con lo que acepta la ruta. */
type Phase = 'transcribe' | 'identify' | 'summarize';

/**
 * Qué ofrece cada fase pendiente, en los términos en que le importa a quien va a pulsarla:
 * qué obtiene y qué cuesta.
 */
const PHASE_ACTION: Record<Phase, { label: string; detail: string; costs: boolean }> = {
  transcribe: {
    label: 'Transcribir la grabación',
    detail: 'Convierte el audio en texto y separa las voces. El video no se vuelve a subir.',
    costs: true,
  },
  identify: {
    label: 'Identificar a los participantes',
    detail:
      'Deduce quién es cada «Speaker» a partir de lo que se dice y sustituye las etiquetas ' +
      'por nombres. El transcript ya se puede leer y descargar sin esto.',
    costs: true,
  },
  summarize: {
    label: 'Generar el informe',
    detail:
      'Redacta el resumen, los puntos clave por tema, las decisiones y las tareas pendientes, ' +
      'con enlaces al minuto exacto de la grabación.',
    costs: true,
  },
};

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
   * El transcript se muestra en cuanto existe, sin esperar a nada más.
   *
   * Es lo único que se produce solo. Las dos fases que siguen cuestan dinero y minutos, así
   * que se piden a mano: quien sólo quiera leer la reunión no tiene por qué pagarlas.
   */
  const transcript = asset.transcript;
  const identifyingSpeakers = status.state === 'identifying_speakers';

  /**
   * Qué falta por hacer, deducido de los datos y no del estado del job.
   *
   * El estado dice qué está corriendo *ahora*; lo que queda pendiente está en lo que hay
   * guardado. Deducirlo así tiene una consecuencia útil: tras un fallo, reintentar y continuar
   * son la misma acción sobre la misma fase, sin tener que recordar en cuál se rompió.
   */
  const nextPhase: Phase | null =
    transcript === null
      ? 'transcribe'
      : transcript.speakersIdentifiedAt === null
        ? 'identify'
        : asset.summary === null
          ? 'summarize'
          : null;

  const busy = status.state !== 'ready' && status.state !== 'failed';

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
   * Lanza una fase concreta sin volver a subir nada.
   *
   * El audio ya está en el servidor, así que ninguna fase repite la subida. Y al pedirse por
   * nombre, reintentar la que falló no vuelve a pagar la que salió bien: ése era el coste que
   * hacía cara cada prueba.
   */
  const runPhase = useCallback(
    async (phase: Phase) => {
      const response = await fetch(`/api/media/${initial.id}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ durationMs: asset.durationMs ?? 0, phase }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'No se pudo lanzar esa fase.');
      }
      await refresh();
    },
    [initial.id, asset.durationMs, refresh],
  );

  const reanalyze = useCallback(() => runPhase('transcribe'), [runPhase]);

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
          onRetry={nextPhase === null ? undefined : () => void runPhase(nextPhase)}
          retryLabel={nextPhase === null ? undefined : PHASE_ACTION[nextPhase].label}
        />
      )}

      {/* Nada arranca solo a partir de aquí: cada fase se pide, y quien la pide sabe qué
          obtiene. Es lo que evita pagar dos veces por un reintento. */}
      {nextPhase !== null && status.state !== 'failed' && (
        <NextStepPanel phase={nextPhase} disabled={busy} onRun={() => runPhase(nextPhase)} />
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
 * El siguiente paso, con su botón.
 *
 * Dice qué se va a obtener y avisa de que cuesta antes de pulsarlo, no después. La alternativa
 * —encadenarlo todo— gastaba en cada prueba aunque sólo hiciera falta el texto.
 */
function NextStepPanel({
  phase,
  disabled,
  onRun,
}: {
  phase: Phase;
  disabled: boolean;
  onRun: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const action = PHASE_ACTION[phase];

  return (
    <div className="border-border bg-surface space-y-2 rounded-md border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">{action.label}</p>
          <p className="text-muted max-w-prose text-xs leading-relaxed">{action.detail}</p>
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setError(null);
            void onRun().catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : 'No se pudo lanzar esa fase.'),
            );
          }}
          className="border-accent/50 hover:bg-accent/10 shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {action.label}
        </button>
      </div>

      {action.costs && (
        <p className="text-muted text-xs">
          Esta fase llama a un modelo, así que tiene coste. El importe real aparece arriba en cuanto
          termina.
        </p>
      )}

      {error !== null && <p className="text-danger text-xs">{error}</p>}
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
  retryLabel,
}: {
  state: JobState;
  progress: number;
  error: string | null;
  onRetry?: () => void;
  /** Qué fase se reintenta. Decirlo evita la duda de si se va a rehacer todo. */
  retryLabel?: string;
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
            Reintentar: {retryLabel ?? 'el análisis'}
          </button>
          {/* Sólo se repite la fase que falló. Lo que ya estaba guardado sigue estándolo, así
              que un fallo en el informe no vuelve a pagar la identificación. */}
          <p className="text-muted text-xs">
            Se repite sólo esta fase; lo que ya se había producido no se pierde ni se vuelve a
            pagar.
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
