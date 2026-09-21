# 12 — Versión local (rama `local`)

Esta rama contiene una versión que **no depende de ningún servicio en la nube**: ni Supabase,
ni S3, ni despliegue. Se arranca con `pnpm dev` y funciona.

Existe para poder iterar rápido sobre el producto sin montar infraestructura primero. La
arquitectura no cambia: **cambian los adaptadores, no los puertos**.

---

## Mapeo de adaptadores

Cada pieza de la versión en la nube tiene aquí su equivalente local, ocupando el mismo hueco:

| Puerto | Rama principal (nube) | Rama `local` | Archivo |
|---|---|---|---|
| Procesamiento de media | WebCodecs en el navegador | **Idéntico, sin cambios** | `features/ingest/extract-audio.ts` |
| Transferencia de bytes | TUS → Supabase Storage | Subida por trozos → API local | `features/ingest/local-upload.ts` |
| Almacenamiento | Supabase Storage (bucket privado) | Sistema de archivos en `.data/media/` | `server/storage.ts` |
| Base de datos | Postgres + RLS | SQLite | `server/db.ts` |
| Autorización | RLS por `owner_id` | Monousuario, sin auth | — |
| Orquestación | Edge Functions + pgmq + pg_cron | Job runner en proceso | `server/pipeline.ts` |
| Progreso en vivo | Supabase Realtime | Server-Sent Events | `server/events.ts` |
| ASR | AssemblyAI vía *signed URL* + webhook | AssemblyAI subiendo bytes + sondeo | `server/providers/transcription/` |
| LLM | Claude | Claude | `server/providers/summary/` |

**Lo que no cambia en absoluto** es la parte que más trabajo costó: la extracción de audio en
el navegador. Sigue siendo el mismo worker, el mismo WebCodecs y la misma decisión de ruta.

### El detalle que hace posible el ASR en local

En la nube, al proveedor se le pasa una URL firmada y contesta por webhook. En local no hay
ninguna URL pública que ofrecer, así que parecería que hace falta un túnel o un bucket.

No hace falta: **AssemblyAI acepta los bytes crudos del audio en su endpoint `/v2/upload`** y
devuelve una referencia interna. Como el audio extraído pesa ~22 MB por cada 2 h de video,
subirlo es cuestión de segundos. El resultado se consulta por sondeo en vez de por webhook.

Es el mismo motivo por el que la arquitectura no necesitaba backend propio: el trabajo pesado
ya vive fuera.

---

## Arrancar sin configurar nada

```bash
pnpm install
pnpm dev
```

Sin ninguna clave, la aplicación usa **proveedores simulados**:

- La **transcripción simulada** genera una conversación sintética diarizada, estirada a la
  duración real del audio. Sirve para probar la sincronía, el renombrado de hablantes y la
  virtualización del transcript con datos de la forma correcta.
- El **resumen simulado** no inventa contenido: extrae frases reales del transcript y las cita
  con su marca de tiempo real, así que **la navegación por citas funciona de verdad**.

La interfaz avisa de forma visible cuando un proveedor es simulado. Con esto se puede
desarrollar el producto entero sin gastar un céntimo.

## Activar los proveedores reales

Basta con definir la clave; no hay ningún otro interruptor.

```bash
cp .env.example .env.local
```

| Variable | Qué activa |
|---|---|
| `ASSEMBLYAI_API_KEY` | Transcripción real con diarización e idioma automático |
| `ANTHROPIC_API_KEY` | Resumen real con Claude, con citas verificadas |
| `ANTHROPIC_MODEL` | Modelo del resumen (por defecto `claude-opus-5`) |
| `VIDEO_AI_DATA_DIR` | Dónde guardar datos (por defecto `./.data`) |

---

## Qué se conserva del diseño original

Las decisiones que importan siguen en pie, porque no dependían de la nube:

1. **El servidor no toca bytes de media.** El audio lo extrae el navegador; el servidor sólo
   mueve archivos entre disco y el proveedor de ASR.
2. **Audio primero.** Se sube el audio (~22 MB) y arranca el análisis; el video original se
   copia en segundo plano sólo para poder reproducirlo.
3. **El estado del pipeline vive en la base de datos.** Recargar la página o reiniciar el
   servidor no pierde el progreso.
4. **Toda cita se verifica contra el transcript antes de guardarse.** Una afirmación cuya marca
   de tiempo no corresponde a ningún segmento real se descarta. Lo impone una clave foránea,
   no el prompt.
5. **El transcript es entrada no confiable** para el LLM: va delimitado como datos, la salida
   es estructurada y validada, y el pipeline de resumen no tiene herramientas ni red.

## Qué se pierde respecto a la versión en la nube

Diferencias asumidas a propósito, no olvidos:

| Ausencia | Por qué / cuándo volverá |
|---|---|
| Autenticación y RLS | Monousuario. Vuelven con Supabase, y el esquema ya está preparado |
| Ruta de escape para códecs no soportados | El archivo se rechaza con un mensaje claro en lugar de subirlo entero |
| Proxy de reproducción 720p | En local no hay coste de egress, se reproduce el original |
| Reintentos con backoff del job | El job runner es de un solo intento; en la nube lo cubre pgmq |
| Webhooks | Sustituidos por sondeo, que en local es más simple y igual de fiable |

## Cómo migrar esto a la nube más adelante

El camino ya está marcado por la separación puerto/adaptador:

1. Sustituir `server/storage.ts` por el cliente de Supabase Storage.
2. Sustituir `server/repositories.ts` por consultas a Postgres (el esquema ya existe en
   `supabase/migrations/`).
3. Mover `server/pipeline.ts` a una Edge Function y cambiar el sondeo por webhook.
4. Cambiar `local-upload.ts` por `resumable-upload.ts`, que ya está escrito.
5. Sustituir SSE por Realtime en `use-job-stream.ts`.

El resto del frontend —extracción, transcript, línea de tiempo, resumen, renombrado— no se
toca.
