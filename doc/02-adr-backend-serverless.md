# ADR-001 — ¿Backend propio o Supabase?

- **Estado:** Propuesto
- **Fecha:** 2026-09-20
- **Decide:** la pregunta central del proyecto

---

## Contexto

La restricción del proyecto es explícita: **no queremos operar infraestructura.** Nada de
servidores que parchear, balanceadores, VPCs, colas gestionadas aparte, ni contratar nubes
adicionales. Ya hay presupuesto pagado en **Vercel** y **Supabase**; la pregunta es si eso
basta para un producto que, sobre el papel, suena a "procesamiento de video" — la categoría
que normalmente *exige* máquinas dedicadas.

La duda es legítima, porque el instinto dice: *"video = ffmpeg = CPU = contenedores"*.

## La pregunta correcta

En lugar de preguntar *"¿puede Supabase procesar video?"* (respuesta: no, y no debería),
hay que descomponer el producto en las tareas que realmente necesita y ver **cuáles exigen
compute nuestro**:

| # | Tarea | ¿Necesita que *nosotros* ejecutemos cómputo pesado? |
|---|---|---|
| 1 | Recibir varios GB de bytes | **No.** Es I/O a object storage, no cómputo |
| 2 | Obtener la pista de audio del contenedor de video | **No**, si lo hace el navegador o el proveedor de ASR |
| 3 | Detectar idioma + transcribir + diarizar | **No.** Es un modelo de ML entrenado; alquilarlo es más barato y mejor que hostearlo |
| 4 | Resumir con referencias temporales | **No.** Es una llamada HTTP a un LLM |
| 5 | Orquestar estados, reintentos, webhooks, notificar al usuario | **Sí, pero es mover JSON.** Milisegundos de CPU |
| 6 | Servir el video para reproducirlo | **No.** Es un `GET` con `Range` desde un CDN |

La única casilla marcada es la 5, y es trivial. **Las tareas 1-4, que son las caras, no
requieren cómputo propio en ningún caso.** Ese es todo el argumento.

De ahí sale el principio arquitectónico:

> **Nuestro código nunca toca los bytes del media en el servidor.**

## Los límites reales de la plataforma

Números verificados, porque el diseño tiene que respetarlos:

**Vercel Functions**
- Cuerpo de petición/respuesta: **4,5 MB máximo** (`413 FUNCTION_PAYLOAD_TOO_LARGE`).
- ⇒ **Es imposible subir el video a través de Vercel.** No es una limitación a sortear: es una
  señal de que ese no es el camino. Las respuestas *en streaming* sí escapan a ese límite,
  lo que nos sirve para transmitir el resumen del LLM token a token.
- `maxDuration` configurable; con Fluid Compute el bundle puede llegar a 5 GB, pero eso no
  cambia el límite de payload.

**Supabase Storage**
- Subidas resumibles vía **protocolo TUS**, hasta **50 GB** por archivo en plan Pro
  (chunks de **6 MB**, obligatorio ese tamaño).
- Sube **directo del navegador al storage**, autenticado con el JWT del usuario y gobernado
  por RLS sobre `storage.objects`. No pasa por Vercel ni por una Edge Function.

**Supabase Edge Functions** (Deno)
- Wall clock: **400 s** en plan de pago (150 s en free).
- **CPU: ~2 s por petición** (no cuenta I/O asíncrono).
- **Memoria: 256 MB.**
- Tamaño de función: 20 MB tras bundling.
- `EdgeRuntime.waitUntil()` para tareas en segundo plano, pero **no extiende el wall clock**.

Léelo así: **2 s de CPU y 256 MB de RAM significan que una Edge Function es un orquestador
excelente y un procesador de media imposible.** Encaja perfecto con el principio de arriba:
nuestras funciones esperan I/O (llamar al ASR, escribir en Postgres) y consumen microsegundos
de CPU. Un solo `ffmpeg` sobre un MP4 de 2 GB las mataría en el primer frame.

## Opciones evaluadas

### Opción A — Backend propio en contenedores (Fly.io / Cloud Run / ECS + ffmpeg)

El camino "clásico" de una app de video.

- ✅ Control total: cualquier códec, análisis frame a frame, transcodificación a HLS.
- ✅ Habilita el análisis visual del futuro sin replantear nada.
- ❌ **Introduce exactamente lo que el proyecto quiere evitar**: despliegue, autoescalado,
  red, proxy, secretos, parches de SO, CVEs de ffmpeg, almacenamiento temporal, observabilidad.
- ❌ Un proveedor de nube adicional que contratar y pagar.
- ❌ El coste no es cero en reposo: para responder rápido necesitas instancias calientes.
- ❌ **Superficie de seguridad seria**: ffmpeg parseando archivos arbitrarios subidos por
  desconocidos es un vector de RCE histórico. Requiere sandboxing real.
