'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatBytes, formatDuration, formatTimestamp } from '@/lib/format';
import { MAX_FILE_BYTES } from '@/lib/constants';
import { MediaWorkerClient } from '../media-worker-client';
import { estimateAudioBytes } from '../audio-profile';
import { estimateUploadSeconds, evaluateSpike, type Criterion } from '../spike-verdict';
import { useMainThreadMonitor } from '../use-main-thread-monitor';
import type { AudioExtractionResult, ExtractionProgress, ProbeResult } from '../types';

/** Anchos de banda de subida de referencia para contextualizar los tamaños. */
const BANDWIDTHS = [
  { label: 'ADSL / 4G', mbps: 10 },
  { label: 'Fibra doméstica', mbps: 50 },
  { label: 'Fibra simétrica', mbps: 300 },
] as const;

type Phase = 'idle' | 'probing' | 'ready' | 'extracting' | 'done' | 'error';

export function ExtractionSpike() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [result, setResult] = useState<AudioExtractionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const workerRef = useRef<MediaWorkerClient | null>(null);
  const mainThread = useMainThreadMonitor(phase === 'extracting');

  // Un único worker para toda la sesión: arrancarlo por archivo cuesta tiempo
  // que falsearía las mediciones.
  const getWorker = useCallback((): MediaWorkerClient => {
    workerRef.current ??= new MediaWorkerClient();
    return workerRef.current;
  }, []);

  useEffect(() => () => workerRef.current?.dispose(), []);

  // La URL del blob se revoca al cambiar de resultado para no filtrar memoria.
  const audioUrl = useMemo(
    () => (result === null ? null : URL.createObjectURL(result.blob)),
    [result],
  );
  useEffect(() => {
    if (audioUrl === null) return;
    return () => URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const reset = () => {
    setProbe(null);
    setResult(null);
    setProgress(null);
    setError(null);
  };

  const handleFile = async (selected: File) => {
    reset();
    setFile(selected);

    if (selected.size > MAX_FILE_BYTES) {
      setError(
        `El archivo pesa ${formatBytes(selected.size)} y el límite está en ` +
          `${formatBytes(MAX_FILE_BYTES)}.`,
      );
      setPhase('error');
      return;
    }

    setPhase('probing');
    try {
      setProbe(await getWorker().probe(selected));
      setPhase('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo analizar el archivo.');
      setPhase('error');
    }
  };

  const handleExtract = async () => {
    if (file === null) return;

    setResult(null);
    setError(null);
    setProgress({ stage: 'probing', progress: 0, processedSeconds: 0 });
    setPhase('extracting');

    try {
      setResult(await getWorker().extractAudio(file, setProgress));
      setPhase('done');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'La extracción falló.');
      setPhase('error');
    }
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped !== undefined) void handleFile(dropped);
  };

  const busy = phase === 'probing' || phase === 'extracting';

  return (
    <div className="space-y-6">
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors',
          isDragging ? 'border-accent bg-accent/5' : 'border-border bg-surface',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        <input
          type="file"
          accept="video/*,audio/*"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected !== undefined) void handleFile(selected);
          }}
        />
        <span className="font-medium">Suelta un video aquí o haz clic para elegirlo</span>
        <span className="text-muted text-sm">
          No se sube nada a ningún sitio: todo ocurre en este navegador.
        </span>
      </label>

      {file !== null && (
        <p className="text-muted text-sm">
          <span className="text-foreground font-medium">{file.name}</span> ·{' '}
          <span className="tabular">{formatBytes(file.size)}</span>
        </p>
      )}

      {phase === 'probing' && <Notice tone="info">Analizando el archivo…</Notice>}

      {error !== null && <Notice tone="danger">{error}</Notice>}

      {probe !== null && <ProbeCard probe={probe} />}

      {(phase === 'ready' || phase === 'done') && probe?.route === 'fast' && (
        <button
          type="button"
          onClick={() => void handleExtract()}
          className="bg-accent rounded-md px-4 py-2 text-sm font-medium text-white"
        >
          {phase === 'done' ? 'Extraer de nuevo' : 'Extraer el audio'}
        </button>
      )}

      {phase === 'extracting' && progress !== null && (
        <ExtractionProgressPanel progress={progress} longFrames={mainThread.longFrames} />
      )}

      {result !== null && (
        <ResultCard
          result={result}
          criteria={evaluateSpike(result, mainThread)}
          audioUrl={audioUrl}
        />
      )}
    </div>
  );
}

