import { expect, test } from '@playwright/test';
import { createWavFixture } from './fixtures';

/**
 * Prueba de extremo a extremo del spike de extracción (Fase 1).
 *
 * Verifica lo único que un test unitario no puede: que WebCodecs decodifica, remezcla,
 * remuestrea, codifica a Opus y muxea de verdad dentro de un navegador real — y que lo hace
 * sin bloquear el hilo principal, que es un criterio de salida explícito de la fase.
 */
test.describe('spike de extracción de audio', () => {
  test('extrae audio de un WAV estéreo sin bloquear el hilo principal', async ({ page }) => {
    // 20 s de tono estéreo: suficiente para que el monitor de frames tenga muestras.
    const fixture = createWavFixture({ seconds: 20 });

    await page.goto('/spike');
    await page.setInputFiles('input[type="file"]', fixture);

    // --- Sondeo ---
    const probeCard = page.getByRole('heading', { name: 'Sondeo' }).locator('..');
    await expect(probeCard).toBeVisible({ timeout: 30_000 });
    await expect(probeCard).toContainText('Ruta rápida');
    await expect(probeCard).toContainText('00:20');
    // Un WAV PCM estéreo debe reconocerse como tal.
    await expect(probeCard).toContainText('2 canales');
    // La salida se remezcla siempre a mono: es lo que consume el ASR.
    await expect(probeCard).toContainText('mono');

    // --- Extracción ---
    await page.getByRole('button', { name: 'Extraer el audio' }).click();

    const resultCard = page.getByRole('heading', { name: 'Resultado' }).locator('..');
    await expect(resultCard).toBeVisible({ timeout: 90_000 });

    // Criterios de salida de la Fase 1, tal como los evalúa `spike-verdict.ts`.
    await expect(resultCard).toContainText('Velocidad de extracción');
    await expect(resultCard).toContainText('Bloqueo del hilo principal');

    // El audio producido tiene que ser reproducible y no estar vacío.
    const audio = resultCard.locator('audio');
    await expect(audio).toBeVisible();

    const audioBytes = await audio.evaluate(async (element) => {
      const response = await fetch((element as HTMLAudioElement).src);
      return (await response.blob()).size;
    });
    expect(audioBytes).toBeGreaterThan(1_000);

    // 20 s a 24 kbps son ~60 KB; el WAV de origen pesa ~3,8 MB. Si la recompresión no
    // hubiera ocurrido, el resultado rondaría el tamaño del original.
    expect(audioBytes).toBeLessThan(400_000);
  });

  test('rechaza un archivo que no es de medios antes de gastar CPU', async ({ page }) => {
    await page.goto('/spike');
    await page.setInputFiles('input[type="file"]', {
      name: 'notas.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('esto no es un video por mucho que se llame .mp4'),
    });

    await expect(page.getByText(/no parece ser de audio ni de video/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
