'use client';

import { formatTimestamp } from '@/lib/format';
import { speakerName, type ClaimKind, type Speaker, type Summary } from '@/lib/domain';

const SECTIONS: Array<{ kind: ClaimKind; title: string; empty: string }> = [
  { kind: 'key_point', title: 'Puntos clave', empty: 'No se extrajeron puntos clave.' },
  { kind: 'decision', title: 'Decisiones', empty: 'No se tomó ninguna decisión explícita.' },
  { kind: 'action_item', title: 'Tareas pendientes', empty: 'No quedaron tareas asignadas.' },
];

/**
 * Resumen con referencias temporales navegables.
 *
 * Cada afirmación lleva al menos una cita porque **las que no la llevan no llegaron hasta
 * aquí**: se descartan al guardar, cuando se comprueba que la marca de tiempo corresponde a
 * un segmento real del transcript. Por eso todos los `mm:ss` de esta vista llevan a algún
 * sitio: es una propiedad del sistema, no una promesa del prompt.
 */
export function SummaryPanel({
  summary,
  speakers,
  onSeek,
}: {
  summary: Summary;
  speakers: readonly Speaker[];
  onSeek: (ms: number) => void;
}) {
  const speakerById = new Map(speakers.map((speaker) => [speaker.id, speaker]));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-balance">{summary.headline}</h2>
        <p className="text-muted text-sm leading-relaxed">{summary.abstract}</p>
      </div>

      {summary.chapters.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Capítulos</h3>
          <ul className="flex flex-wrap gap-2">
            {summary.chapters.map((chapter) => (
              <li key={`${chapter.startMs}-${chapter.title}`}>
                <button
                  type="button"
                  onClick={() => onSeek(chapter.startMs)}
                  className="border-border bg-surface rounded-md border px-3 py-1.5 text-left text-xs"
                >
                  <span className="tabular text-muted mr-2">
                    {formatTimestamp(chapter.startMs / 1000)}
                  </span>
                  {chapter.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {SECTIONS.map((section) => {
        const claims = summary.claims.filter((claim) => claim.kind === section.kind);

        return (
          <section key={section.kind} className="space-y-2">
            <h3 className="text-sm font-semibold">{section.title}</h3>

            {claims.length === 0 ? (
              <p className="text-muted text-sm">{section.empty}</p>
            ) : (
              <ul className="space-y-3">
                {claims.map((claim) => {
                  const owner =
                    claim.ownerSpeakerId === null ? null : speakerById.get(claim.ownerSpeakerId);

                  return (
                    <li key={claim.id} className="text-sm leading-relaxed">
                      {owner !== null && owner !== undefined && (
                        <span className="text-muted mr-1 font-medium">{speakerName(owner)}:</span>
                      )}
                      {claim.text}{' '}
                      {claim.citations.map((citation) => (
                        <button
                          key={`${citation.segmentId}-${citation.startMs}`}
                          type="button"
                          onClick={() => onSeek(citation.startMs)}
                          className="text-accent tabular ml-1 text-xs underline underline-offset-2"
                          title="Saltar al momento que respalda esta afirmación"
                        >
                          {formatTimestamp(citation.startMs / 1000)}
                        </button>
                      ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
