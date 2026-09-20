# 01 — Visión y alcance

## Problema

Un usuario tiene un video largo (una reunión, una clase, una entrevista, un podcast grabado)
de entre 200 MB y varios GB. Quiere, sin fricción:

- Saber **de qué va** sin verlo entero, con capacidad de saltar al momento exacto.
- Tener el **transcript** con la calidad de una herramienta profesional: atribuido por hablante,
  con turnos de conversación, aunque el video no traiga metadatos de participantes.

Las herramientas existentes o bien exigen que la reunión ocurra dentro de su plataforma
(Zoom, Meet, Otter con bot), o bien te hacen esperar a que suba un archivo enorme antes de
darte nada.

## Propuesta de valor

> **El análisis empieza en segundos, no cuando termina la subida.**

Extraemos la pista de audio en el propio navegador antes de subir nada pesado. El usuario ve
el idioma detectado y las primeras líneas del transcript mientras el video todavía se está
transfiriendo en segundo plano.

## Alcance del MVP

### Incluido

**F1 — Ingesta de video**
- Arrastrar y soltar un archivo local (objetivo de soporte: hasta 10 GB).
- Subida **reanudable**: cerrar la pestaña, perder la red o recargar no pierde el progreso.
- Extracción de la pista de audio en el cliente para arrancar el análisis de inmediato.
- Progreso visible y honesto, separado en dos carriles: *análisis* y *video*.

**F2 — Transcripción con diarización**
- Detección automática del idioma hablado (sin que el usuario lo elija).
- Transcripción con **timestamps a nivel de palabra**.
- **Diarización**: segmentación por hablante (`Speaker A`, `Speaker B`, …) y turnos de
  conversación, derivados únicamente del audio.
- El usuario puede **renombrar hablantes** (`Speaker A` → `María`) y el cambio se propaga a
  todo el transcript, al resumen y a las exportaciones.
- Transcript navegable y sincronizado con la reproducción en ambos sentidos.

**F3 — Resumen con referencias temporales**
- Resumen estructurado (contexto, puntos clave, decisiones, acciones pendientes).
- **Toda afirmación del resumen lleva una referencia `mm:ss` clicable** que salta al momento
  del video que la respalda. Sin cita verificable, la frase no entra en el resumen.
- Capítulos automáticos derivados de los cambios de tema.

**Transversal**
- Autenticación, aislamiento estricto de datos entre usuarios, y borrado real a petición.

### Explícitamente fuera del MVP

| No haremos | Por qué / cuándo |
|---|---|
| Transcodificar en nuestros servidores | No es necesario: ver [ADR-001](./02-adr-backend-serverless.md) |
| Análisis del **contenido visual** (escenas, slides, OCR, caras) | Fase 5. Multiplica coste y complejidad |
| Transcripción en vivo / streaming en directo | Otro problema (WebRTC, latencia); el MVP es asíncrono sobre archivo |
| Identificar la **identidad real** de los hablantes automáticamente | Técnicamente no es lo mismo que diarizar. Ver la nota de abajo |
| Traducción y subtítulos multi-idioma | Fase 4, es barato una vez existe el transcript |
| Colaboración en tiempo real / comentarios | Fase 4+ |
| Apps nativas móviles | Web responsive primero |

> **Nota honesta sobre la diarización.** La diarización responde *"¿cuántas personas hablan y
> en qué tramos habla cada una?"* — no *"¿cómo se llaman?"*. Zoom y Meet ponen nombres reales
> porque conocen la lista de participantes de la sesión; nosotros solo tenemos una onda de
> audio. Lo cubrimos con dos mecanismos: (a) el usuario renombra una vez y se propaga,
> y (b) un paso opcional de LLM que propone nombres a partir de pistas del propio transcript
> ("Hola, soy María", "gracias, Carlos"), siempre como *sugerencia* que el usuario confirma.

## Métricas de éxito

Son objetivos de diseño, no promesas comerciales. Se validan en la Fase 1.

| Métrica | Objetivo | Por qué importa |
|---|---|---|
| **Time to first insight** (soltar el archivo → idioma detectado + primeras líneas) | < 60 s para un video de 2 h, **independiente del tamaño del archivo** | Es la promesa central del producto |
| Transcript completo disponible | < 25 % de la duración del audio | Estándar de la industria para ASR asíncrono |
| Tasa de subidas completadas | > 98 % incluyendo redes inestables | Lo garantiza la subida reanudable |
| INP en la vista de transcript (2 h de contenido) | < 200 ms | El transcript largo es donde se rompe el rendimiento |
| Coste marginal por hora de video procesada | < 0,50 USD | Determina si el producto es viable |
| Fuga de datos entre usuarios | 0, verificado por tests de RLS en CI | No negociable |

## Principios de diseño

1. **El servidor no toca bytes de media.** Si una función nuestra necesita leer un archivo de
   media, el diseño está mal. Esto no es purismo: es lo que nos mantiene sin infraestructura.
2. **Lo pesado, al borde.** El navegador del usuario tiene un decodificador de video acelerado
   por hardware, gratis y ya pagado. Úsalo.
3. **Progreso honesto.** Nada de barras falsas. Si el video tarda 13 minutos, se dice, y se
   muestra lo que sí está listo.
4. **Todo estado del pipeline vive en Postgres.** Un job es una fila con estado. Reintentar es
   volver a leer esa fila, no reconstruir contexto en memoria.
5. **La autorización vive en SQL (RLS).** No en el cliente, no dispersa en handlers.
6. **Degradar, no fallar.** Si el navegador no soporta el códec, hay una ruta alternativa más
   lenta pero funcional. Nunca un callejón sin salida.
