'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatBytes, formatDuration } from '@/lib/format';
import { useIngest, type IngestPhase } from '../use-ingest';

const PHASE_LABEL: Record<IngestPhase, string> = {
  idle: '',
  probing: 'Analizando el archivo…',
  extracting: 'Extrayendo el audio en tu navegador…',
  uploading_audio: 'Subiendo el audio…',
  starting: 'Arrancando el análisis…',
  analyzing: 'Análisis en marcha',
  error: 'Algo falló',
};

export function UploadPanel() {
  const router = useRouter();
  const { state, start, reset } = useIngest();
  const [isDragging, setIsDragging] = useState(false);

  // En cuanto el análisis arranca, la vista del asset es más útil que esta pantalla: allí
  // se ve el progreso real y aparece el transcript en cuanto está.
  useEffect(() => {
    if (state.phase === 'analyzing' && state.assetId !== null) {
      router.push(`/media/${state.assetId}`);
    }
  }, [state.phase, state.assetId, router]);

  const busy = state.phase !== 'idle' && state.phase !== 'error';

  return (
    <div className="space-y-4">
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const dropped = event.dataTransfer.files[0];
          if (dropped !== undefined) void start(dropped);
        }}
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
            if (selected !== undefined) void start(selected);
          }}
        />
        <span className="font-medium">Suelta un video aquí o haz clic para elegirlo</span>
        <span className="text-muted text-sm">
          El audio se extrae en tu navegador, así que el análisis empieza en segundos aunque el
          video pese varios GB.
        </span>
      </label>

      {state.file !== null && (
        <div className="border-border bg-surface space-y-3 rounded-lg border p-4">
          <p className="text-sm">
            <span className="font-medium">{state.file.name}</span>{' '}
            <span className="tabular text-muted">{formatBytes(state.file.size)}</span>
          </p>

          {state.phase === 'error' ? (
            <>
              <p className="text-danger text-sm">{state.error}</p>
              <button
                type="button"
                onClick={reset}
                className="border-border rounded-md border px-3 py-1.5 text-sm"
              >
                Empezar de nuevo
              </button>
            </>
          ) : (
            <>
              <p className="text-muted text-sm">{PHASE_LABEL[state.phase]}</p>
              <div className="border-border h-1.5 overflow-hidden rounded-full border">
                <div
                  className="bg-accent h-full transition-[width] duration-200"
                  style={{ width: `${Math.round(state.progress * 100)}%` }}
                />
              </div>
            </>
          )}

          {state.extraction !== null && (
            <p className="text-muted text-xs">
              Audio extraído en {formatDuration(state.extraction.elapsedMs / 1000)}:{' '}
              {formatBytes(state.extraction.outputBytes)} frente a{' '}
              {formatBytes(state.extraction.sourceBytes)} del original (
              {state.extraction.compressionRatio.toFixed(0)}× menos).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
