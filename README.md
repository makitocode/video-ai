# video-ai

Transcripción con diarización y resumen con referencias temporales, sin esperar a que suba el
video.

El diseño completo está en [`doc/`](./doc). Empieza por [`doc/README.md`](./doc/README.md).

---

## La idea en una línea

Para transcribir un video no hace falta el video, hace falta el audio — y el audio de 2 horas
pesa ~22 MB frente a los 5 GB del archivo original. Extrayéndolo **en el navegador** con
WebCodecs, el análisis arranca en segundos en vez de después de una subida de 13 minutos. Eso
es también lo que permite que no haya backend propio que operar: ver
[ADR-001](./doc/02-adr-backend-serverless.md).

## Estado

| Fase                                    | Estado                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| 0 — Fundaciones (tooling, esquema, RLS) | ✅ Hecho                                                                                     |
| 1 — Spike de extracción en el navegador | ⚠️ Funciona; falta el corpus de archivos reales ([resultados](./doc/11-resultados-spike.md)) |
| 2 — Ingesta de producción               | ⬜ Pendiente                                                                                 |
| 3 — Transcripción y diarización         | ⬜ Pendiente                                                                                 |
| 4 — Resumen con citas                   | ⬜ Pendiente                                                                                 |

## Arrancar

```bash
pnpm install
pnpm dev
```

Abre `http://localhost:3000/spike` y suelta un video. **El banco de pruebas de extracción
funciona sin configurar nada**: todo ocurre dentro del navegador y no se sube nada a ningún
sitio.

### Configurar Supabase (necesario a partir de la Fase 2)

```bash
cp .env.example .env.local     # rellena URL y anon key
pnpm supabase link --project-ref TU_PROJECT_REF
pnpm db:push                   # aplica las migraciones de supabase/migrations/
pnpm db:types                  # regenera src/types/database.ts
```

Las claves de proveedores (ASR, LLM) **no van en `.env.local`**: se configuran como secretos de
Edge Functions con `supabase secrets set`. Una clave con prefijo `NEXT_PUBLIC_` queda expuesta
en el bundle del navegador para cualquiera. Ver [doc/08-seguridad.md](./doc/08-seguridad.md).

## Comandos

| Comando         | Qué hace                                  |
| --------------- | ----------------------------------------- |
| `pnpm dev`      | Servidor de desarrollo                    |
| `pnpm check`    | Typecheck + lint + tests unitarios        |
| `pnpm test`     | Tests unitarios (Vitest)                  |
| `pnpm test:e2e` | Tests end-to-end en Chromium (Playwright) |
| `pnpm db:push`  | Aplica las migraciones a Supabase         |

## Estructura

Organizada por **feature**, no por tipo de archivo: cada feature es un vertical que se puede
razonar —y borrar— de forma aislada.

```
doc/                          Diseño del sistema y decisiones de arquitectura
supabase/migrations/          Esquema + RLS, versionado en el repo
e2e/                          Tests end-to-end (Playwright)
src/
├─ app/                       Rutas (App Router)
│  └─ spike/                  Banco de pruebas de la Fase 1
├─ features/ingest/           El corazón técnico
│  ├─ container-sniff.ts      Identificación por magic bytes (pura, testeada)
│  ├─ route-decision.ts       Ruta rápida vs. ruta de escape (pura, testeada)
│  ├─ probe.ts                Sondeo con Mediabunny
│  ├─ audio-profile.ts        Qué sabe codificar este navegador
│  ├─ extract-audio.ts        Demux → decode → mono 16 kHz → Opus
│  ├─ resumable-upload.ts     Subida TUS directa a Supabase Storage
│  └─ workers/media.worker.ts Todo lo pesado, fuera del hilo principal
└─ lib/                       Utilidades compartidas
```

## Principios que no se negocian

1. **El servidor no toca bytes de media.** Si una función nuestra necesita abrir un archivo de
   medios, el diseño está mal. Es lo que nos mantiene sin infraestructura.
2. **Lo pesado, al borde.** El navegador del usuario ya trae un decodificador acelerado por
   hardware. Úsalo.
3. **Todo el estado del pipeline vive en Postgres.** Un job es una fila.
4. **La autorización vive en SQL (RLS)**, no repartida por el código.
5. **Degradar, no fallar.** Si el navegador no puede con el códec, hay una ruta más lenta pero
   funcional. Nunca un callejón sin salida.
