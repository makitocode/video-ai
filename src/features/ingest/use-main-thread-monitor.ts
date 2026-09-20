'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Un frame por encima de este umbral se considera bloqueo perceptible. Es el mismo criterio
 * que usa la definición de *long task* de Web Vitals.
 */
const LONG_FRAME_MS = 50;

/** Cada cuánto se publica el acumulador a los suscriptores. */
const FLUSH_INTERVAL_MS = 250;

export type MainThreadStats = {
  frames: number;
  longestFrameMs: number;
  longFrames: number;
};

const EMPTY_STATS: MainThreadStats = { frames: 0, longestFrameMs: 0, longFrames: 0 };

/**
 * Acumula estadísticas de frames fuera de React.
 *
 * Se publica en lotes cada 250 ms a propósito: notificar a React en cada frame provocaría
 * justo el jank que este monitor existe para detectar, y falsearía la medición.
 */
class FrameMonitor {
  private snapshot: MainThreadStats = EMPTY_STATS;
  private accumulator: MainThreadStats = EMPTY_STATS;
  private readonly listeners = new Set<() => void>();
  private rafId = 0;
  private flushId: ReturnType<typeof setInterval> | null = null;
  private previousTimestamp = 0;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): MainThreadStats => this.snapshot;

  start(): void {
    this.stop();
    this.accumulator = EMPTY_STATS;
    this.publish();

    this.previousTimestamp = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
    this.flushId = setInterval(() => this.publish(), FLUSH_INTERVAL_MS);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    if (this.flushId !== null) clearInterval(this.flushId);
    this.flushId = null;
    this.publish();
  }

  private readonly tick = (timestamp: number): void => {
    const frameMs = timestamp - this.previousTimestamp;
    this.previousTimestamp = timestamp;

    this.accumulator = {
      frames: this.accumulator.frames + 1,
      longestFrameMs: Math.max(this.accumulator.longestFrameMs, frameMs),
      longFrames: this.accumulator.longFrames + (frameMs > LONG_FRAME_MS ? 1 : 0),
    };

    this.rafId = requestAnimationFrame(this.tick);
  };

  private publish(): void {
    if (this.snapshot === this.accumulator) return;
    this.snapshot = this.accumulator;
    for (const listener of this.listeners) listener();
  }
}

/**
 * Mide si el hilo principal se bloquea durante una operación.
 *
 * El criterio de salida de la Fase 1 es explícito: **0 ms de bloqueo del hilo principal
 * durante la extracción** (doc/10-roadmap.md). Este hook lo comprueba de verdad en vez de
 * darlo por supuesto: si el trabajo pesado se escapara del worker, aquí aparecerían frames
 * largos de inmediato.
 */
export function useMainThreadMonitor(active: boolean): MainThreadStats {
  // `useState` con inicializador perezoso da una instancia estable que sí se puede leer
  // durante el render, a diferencia de un ref.
  const [monitor] = useState(() => new FrameMonitor());

  useEffect(() => {
    if (!active) return;
    monitor.start();
    return () => monitor.stop();
  }, [active, monitor]);

  return useSyncExternalStore(monitor.subscribe, monitor.getSnapshot, () => EMPTY_STATS);
}

export { LONG_FRAME_MS };
