import { describe, expect, it } from 'vitest';
import { decideRoute } from './route-decision';
import type { AudioTrackSummary } from './types';

function audioTrack(overrides: Partial<AudioTrackSummary> = {}): AudioTrackSummary {
  return {
    codec: 'aac',
    codecString: 'mp4a.40.2',
    canDecode: true,
    sampleRate: 48_000,
    numberOfChannels: 2,
    languageCode: 'und',
    ...overrides,
  };
}

describe('decideRoute', () => {
  it('elige la ruta rápida cuando se puede decodificar y codificar', () => {
    expect(decideRoute([audioTrack()], true).route).toBe('fast');
  });

  it('manda a la ruta de escape un archivo sin pista de audio', () => {
    const decision = decideRoute([], true);
    expect(decision.route).toBe('escape');
    expect(decision.reason).toContain('no tiene pista de audio');
  });

  it('manda a la ruta de escape un códec que el navegador no decodifica', () => {
    const decision = decideRoute([audioTrack({ codec: 'ac3', canDecode: false })], true);
    expect(decision.route).toBe('escape');
    // El motivo nombra el códec concreto: el usuario merece saber qué pasó.
    expect(decision.reason).toContain('ac3');
  });

  it('manda a la ruta de escape si no hay encoder disponible, aunque se pueda decodificar', () => {
    expect(decideRoute([audioTrack()], false).route).toBe('escape');
  });

  it('basta con que UNA pista sea decodificable', () => {
    const tracks = [audioTrack({ codec: 'dts', canDecode: false }), audioTrack()];
    expect(decideRoute(tracks, true).route).toBe('fast');
  });

  it('no repite códecs en el mensaje cuando varias pistas comparten el mismo', () => {
    const tracks = [
      audioTrack({ codec: 'ac3', canDecode: false }),
      audioTrack({ codec: 'ac3', canDecode: false }),
    ];
    expect(decideRoute(tracks, true).reason.match(/ac3/g)).toHaveLength(1);
  });
});
