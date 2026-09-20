import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatRealtimeFactor, formatTimestamp } from './format';

describe('formatBytes', () => {
  it('escala a la unidad adecuada', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(22 * 1024 * 1024)).toBe('22.0 MB');
    expect(formatBytes(4.8 * 1024 ** 3)).toBe('4.8 GB');
  });

  it('no inventa decimales en bytes enteros', () => {
    expect(formatBytes(999)).toBe('999 B');
  });

  it('degrada con entradas inválidas en vez de romper la interfaz', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('formatTimestamp', () => {
  it('omite la hora en contenido corto', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(92.5)).toBe('01:32');
  });

  it('incluye la hora cuando existe', () => {
    expect(formatTimestamp(3725)).toBe('1:02:05');
  });

  it('degrada con entradas inválidas', () => {
    expect(formatTimestamp(Number.NaN)).toBe('--:--');
    expect(formatTimestamp(-5)).toBe('--:--');
  });
});

describe('formatDuration', () => {
  it('usa la unidad que corresponde a la magnitud', () => {
    expect(formatDuration(5.4)).toBe('5.4 s');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(3725)).toBe('1 h 2 min');
  });
});

describe('formatRealtimeFactor', () => {
  it('expresa cuántas veces más rápido que el tiempo real se procesó', () => {
    expect(formatRealtimeFactor(7200, 60)).toBe('120.0× tiempo real');
  });

  it('degrada cuando todavía no hay medición', () => {
    expect(formatRealtimeFactor(7200, 0)).toBe('—');
    expect(formatRealtimeFactor(0, 10)).toBe('—');
  });
});
