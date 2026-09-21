import { expect, test } from '@playwright/test';
import { createWavFixture } from './fixtures';

/**
 * Flujo completo de la versión local: subir, extraer, transcribir, diarizar y resumir.
 *
 * Corre con los proveedores simulados (sin claves), que es el modo en el que arranca el
 * proyecto por primera vez. Lo que verifica no es la calidad del transcript —eso depende del
 * proveedor real— sino que **todas las piezas encajan**: el audio extraído en el navegador
 * llega al servidor, el pipeline lo procesa, el progreso viaja por SSE, y el resumen cita
 * momentos que existen de verdad en el transcript.
 */
/**
 * Pide las dos fases de modelo, en orden.
 *
 * Ya no se encadenan solas: cuestan dinero, así que se piden. El test recorre el mismo camino
 * que una persona —pulsar, esperar a que el panel ofrezca lo siguiente— en vez de llamar a la
 * API por detrás, que es lo que dejaría de cubrir el botón.
 */
async function runModelPhases(page: import('@playwright/test').Page): Promise<void> {
  const identify = page.getByRole('button', { name: 'Identificar a los participantes' });
  await expect(identify).toBeVisible({ timeout: 60_000 });
  await identify.click();

  const summarize = page.getByRole('button', { name: 'Generar el informe' });
  await expect(summarize).toBeVisible({ timeout: 90_000 });
  await summarize.click();
}