// --- Piezas de presentación ---------------------------------------------------

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-border bg-surface space-y-4 rounded-lg border p-5">
      <h2 className="text-sm font-semibold tracking-wide uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-border/60 flex items-baseline justify-between gap-4 border-b py-1.5 last:border-0">
      <dt className="text-muted text-sm">{label}</dt>
      <dd className="tabular text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'info' | 'danger'; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        tone === 'danger'
          ? 'border-danger/40 text-danger bg-danger/5'
          : 'border-border bg-surface text-muted',
      )}
    >
      {children}
    </p>
  );
}

function ProbeCard({ probe }: { probe: ProbeResult }) {
  const isFast = probe.route === 'fast';
  const estimatedAudio =
    probe.audioProfile === null
      ? null
      : estimateAudioBytes(probe.audioProfile, probe.durationSeconds);

  return (
    <Card title="Sondeo">
      <div
        className={cn(
          'rounded-md border px-4 py-3 text-sm',
          isFast
            ? 'border-success/40 bg-success/5 text-success'
            : 'border-warning/40 bg-warning/5 text-warning',
        )}
      >
        <strong className="font-semibold">{isFast ? 'Ruta rápida' : 'Ruta de escape'}</strong>
        <span className="text-foreground/80 mt-1 block">{probe.routeReason}</span>
      </div>

      <dl>
        <Row label="Contenedor" value={`${probe.formatName} (${probe.container})`} />
        <Row
          label="Duración"
          value={`${formatTimestamp(probe.durationSeconds)} · ${formatDuration(probe.durationSeconds)}`}
        />
        <Row label="Sondeo completado en" value={`${probe.elapsedMs.toFixed(0)} ms`} />
        {probe.videoTracks.map((track, index) => (
          <Row
            key={`video-${index}`}
            label={`Pista de video ${index + 1}`}
            value={
              <>
                {track.codec ?? 'desconocido'} · {track.displayWidth}×{track.displayHeight}{' '}
                <Decodable ok={track.canDecode} />
              </>
            }
          />
        ))}
        {probe.audioTracks.map((track, index) => (
          <Row
            key={`audio-${index}`}
            label={`Pista de audio ${index + 1}`}
            value={
              <>
                {track.codec ?? 'desconocido'} · {track.sampleRate} Hz ·{' '}
                {track.numberOfChannels === 1 ? 'mono' : `${track.numberOfChannels} canales`}{' '}
                <Decodable ok={track.canDecode} />
              </>
            }
          />
        ))}
        {probe.audioProfile !== null && (
          <Row
            label="Perfil de salida elegido"
            value={`${probe.audioProfile.codec} · ${probe.audioProfile.sampleRate} Hz · mono · ${probe.audioProfile.bitrate / 1000} kbps`}
          />
        )}
        {estimatedAudio !== null && (
          <Row label="Tamaño estimado del audio" value={`≈ ${formatBytes(estimatedAudio)}`} />
        )}
      </dl>
    </Card>
  );
}

function Decodable({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? 'text-success' : 'text-danger'}>
      {ok ? '· decodificable' : '· no decodificable'}
    </span>
  );
}

