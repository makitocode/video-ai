import { defineConfig, devices } from '@playwright/test';

/**
 * Chromium viene preinstalado en el entorno; se apunta a él explícitamente para no
 * descargar una copia en cada instalación.
 */
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: './e2e',
  // Las mediciones de rendimiento no son fiables con tests compitiendo por la CPU.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: CHROMIUM_PATH,
          // Necesario dentro de un contenedor sin espacios de nombres de usuario.
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        },
      },
    },
  ],
  webServer: {
    // Build de producción: medir el rendimiento contra el servidor de desarrollo
    // daría cifras que no se parecen a las reales.
    command: 'pnpm build && pnpm start --port 3000',
    url: 'http://127.0.0.1:3000',
    // Nunca se reutiliza un servidor ya levantado: uno que quedó vivo de una sesión
    // anterior sirve una build antigua, y entonces el resultado de los tests deja de
    // significar nada sin que se note. Recompilar cuesta segundos; esa clase de ruido
    // cuesta mucho más.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
