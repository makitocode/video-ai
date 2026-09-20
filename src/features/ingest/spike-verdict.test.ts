import { describe, expect, it } from 'vitest';
import { estimateUploadSeconds, evaluateSpike } from './spike-verdict';
import type { AudioExtractionResult } from './types';
import type { MainThreadStats } from './use-main-thread-monitor';

const profile = {
  codec: 'opus',
  container: 'ogg',
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitrate: 24_000,
  fileExtension: 'ogg',
  mimeType: 'audio/ogg',
} as const;

function extraction(overrides: Partial<AudioExtractionResult> = {}): AudioExtractionResult {
  const sourceBytes = 5_000_000_000;
  const outputBytes = 22_000_000;
  return {
    blob: new Blob(),
    profile: { ...profile },
    mediaSeconds: 7200,
    elapsedMs: 30_000, // 240× tiempo real
    sourceBytes,
    outputBytes,
    compressionRatio: sourceBytes / outputBytes,
    ...overrides,
  };
}

const quietThread: MainThreadStats = { frames: 1800, longestFrameMs: 17, longFrames: 0 };

describe('evaluateSpike', () => {
  it('aprueba una extracción rápida que no bloquea el hilo principal', () => {
    const criteria = evaluateSpike(extraction(), quietThread);
    expect(criteria.every((c) => c.status === 'pass')).toBe(true);
  });

  it('suspende la velocidad por debajo de 120× tiempo real', () => {
    // 2 h procesadas en 120 s son 60×: la mitad del umbral.
    const criteria = evaluateSpike(extraction({ elapsedMs: 120_000 }), quietThread);
    expect(criteria.find((c) => c.id === 'speed')?.status).toBe('fail');
  });

  it('suspende si aparecen frames largos: el trabajo se escapó del worker', () => {
    const janky: MainThreadStats = { frames: 900, longestFrameMs: 420, longFrames: 12 };
    expect(evaluateSpike(extraction(), janky).find((c) => c.id === 'main-thread')?.status).toBe(
      'fail',
    );
  });

  it('no concluye nada sobre el hilo principal sin muestras suficientes', () => {
    const tooFew: MainThreadStats = { frames: 3, longestFrameMs: 8, longFrames: 0 };
    expect(evaluateSpike(extraction(), tooFew).find((c) => c.id === 'main-thread')?.status).toBe(
      'unknown',
    );
  });

  it('no penaliza un origen que ya era casi todo audio', () => {
    // Un MP3 de entrada no puede comprimirse 200×, y eso no invalida la hipótesis.
    const criteria = evaluateSpike(extraction({ compressionRatio: 2 }), quietThread);
    expect(criteria.find((c) => c.id === 'compression')?.status).toBe('unknown');
  });
});

describe('estimateUploadSeconds', () => {
  it('calcula el tiempo de subida a un ancho de banda dado', () => {
    // 5 GB a 50 Mbps ≈ 800 s ≈ 13 min, el número que motiva toda la arquitectura.
    expect(estimateUploadSeconds(5_000_000_000, 50)).toBeCloseTo(800, 0);
    // Los mismos 22 MB de audio: 3,5 s.
    expect(estimateUploadSeconds(22_000_000, 50)).toBeCloseTo(3.52, 1);
  });
});
