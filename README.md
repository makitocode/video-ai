# video-ai — versión local

> Estás en la rama **`local`**. Funciona entera en tu máquina: sin Supabase, sin S3, sin
> desplegar nada. La rama `claude/nifty-shannon-mm4fbo` contiene la versión pensada para la
> nube. Ambas comparten arquitectura; cambian los adaptadores, no los puertos.
> Ver [doc/12-version-local.md](./doc/12-version-local.md).

Sube un video y obtén:

- **Transcripción con diarización** — quién dice qué y cuándo, detectando el idioma solo.
- **Resumen con referencias temporales** — cada afirmación lleva un `mm:ss` clicable que salta
  al momento que la respalda.
- **Descarga en cuatro formatos** — texto plano, SubRip (`.srt`), WebVTT (`.vtt`) y Markdown
  con el resumen incluido.

---

## Arrancar

```bash
pnpm install
pnpm dev
```

Abre `http://localhost:3000` y suelta un video. **No hace falta configurar nada**: arranca con
proveedores simulados y todo el flujo funciona de principio a fin.

### Para resultados reales

```bash
cp .env.example .env.local
```

| Variable                 | Qué activa                                 | Coste aproximado            |
| ------------------------ | ------------------------------------------ | --------------------------- |
| `ASSEMBLYAI_API_KEY`     | Transcripción y diarización reales         | ~0,20 USD por hora de video |
| `ANTHROPIC_API_KEY`      | Resumen real con Claude                    | ~0,10 USD por cada 2 h      |
| `TRANSCRIPTION_LANGUAGE` | Fija el idioma (`es`) en vez de detectarlo | —                           |

Definir la clave es lo único necesario; no hay ningún otro interruptor.

> ⚠️ **Sin `ASSEMBLYAI_API_KEY` el transcript es sintético**: una conversación de ejemplo que
> NO proviene de tu audio. La aplicación lo avisa con un banner rojo sobre el reproductor y
> marca el propio texto del transcript, para que el aviso sobreviva a la exportación. La clave
> se consigue en [assemblyai.com](https://www.assemblyai.com/dashboard/api-keys) sin tarjeta,
> con crédito gratis para unas 185 horas.

---

## La idea

Para transcribir un video no hace falta el video: hace falta el audio. Y el audio de 2 horas
pesa ~22 MB frente a los 5 GB del archivo original.

```
Ruta clásica:  [ copiar 5 GB ] → [ extraer audio ] → [ transcribir ] → primer resultado
Nuestra ruta:  [ extraer audio en el navegador: ~20 s ] → [ subir 22 MB ] → [ transcribir ]
               ...y el video se copia en segundo plano, sin bloquear nada
```

El audio se extrae **en el navegador** con WebCodecs, dentro de un Web Worker. El resultado es
que el tiempo hasta el primer resultado deja de depender del tamaño del video — y, de paso, es
lo que hace que no haga falta ningún servidor con ffmpeg.

## Cómo funciona

```
Navegador                        API local (Next.js)            Proveedores
─────────────────────────────────────────────────────────────────────────────
sondeo (magic bytes + códecs)
extracción de audio (WebCodecs)
  │ audio ~22 MB  ──────────────▶ .data/media/
  │                               SQLite: asset + job
  └ análisis  ──────────────────▶ pipeline ───────────────────▶ ASR (diarización)
                                       │                        LLM (resumen)
  video original (segundo plano)       │
  ◀── progreso por SSE ────────────────┘
```

## Exportar la transcripción

Desde la vista de análisis, el botón **Descargar**:

| Formato                  | Para qué sirve                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| **Texto plano** (`.txt`) | Leer o pegar en cualquier sitio. Agrupa los turnos seguidos del mismo hablante                        |
| **SubRip** (`.srt`)      | El formato de transcript más compatible: editores de video, reproductores, herramientas de subtítulos |
| **WebVTT** (`.vtt`)      | Estándar web; se carga como pista de subtítulos en un `<video>`                                       |
| **Markdown** (`.md`)     | El resumen con sus citas más el transcript completo. Para compartir o archivar la reunión             |

Se generan en el momento, no se guardan: si renombras un hablante, la siguiente descarga ya
lleva el nombre nuevo. También se pueden pedir directamente:

```bash
curl -OJ "http://localhost:3000/api/media/<id>/export?format=srt"
```

## Comandos

| Comando         | Qué hace                                  |
| --------------- | ----------------------------------------- |
| `pnpm dev`      | Servidor de desarrollo                    |
| `pnpm check`    | Typecheck + lint + tests unitarios        |
| `pnpm test`     | Tests unitarios (Vitest)                  |
| `pnpm test:e2e` | Tests end-to-end en Chromium (Playwright) |

## Estructura

```
doc/                            Diseño del sistema y decisiones de arquitectura
e2e/                            Tests end-to-end
src/
├─ app/
│  ├─ page.tsx                  Subida + biblioteca
│  ├─ media/[id]/               Vista de análisis
│  ├─ spike/                    Banco de pruebas de extracción (Fase 1)
│  └─ api/                      La API local (sustituye a las Edge Functions)
├─ features/
│  ├─ ingest/                   Sondeo, extracción, subida — corre en el navegador
│  └─ analysis/                 Reproductor, transcript, línea de hablantes, resumen
├─ server/                      Sólo servidor
│  ├─ db.ts  repositories.ts    SQLite (sustituye a Postgres + RLS)
│  ├─ storage.ts                Sistema de archivos (sustituye a Supabase Storage)
│  ├─ pipeline.ts               Orquestación (sustituye a Edge Functions + pgmq)
│  ├─ events.ts                 SSE (sustituye a Realtime)
│  └─ providers/                ASR y LLM, con implementación simulada y real
└─ lib/                         Dominio y utilidades compartidas
```

Los archivos de `src/lib/` y `src/features/` que no dependen del servidor son **idénticos** en
ambas ramas. Es la ventaja de separar puertos de adaptadores.

## Principios que no se negocian

1. **El servidor no toca bytes de media.** Lo pesado lo hace el navegador.
2. **Todo el estado del pipeline vive en la base de datos.** Un job es una fila; recargar no
   pierde nada.
3. **Toda cita se verifica antes de guardarse.** Si el modelo inventa una marca de tiempo, no
   hay segmento que la respalde y la afirmación se descarta. Lo impone una clave foránea.
4. **El transcript es entrada no confiable** para el LLM: va delimitado como datos, la salida
   es estructurada y validada, y el pipeline de resumen no tiene herramientas ni red.
5. **Degradar, no fallar.** Sin claves, proveedores simulados. Sin códec soportado, un mensaje
   claro en vez de un error críptico a mitad del proceso.
