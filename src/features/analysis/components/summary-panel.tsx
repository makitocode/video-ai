'use client';

import { formatTimestamp } from '@/lib/format';
import { speakerName, type Speaker, type SummaryClaim, type Summary } from '@/lib/domain';

/**
 * Informe de la reunión.
 *
 * El orden es el del documento que uno querría recibir: primero el resumen general en prosa,
 * después los puntos clave agrupados por tema y en orden cronológico, y al final lo accionable
 * —decisiones y tareas—, que es lo que se consulta una y otra vez.
 *
 * Cada afirmación lleva al menos una cita porque **las que no la llevan no llegan hasta aquí**:
 * se descartan al guardar, cuando se comprueba que la marca de tiempo corresponde a un segmento
 * real. Por eso todos los `mm:ss` de esta vista llevan a algún sitio.
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

  const renderClaim = (claim: SummaryClaim) => {
    const owner = claim.ownerSpeakerId === null ? null : speakerById.get(claim.ownerSpeakerId);

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
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-balance">{summary.headline}</h3>
        {summary.overview.map((paragraph, index) => (
          <p key={index} className="text-sm leading-relaxed">
            {paragraph}
          </p>
        ))}
      </section>

      {summary.topics.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-sm font-semibold tracking-wide uppercase">Puntos clave</h3>

          {summary.topics.map((topic) => (
            <article key={topic.id} className="border-border space-y-2 border-l-2 pl-4">
              <h4 className="flex flex-wrap items-baseline gap-2 font-medium">
                {topic.title}
                <button
                  type="button"
                  onClick={() => onSeek(topic.startMs)}
                  className="text-muted tabular text-xs hover:underline"
                  title="Ir al inicio de este tema"
                >
                  {formatTimestamp(topic.startMs / 1000)} – {formatTimestamp(topic.endMs / 1000)}
                </button>
              </h4>
              <ul className="list-disc space-y-2 pl-5">{topic.claims.map(renderClaim)}</ul>
            </article>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold tracking-wide uppercase">Decisiones</h3>
        {summary.decisions.length === 0 ? (
          <p className="text-muted text-sm">
            No se tomó ninguna decisión en firme durante la reunión.
          </p>
        ) : (
          <ul className="list-disc space-y-2 pl-5">{summary.decisions.map(renderClaim)}</ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold tracking-wide uppercase">Tareas pendientes</h3>
        {summary.actionItems.length === 0 ? (
          <p className="text-muted text-sm">No quedaron tareas asignadas.</p>
        ) : (
          <ul className="list-disc space-y-2 pl-5">{summary.actionItems.map(renderClaim)}</ul>
        )}
      </section>
    </div>
  );
}
