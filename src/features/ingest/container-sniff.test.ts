import { describe, expect, it } from 'vitest';
import {
  isAcceptedContainer,
  isVideoCapableContainer,
  sniffContainer,
  type ContainerKind,
} from './container-sniff';

/** Construye una cabecera sintética: bytes sueltos sobre un buffer de ceros. */
function header(bytes: Record<number, number | string>, size = 512): Uint8Array {
  const out = new Uint8Array(size);
  for (const [offsetKey, value] of Object.entries(bytes)) {
    const offset = Number(offsetKey);
    if (typeof value === 'number') {
      out[offset] = value;
      continue;
    }
    for (let i = 0; i < value.length; i++) out[offset + i] = value.charCodeAt(i);
  }
  return out;
}

describe('sniffContainer', () => {
  it('reconoce MP4 por la caja ftyp en el offset 4', () => {
    expect(sniffContainer(header({ 4: 'ftypisom' }))).toBe('mp4');
  });

  it('trata MOV y 3GP como mp4: comparten la caja ftyp', () => {
    expect(sniffContainer(header({ 4: 'ftypqt  ' }))).toBe('mp4');
    expect(sniffContainer(header({ 4: 'ftyp3gp5' }))).toBe('mp4');
  });

  it('reconoce MKV y WebM por la cabecera EBML', () => {
    expect(sniffContainer(header({ 0: 0x1a, 1: 0x45, 2: 0xdf, 3: 0xa3 }))).toBe('matroska');
  });

  it('distingue AVI de WAV por el subtipo RIFF', () => {
    expect(sniffContainer(header({ 0: 'RIFF', 8: 'AVI ' }))).toBe('avi');
    expect(sniffContainer(header({ 0: 'RIFF', 8: 'WAVE' }))).toBe('wav');
  });

  it('no acepta un RIFF de subtipo desconocido', () => {
    expect(sniffContainer(header({ 0: 'RIFF', 8: 'XXXX' }))).toBe('unknown');
  });

  it('reconoce Ogg y FLV', () => {
    expect(sniffContainer(header({ 0: 'OggS' }))).toBe('ogg');
    expect(sniffContainer(header({ 0: 'FLV', 3: 0x01 }))).toBe('flv');
  });

  it('confirma MPEG-TS sólo si la sincronía se repite cada 188 bytes', () => {
    expect(sniffContainer(header({ 0: 0x47, 188: 0x47, 376: 0x47 }))).toBe('mpeg-ts');
  });

  it('no confunde con MPEG-TS un archivo que sólo empieza por 0x47', () => {
    expect(sniffContainer(header({ 0: 0x47 }))).toBe('unknown');
  });

  it('reconoce MP3 con etiqueta ID3 y sin ella', () => {
    expect(sniffContainer(header({ 0: 'ID3' }))).toBe('mp3');
    expect(sniffContainer(header({ 0: 0xff, 1: 0xfb }))).toBe('mp3');
  });

  it('devuelve unknown para datos arbitrarios', () => {
    expect(sniffContainer(header({ 0: 'not a media file at all' }))).toBe('unknown');
    expect(sniffContainer(new Uint8Array(0))).toBe('unknown');
  });

  it('no revienta con una cabecera más corta que las firmas que comprueba', () => {
    expect(sniffContainer(new Uint8Array([0x1a, 0x45]))).toBe('unknown');
  });
});

describe('clasificación de contenedores', () => {
  it('marca como capaces de video sólo a los que transportan imagen', () => {
    const videoKinds: ContainerKind[] = ['mp4', 'matroska', 'avi', 'mpeg-ts', 'flv'];
    for (const kind of videoKinds) expect(isVideoCapableContainer(kind)).toBe(true);

    for (const kind of ['ogg', 'wav', 'mp3'] as ContainerKind[]) {
      expect(isVideoCapableContainer(kind)).toBe(false);
    }
  });

  it('acepta contenedores de audio puro: el pipeline necesita audio, no imagen', () => {
    expect(isAcceptedContainer('mp3')).toBe(true);
    expect(isAcceptedContainer('wav')).toBe(true);
    expect(isAcceptedContainer('unknown')).toBe(false);
  });
});
