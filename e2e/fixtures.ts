import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Genera un WAV PCM sintético para los tests end-to-end.
 *
 * Se construye a mano en vez de versionar un binario: un fixture generado es reproducible,
 * no engorda el repositorio y permite ajustar duración o número de canales desde el test.
 * Un WAV estéreo ejercita el camino completo del pipeline — demux, decodificación, remezcla
 * a mono, remuestreo y codificación a Opus.
 */
export function createWavFixture(options: {
  seconds: number;
  sampleRate?: number;
  channels?: number;
}): string {
  const sampleRate = options.sampleRate ?? 48_000;
  const channels = options.channels ?? 2;
  const bitsPerSample = 16;
  const frameCount = Math.floor(options.seconds * sampleRate);

  const bytesPerFrame = (channels * bitsPerSample) / 8;
  const dataBytes = frameCount * bytesPerFrame;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');

  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // tamaño del bloque fmt
  buffer.writeUInt16LE(1, 20); // 1 = PCM sin comprimir
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerFrame, 28);
  buffer.writeUInt16LE(bytesPerFrame, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  // Dos tonos distintos por canal: si la remezcla a mono se rompiera, el resultado
  // sonaría distinto de forma audible al revisarlo a mano.
  const frequencies = [440, 660];
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const frequency = frequencies[channel % frequencies.length] ?? 440;
      const amplitude = Math.sin((2 * Math.PI * frequency * frame) / sampleRate) * 0.3;
      const offset = 44 + frame * bytesPerFrame + channel * 2;
      buffer.writeInt16LE(Math.round(amplitude * 32_767), offset);
    }
  }

  const path = join(mkdtempSync(join(tmpdir(), 'video-ai-fixture-')), 'tone.wav');
  writeFileSync(path, buffer);
  return path;
}
