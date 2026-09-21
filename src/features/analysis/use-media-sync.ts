'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Sigue la posición de reproducción para sincronizar el transcript.
 *
 * Usa `requestVideoFrameCallback` cuando existe, en vez del evento `timeupdate`: `timeupdate`
 * sólo dispara unas cuatro veces por segundo, lo que hace que el resaltado del transcript
 * avance a saltos visibles. Con `requestVideoFrameCallback` la sincronía es por frame.
 *
 * El respaldo con `requestAnimationFrame` cubre los navegadores sin esa API y el caso de
 * reproducir sólo audio, donde no hay frames de video que contar.
 */
export function useMediaSync(mediaRef: React.RefObject<HTMLMediaElement | null>) {
  const [timeMs, setTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const frameRef = useRef(0);

  useEffect(() => {
    const media = mediaRef.current;
    if (media === null) return;

    let cancelled = false;

    const readTime = () => {
      if (cancelled) return;
      setTimeMs(media.currentTime * 1000);
      schedule();
    };

    const schedule = () => {
      if (cancelled) return;

      const video = media as HTMLVideoElement;
      if (typeof video.requestVideoFrameCallback === 'function') {
        frameRef.current = video.requestVideoFrameCallback(readTime);
      } else {
        frameRef.current = requestAnimationFrame(readTime);
      }
    };

    const onPlay = () => {
      setIsPlaying(true);
      schedule();
    };
    const onPause = () => setIsPlaying(false);
    // Un salto con la barra del reproductor debe reflejarse aunque esté en pausa.
    const onSeeked = () => setTimeMs(media.currentTime * 1000);

    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);
    media.addEventListener('seeked', onSeeked);
    media.addEventListener('loadedmetadata', onSeeked);
    schedule();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameRef.current);
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('seeked', onSeeked);
      media.removeEventListener('loadedmetadata', onSeeked);
    };
  }, [mediaRef]);

  const seekTo = useCallback(
    (targetMs: number) => {
      const media = mediaRef.current;
      if (media === null) return;

      media.currentTime = targetMs / 1000;
      setTimeMs(targetMs);
      void media.play().catch(() => {
        // Si el navegador bloquea la reproducción automática, el salto ya se hizo:
        // el usuario sólo tiene que pulsar play.
      });
    },
    [mediaRef],
  );

  return { timeMs, isPlaying, seekTo };
}
