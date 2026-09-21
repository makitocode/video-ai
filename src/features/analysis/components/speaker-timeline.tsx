'use client';

import { useEffect, useRef } from 'react';
import { speakerColor, type Speaker, type TranscriptSegment } from '@/lib/domain';

/**
 * Línea de tiempo de hablantes: quién habla y cuándo, de un vistazo.
 *
 * Es lo que hace que el resultado se sienta al nivel de Zoom o Meet — se ve quién domina la
 * conversación, dónde hay intercambio rápido y dónde monólogos — y sale gratis de la
 * diarización que ya tenemos.
 *
 * Se dibuja en `<canvas>` y no en DOM a propósito: una grabación de dos horas tiene miles de
 * intervenciones, y miles de divs para pintar barras de colores es un coste absurdo
 * (ver doc/06-frontend.md).
 */
export function SpeakerTimeline({
  segments,
  speakers,
  durationMs,
  timeMs,
  onSeek,
}: {
  segments: readonly TranscriptSegment[];
  speakers: readonly Speaker[];
  durationMs: number;
  timeMs: number;
  onSeek: (ms: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || durationMs <= 0) return;

    const context = canvas.getContext('2d');
    if (context === null) return;

    // Se dibuja a la resolución real del dispositivo para que no se vea borroso en pantallas
    // de alta densidad.
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const colorBySpeaker = new Map(speakers.map((s) => [s.id, speakerColor(s.colorIndex)]));

    for (const segment of segments) {
      const x = (segment.startMs / durationMs) * width;
      // Ancho mínimo de un píxel: una intervención de dos palabras debe seguir viéndose.
      const w = Math.max(((segment.endMs - segment.startMs) / durationMs) * width, 1);

      context.fillStyle =
        segment.speakerId === null
          ? '#94a3b8'
          : (colorBySpeaker.get(segment.speakerId) ?? '#94a3b8');
      context.fillRect(x, 0, w, height);
    }

    // Cabezal de reproducción.
    const playheadX = (Math.min(timeMs, durationMs) / durationMs) * width;
    context.fillStyle = '#ffffff';
    context.fillRect(playheadX - 1, 0, 2, height);
    context.fillStyle = '#000000';
    context.fillRect(playheadX - 0.5, 0, 1, height);
  }, [segments, speakers, durationMs, timeMs]);

  return (
    <canvas
      ref={canvasRef}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - rect.left) / rect.width) * durationMs);
      }}
      className="border-border h-10 w-full cursor-pointer rounded border"
      aria-label="Línea de tiempo de hablantes. Haz clic para saltar a un momento."
    />
  );
}
