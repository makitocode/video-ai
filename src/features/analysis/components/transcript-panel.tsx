'use client';

import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/cn';
import { formatTimestamp } from '@/lib/format';
import { speakerColor, speakerName, type Speaker, type TranscriptSegment } from '@/lib/domain';

/**
 * Transcript sincronizado con la reproducción.
 *
 * Virtualizado desde el primer día: una grabación de dos horas son 2.000-3.000 segmentos, y
 * montarlos todos serían decenas de miles de nodos DOM. Se renderizan sólo los visibles más
 * un margen.
 */
export function TranscriptPanel({
  segments,
  speakers,
  activeIndex,
  followPlayback,
  onSeek,
}: {
  segments: readonly TranscriptSegment[];
  speakers: readonly Speaker[];
  activeIndex: number;
  followPlayback: boolean;
  onSeek: (ms: number) => void;
}) {
  // TanStack Virtual devuelve funciones que el React Compiler no puede memoizar sin arriesgar
  // una interfaz obsoleta, así que este componente queda fuera de la memoización automática.
  // Es la vía recomendada por la propia librería, y aquí no cuesta nada: la virtualización
  // ya limita el render a los elementos visibles.
  'use no memo';

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 92,
    overscan: 8,
  });

  // Sigue la reproducción, pero sólo mientras el usuario no haya tomado el control del
  // scroll: arrastrarle la vista mientras lee es de las cosas más molestas que puede
  // hacer una interfaz.
  useEffect(() => {
    if (!followPlayback || activeIndex < 0) return;
    virtualizer.scrollToIndex(activeIndex, { align: 'center', behavior: 'smooth' });
  }, [activeIndex, followPlayback, virtualizer]);

  const speakerById = new Map(speakers.map((speaker) => [speaker.id, speaker]));

  return (
    <div
      ref={scrollRef}
      className="border-border h-[28rem] overflow-y-auto rounded-lg border"
      role="log"
      aria-label="Transcripción"
    >
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((item) => {
          const segment = segments[item.index];
          if (segment === undefined) return null;

          const speaker = segment.speakerId === null ? null : speakerById.get(segment.speakerId);
          const isActive = item.index === activeIndex;

          return (
            <div
              key={segment.id}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <button
                type="button"
                onClick={() => onSeek(segment.startMs)}
                className={cn(
                  'block w-full px-4 py-3 text-left transition-colors',
                  isActive ? 'bg-accent/10' : 'hover:bg-surface',
                )}
              >
                <span className="mb-1 flex items-center gap-2 text-xs">
                  <span
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ background: speakerColor(speaker?.colorIndex ?? 0) }}
                    aria-hidden
                  />
                  <span className="font-medium">
                    {speaker === null || speaker === undefined
                      ? 'Hablante desconocido'
                      : speakerName(speaker)}
                  </span>
                  <span className="tabular text-muted">
                    {formatTimestamp(segment.startMs / 1000)}
                  </span>
                </span>
                <span className="text-sm leading-relaxed">{segment.text}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