test.describe('pipeline local', () => {
  test('de un archivo a transcript diarizado y resumen navegable', async ({ page }) => {
    const fixture = createWavFixture({ seconds: 90 });

    await page.goto('/');
    await page.setInputFiles('input[type="file"]', fixture);

    // La ingesta redirige sola a la vista del análisis en cuanto arranca el trabajo.
    await page.waitForURL(/\/media\/[0-9a-f-]+$/, { timeout: 60_000 });

    // --- Transcripción con diarización ---
    const transcript = page.getByRole('log', { name: 'Transcripción' });
    await expect(transcript).toBeVisible({ timeout: 60_000 });
    await expect(transcript.getByRole('button').first()).toBeVisible({ timeout: 60_000 });

    // La diarización tiene que haber separado más de una voz. Se comprueba en la lista de
    // hablantes, que tiene una entrada por voz, y no en el transcript, donde cada hablante
    // aparece tantas veces como interviene.
    const speakerList = page.getByRole('list', { name: 'Hablantes detectados' });
    await expect(speakerList.getByRole('listitem')).toHaveCount(3);

    // --- Renombrar un hablante se propaga a todo ---
    await speakerList.getByRole('button', { name: 'Speaker A', exact: true }).click();
    await page.getByRole('textbox', { name: /Nombre para Speaker A/i }).fill('María');
    await page.keyboard.press('Enter');

    await expect(speakerList.getByRole('button', { name: 'María', exact: true })).toBeVisible();
    // El transcript resuelve el nombre por referencia, así que cambia sin recargar nada.
    await expect(transcript.getByText('María').first()).toBeVisible();

    // --- Las fases de modelo se piden; no llegan solas ---
    await runModelPhases(page);

    // --- Resumen con citas verificadas ---
    await expect(page.getByText('Puntos clave')).toBeVisible({ timeout: 90_000 });

    // Toda cita mostrada apunta a un segmento real: las que no, no se guardaron.
    const citation = page.getByRole('button', { name: /^\d+:\d+$/ }).last();
    await expect(citation).toBeVisible();

    // --- Navegar por una cita mueve la reproducción ---
    const video = page.locator('video');
    await video.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 0;
    });

    await citation.click();
    await expect
      .poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
  });

  test('el análisis persiste tras recargar la página', async ({ page }) => {
    const fixture = createWavFixture({ seconds: 30 });

    await page.goto('/');
    await page.setInputFiles('input[type="file"]', fixture);
    await page.waitForURL(/\/media\/[0-9a-f-]+$/, { timeout: 60_000 });

    const speakerList = page.getByRole('list', { name: 'Hablantes detectados' });
    await expect(speakerList.getByRole('listitem').first()).toBeVisible({ timeout: 60_000 });

    // El estado vive en la base de datos, no en memoria del cliente: recargar no lo pierde.
    await page.reload();
    await expect(speakerList.getByRole('listitem').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('log', { name: 'Transcripción' })).toBeVisible();
  });

  test('descarga la transcripción en todos los formatos', async ({ page }) => {
    const fixture = createWavFixture({ seconds: 45 });

    await page.goto('/');
    await page.setInputFiles('input[type="file"]', fixture);
    await page.waitForURL(/\/media\/([0-9a-f-]+)$/, { timeout: 60_000 });

    const assetId = page.url().split('/').pop() ?? '';
    const speakerList = page.getByRole('list', { name: 'Hablantes detectados' });
    await expect(speakerList.getByRole('listitem').first()).toBeVisible({ timeout: 60_000 });

    // El nombre que pone el usuario debe llegar a las descargas: se comprueba renombrando
    // antes de exportar.
    await speakerList.getByRole('button', { name: 'Speaker A', exact: true }).click();
    await page.getByRole('textbox', { name: /Nombre para Speaker A/i }).fill('María');
    await page.keyboard.press('Enter');
    await expect(speakerList.getByRole('button', { name: 'María', exact: true })).toBeVisible();

    // --- Texto plano ---
    const txt = await page.request.get(`/api/media/${assetId}/export?format=txt`);
    expect(txt.ok()).toBe(true);
    expect(txt.headers()['content-disposition']).toContain('attachment');
    const txtBody = await txt.text();
    expect(txtBody).toContain('Transcripción —');
    expect(txtBody).toContain('María');
    expect(txtBody).not.toContain('Speaker A');

    // --- SubRip ---
    const srt = await page.request.get(`/api/media/${assetId}/export?format=srt`);
    expect(srt.ok()).toBe(true);
    const srtBody = await srt.text();
    // Estructura mínima que otro programa espera encontrar: número, tiempos con coma, texto.
    expect(srtBody).toMatch(/^1\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n/);
    expect(srtBody).toContain('María: ');

    // --- WebVTT ---
    const vtt = await page.request.get(`/api/media/${assetId}/export?format=vtt`);
    expect(vtt.ok()).toBe(true);
    const vttBody = await vtt.text();
    expect(vttBody.startsWith('WEBVTT')).toBe(true);
    expect(vttBody).toContain('<v María>');
    expect(vttBody).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3} --> /);

    // --- Markdown, con el resumen incluido ---
    // El informe hay que pedirlo: las exportaciones anteriores ya funcionaban sin él, que es
    // justo lo que se quiere — el transcript se descarga sin pagar ninguna llamada al modelo.
    await runModelPhases(page);
    await expect(page.getByText('Puntos clave')).toBeVisible({ timeout: 90_000 });
    const md = await page.request.get(`/api/media/${assetId}/export?format=md`);
    expect(md.ok()).toBe(true);
    const mdBody = await md.text();
    expect(mdBody).toContain('## Puntos clave');
    expect(mdBody).toContain('## Decisiones');
    expect(mdBody).toContain('## Tareas pendientes');
    expect(mdBody).toContain('## Transcripción');
    // El aviso de fiabilidad viaja con el documento, que es donde nadie tiene la
    // interfaz delante para leerlo.
    expect(mdBody).toContain('VERIFICA SIEMPRE LA INFORMACIÓN');

    // --- El enlace de la interfaz apunta al mismo sitio ---
    await page.getByRole('group').filter({ hasText: 'Descargar' }).getByText('Descargar').click();
    const srtLink = page.getByRole('link', { name: /SubRip/ });
    await expect(srtLink).toHaveAttribute('href', `/api/media/${assetId}/export?format=srt`);
    await expect(srtLink).toHaveAttribute('download', '');
  });

  test('avisa de forma inequívoca cuando la transcripción es simulada', async ({ page }) => {
    const fixture = createWavFixture({ seconds: 30 });

    await page.goto('/');
    await page.setInputFiles('input[type="file"]', fixture);
    await page.waitForURL(/\/media\/[0-9a-f-]+$/, { timeout: 60_000 });

    // Sin clave de transcripción, el aviso tiene que estar donde no se pueda pasar por alto.
    // Next monta su propio elemento con role="alert" para anunciar rutas, así que el aviso
    // se localiza por contenido y el rol se comprueba por separado.
    await expect(page.getByText('no proviene de tu audio').first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[role="alert"]').filter({ hasText: 'simulada' })).toHaveCount(1);

    // El aviso incluye la salida: relanzar sin volver a subir el video, que es lo que
    // hace falta justo después de configurar la clave.
    await expect(page.getByRole('button', { name: /volver a analizar/i })).toBeVisible();

    // Y el propio texto del transcript debe identificarse, porque se exporta y se copia
    // fuera de la aplicación, donde el aviso de la interfaz ya no acompaña.
    const assetId = page.url().split('/').pop() ?? '';
    const txt = await (await page.request.get(`/api/media/${assetId}/export?format=txt`)).text();
    expect(txt).toContain('TRANSCRIPCIÓN SIMULADA');
  });

  test('descarga el audio extraído con un nombre derivado del video', async ({ page }) => {
    const fixture = createWavFixture({ seconds: 20 });

    await page.goto('/');
    await page.setInputFiles('input[type="file"]', fixture);
    await page.waitForURL(/\/media\/[0-9a-f-]+$/, { timeout: 60_000 });
    const assetId = page.url().split('/').pop() ?? '';

    const audio = await page.request.get(`/api/media/${assetId}/file/audio?download=1`);
    expect(audio.ok()).toBe(true);

    // Sin esto el navegador lo guardaría como «audio.ogg», que no dice a qué grabación
    // pertenece.
    const disposition = audio.headers()['content-disposition'] ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toMatch(/filename="tone\.ogg"/);
  });

  test('rechaza una descarga en formato desconocido', async ({ page }) => {
    await page.goto('/');
    const response = await page.request.get('/api/media/no-existe/export?format=exe');
    expect(response.status()).toBe(400);
  });
});
