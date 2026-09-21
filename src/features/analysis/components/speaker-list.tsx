'use client';

import { useState } from 'react';
import { formatTimestamp } from '@/lib/format';
import { speakerColor, speakerName, type Speaker } from '@/lib/domain';

/**
 * Hablantes detectados, con renombrado.
 *
 * La diarización sólo puede decir "Speaker A", porque del audio no sale un nombre propio. El
 * renombrado es lo que cierra esa distancia: el usuario lo pone una vez y se propaga al
 * transcript, al resumen y a la línea de tiempo, porque sólo se actualiza una fila y el resto
 * resuelve el nombre por referencia.
 */
export function SpeakerList({
  speakers,
  onRename,
  onSeek,
}: {
  speakers: readonly Speaker[];
  onRename: (speakerId: string, displayName: string | null) => void;
  onSeek: (ms: number) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commit = (speakerId: string) => {
    onRename(speakerId, draft.trim() === '' ? null : draft.trim());
    setEditing(null);
  };

  return (
    <ul className="space-y-2" aria-label="Hablantes detectados">
      {speakers.map((speaker) => (
        <li key={speaker.id} className="border-border bg-surface rounded-md border p-3">
          <div className="flex items-center gap-2">
            <span
              className="inline-block size-3 shrink-0 rounded-full"
              style={{ background: speakerColor(speaker.colorIndex) }}
              aria-hidden
            />

            {editing === speaker.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => commit(speaker.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commit(speaker.id);
                  if (event.key === 'Escape') setEditing(null);
                }}
                className="border-border w-full rounded border bg-transparent px-2 py-1 text-sm"
                aria-label={`Nombre para ${speaker.label}`}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditing(speaker.id);
                  setDraft(speaker.displayName ?? '');
                }}
                className="flex-1 text-left text-sm font-medium hover:underline"
              >
                {speakerName(speaker)}
              </button>
            )}

            <span className="tabular text-muted shrink-0 text-xs">
              {formatTimestamp(speaker.totalSpeakingMs / 1000)}
            </span>
          </div>

          {/* La sugerencia del modelo se ofrece con su evidencia; nunca se aplica sola. */}
          {speaker.suggestedName !== null && speaker.displayName === null && (
            <div className="text-muted mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span>
                ¿Es <strong className="text-foreground">{speaker.suggestedName}</strong>?
              </span>
              {speaker.suggestionEvidenceMs !== null && (
                <button
                  type="button"
                  onClick={() => onSeek(speaker.suggestionEvidenceMs ?? 0)}
                  className="text-accent underline"
                >
                  oír en {formatTimestamp(speaker.suggestionEvidenceMs / 1000)}
                </button>
              )}
              <button
                type="button"
                onClick={() => onRename(speaker.id, speaker.suggestedName)}
                className="border-border rounded border px-2 py-0.5"
              >
                Aceptar
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