- ❌ Y lo decisivo: **no mejora el producto.** Todo lo que el MVP necesita ya se resuelve sin
  ello, y encima *más rápido* (ver la Opción C).

### Opción B — Supabase "a pelo", subiendo el video y procesándolo en Edge Functions

- ❌ Inviable por diseño: 2 s de CPU y 256 MB de RAM. No es una cuestión de optimizar.
- Descartada sin más análisis.

### Opción C — Serverless con el trabajo pesado desplazado *(recomendada)*

Cada tarea cara se coloca donde ya está resuelta y pagada:

| Tarea | Dónde se ejecuta | Coste de infra para nosotros |
|---|---|---|
| Demux + extracción de audio + proxy de reproducción | **Navegador del usuario** (WebCodecs, acelerado por hardware, en Web Workers) | **0** |
| Transferencia de bytes | **Navegador → Supabase Storage** directo (TUS) | 0 (solo almacenamiento) |
| Idioma + transcripción + diarización | **API de ASR gestionada** (AssemblyAI / ElevenLabs Scribe) | 0 (pago por uso) |
| Resumen con citas | **API de LLM** (Claude) | 0 (pago por uso) |
| Orquestación, estado, webhooks, colas, progreso en vivo | **Supabase**: Postgres + RLS + pgmq + pg_cron + Edge Functions + Realtime | Incluido en el plan |
| UI y entrega | **Vercel** (Next.js, RSC, CDN) | Incluido en el plan |

- ✅ **Cero infraestructura que operar.** No hay ningún servidor nuestro en producción.
- ✅ **Cero proveedores de nube nuevos.** Solo se añaden dos APIs de pago por uso.
- ✅ **Coste cero en reposo.** Si nadie sube nada, no se paga cómputo.
- ✅ **Es más rápido que la Opción A**, no un compromiso: extraer el audio en el cliente evita
  la subida completa antes de empezar. La Opción A *obliga* a esperar los 13 minutos.
- ✅ Escala horizontalmente sin que hagamos nada: cada usuario aporta su propia CPU.
- ⚠️ Dependencia del proveedor de ASR → mitigada con una interfaz `TranscriptionProvider` y
  al menos dos implementaciones desde el día uno.
- ⚠️ Heterogeneidad de navegadores en soporte de códecs → mitigada con una ruta de escape
  (ver más abajo).
- ⚠️ El análisis visual del futuro no cabe aquí → aceptado: es Fase 5 y se reevalúa entonces.

## Decisión

**Adoptamos la Opción C.** No construimos backend propio.

**Vercel + Supabase + una API de ASR gestionada + una API de LLM cubren el 100 % del MVP**, y
lo hacen con mejor experiencia de usuario que la alternativa con servidores.

### La ruta de escape (importante)

Si un navegador no puede decodificar el archivo (HEVC en Firefox, ProRes, MXF, AV1 antiguo),
**no fallamos**: se sube el archivo original y se le pasa una *signed URL* de vida corta al
proveedor de ASR, que hace el demux del lado suyo. Es más lento — hay que esperar la subida
completa — pero funciona y **sigue sin requerir infraestructura nuestra**. Detección previa
con `VideoDecoder.isConfigSupported()` para elegir la ruta antes de empezar.

## Consecuencias

**Positivas**
- El equipo escribe producto, no YAML de despliegue.
- La factura escala con el uso, no con el tiempo encendido.
- La superficie de ataque se reduce drásticamente: no hay ffmpeg nuestro parseando archivos
  hostiles, ni puertos abiertos, ni SO que parchear.
- El *time-to-first-insight* deja de depender del tamaño del archivo.

**Negativas / deuda aceptada**
- Dependemos de la calidad del ASR de terceros. Se mitiga con la abstracción de proveedor,
  pero un cambio de proveedor implica revalidar la calidad de diarización.
- El procesamiento en cliente depende del dispositivo del usuario. Un portátil viejo tardará
  más en extraer el audio (aunque sigue siendo órdenes de magnitud mejor que subir 5 GB).
- **El coste que hay que vigilar no es la CPU, es el egress de storage.** Reproducir videos
  grandes repetidamente es la partida que puede dispararse. Ver
  [09-costes-y-limites.md](./09-costes-y-limites.md) — la respuesta es generar un *proxy* ligero
  en el cliente y no servir el master.
- Si en Fase 5 queremos análisis visual profundo, habrá que reevaluar. La decisión de hoy no
  se toma a ciegas: se toma sabiendo que ese día llegará y que entonces habrá datos reales.

## ¿Cuándo revisar esta decisión?

Disparadores concretos que obligarían a reabrir el ADR:

1. Más del 15 % de las subidas cae en la ruta de escape por códecs no soportados.
2. El análisis visual pasa a ser requisito de negocio, no un extra.
3. El egress de Supabase Storage supera el coste de un contenedor pequeño con transcodificación.
4. Necesitamos transcripción en tiempo real durante una reunión en vivo.