function ExtractionProgressPanel({
  progress,
  longFrames,
}: {
  progress: ExtractionProgress;
  longFrames: number;
}) {
  const percent = Math.round(progress.progress * 100);

  return (
    <Card title="Extrayendo">
      <div className="border-border h-2 overflow-hidden rounded-full border">
        <div
          className="bg-accent h-full transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      <dl>
        <Row label="Progreso" value={`${percent}%`} />
        <Row label="Audio procesado" value={formatTimestamp(progress.processedSeconds)} />
        <Row
          label="Frames largos hasta ahora"
          value={
            <span className={longFrames === 0 ? 'text-success' : 'text-danger'}>{longFrames}</span>
          }
        />
      </dl>
      {/* Si este cuadrado deja de girar, el hilo principal se está bloqueando. */}
      <div className="text-muted flex items-center gap-3 text-xs">
        <span className="bg-accent inline-block size-3 animate-spin rounded-sm" />
        Este indicador gira mientras el hilo principal está libre.
      </div>
    </Card>
  );
}

function ResultCard({
  result,
  criteria,
  audioUrl,
}: {
  result: AudioExtractionResult;
  criteria: Criterion[];
  audioUrl: string | null;
}) {
  const elapsedSeconds = result.elapsedMs / 1000;

  return (
    <Card title="Resultado">
      <ul className="space-y-2">
        {criteria.map((criterion) => (
          <li key={criterion.id} className="flex items-start gap-3 text-sm">
            <span
              className={cn(
                'mt-0.5 shrink-0 font-semibold',
                criterion.status === 'pass' && 'text-success',
                criterion.status === 'fail' && 'text-danger',
                criterion.status === 'unknown' && 'text-muted',
              )}
            >
              {criterion.status === 'pass' ? '✓' : criterion.status === 'fail' ? '✕' : '—'}
            </span>
            <span>
              <span className="font-medium">{criterion.label}: </span>
              <span className="tabular">{criterion.measured}</span>
              <span className="text-muted block text-xs">Objetivo: {criterion.target}</span>
            </span>
          </li>
        ))}
      </ul>

      <dl>
        <Row label="Duración del medio" value={formatTimestamp(result.mediaSeconds)} />
        <Row label="Tiempo de extracción" value={formatDuration(elapsedSeconds)} />
        <Row label="Tamaño original" value={formatBytes(result.sourceBytes)} />
        <Row label="Audio extraído" value={formatBytes(result.outputBytes)} />
        <Row label="Reducción" value={`${result.compressionRatio.toFixed(0)}× más pequeño`} />
      </dl>

      <div>
        <h3 className="mb-2 text-sm font-medium">Tiempo de subida: original frente a audio</h3>
        <dl>
          {BANDWIDTHS.map((bandwidth) => (
            <Row
              key={bandwidth.mbps}
              label={`${bandwidth.label} (${bandwidth.mbps} Mbps)`}
              value={
                <>
                  <span className="text-muted line-through">
                    {formatDuration(estimateUploadSeconds(result.sourceBytes, bandwidth.mbps))}
                  </span>{' '}
                  <span className="text-success">
                    {formatDuration(estimateUploadSeconds(result.outputBytes, bandwidth.mbps))}
                  </span>
                </>
              }
            />
          ))}
        </dl>
        <p className="text-muted mt-2 text-xs">
          El tiempo tachado es lo que habría costado subir el video antes de poder empezar a
          analizarlo. El verde es lo que cuesta con la ruta de audio primero.
        </p>
      </div>

      {audioUrl !== null && (
        <div className="space-y-2">
          <audio controls src={audioUrl} className="w-full" />
          <a
            href={audioUrl}
            download={`audio.${result.profile.fileExtension}`}
            className="text-accent text-sm underline"
          >
            Descargar el audio extraído
          </a>
          <p className="text-muted text-xs">
            Escúchalo antes de dar el spike por bueno: un archivo del tamaño correcto pero con el
            audio mal remezclado arruinaría la transcripción sin que los números lo delaten.
          </p>
        </div>
      )}
    </Card>
  );
}
