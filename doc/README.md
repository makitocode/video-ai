# video-ai — Documentación de Arquitectura

Análisis de sistema y hoja de ruta para una aplicación de análisis de video que,
a partir de un archivo subido por el usuario (potencialmente de varios GB), produce:

1. **Transcripción profesional** con detección automática de idioma y **diarización**
   (quién dice qué, y cuándo), al nivel de Zoom / Google Meet.
2. **Resumen detallado con referencias temporales** (`mm:ss`) navegables contra el video.

> Estado: **documento de diseño**. No hay código todavía. Nada aquí es definitivo hasta
> que se valide el *spike* técnico de la Fase 1 (ver `10-roadmap.md`).

---

## Índice

| # | Documento | Qué responde |
|---|-----------|--------------|
| 00 | [Glosario](./00-glosario.md) | **Empieza aquí.** Qué es ASR, diarización y LLM, y por qué son capas distintas |
| 01 | [Visión y alcance](./01-vision-y-alcance.md) | Qué construimos, qué **no**, y cómo medimos el éxito |
| 02 | [ADR-001: ¿Backend propio o Supabase?](./02-adr-backend-serverless.md) | **La decisión central.** Por qué no montamos infra |
| 03 | [Arquitectura del sistema](./03-arquitectura-sistema.md) | Diagramas, componentes y flujos |
| 04 | [Ingesta y upload](./04-ingesta-y-upload.md) | Chunking, TUS, y la física real de subir 5 GB |
| 05 | [Pipeline de análisis](./05-pipeline-analisis.md) | Idioma → ASR → diarización → resumen |
| 06 | [Frontend](./06-frontend.md) | **Foco principal**: stack, rendimiento y UX |
| 07 | [Modelo de datos](./07-modelo-de-datos.md) | Esquema Postgres, storage y RLS |
| 08 | [Seguridad](./08-seguridad.md) | Modelo de amenazas y controles |
| 09 | [Costes y límites](./09-costes-y-limites.md) | Números reales de plataforma y coste marginal |
| 10 | [Hoja de ruta](./10-roadmap.md) | Fases, entregables y criterios de salida |

---

## Resumen ejecutivo (TL;DR)

### 1. No necesitas un backend propio. Supabase + Vercel cubren el 100 % del MVP.

La regla de oro que hace esto posible:

> **Nuestro código nunca toca los bytes del media en el servidor.**

Todo el procesamiento pesado ocurre en dos sitios donde ya está resuelto y pagado:
el **navegador del usuario** (WebCodecs, hardware-accelerated) y un **proveedor de ASR
gestionado** (AssemblyAI / ElevenLabs Scribe). Nuestro backend solo mueve JSON: crear un job,
firmar una URL, recibir un webhook, guardar filas. Eso cabe perfectamente en Supabase
Edge Functions.

Detalle completo y el análisis de la alternativa en [ADR-001](./02-adr-backend-serverless.md).

### 2. El truco de rendimiento no es el chunking. Es no subir el video para analizarlo.

El chunking **no aumenta tu ancho de banda de subida**. Un archivo de 5 GB a 50 Mbps tarda
~13 minutos, con chunks o sin ellos. Lo que sí cambia el juego:

```
Ruta clásica:   [ subir 5 GB: ~13 min ] → [ extraer audio ] → [ ASR ] → primer resultado
Nuestra ruta:   [ extraer audio en el navegador: ~20 s ] → [ subir 25 MB: ~4 s ] → [ ASR ]
                [ ...y en paralelo, en segundo plano, el video sube para reproducirse ]
```

El audio de 2 horas de video pesa **~25 MB** frente a **5 GB** del contenedor original: unas
**200× menos**. Extrayéndolo en el cliente con WebCodecs, el *time-to-first-insight* deja de
depender del tamaño del video. Esa es la pieza diferencial del diseño, y está explicada en
[04-ingesta-y-upload.md](./04-ingesta-y-upload.md).

### 3. Stack propuesto

| Capa | Elección | Por qué |
|------|----------|---------|
| Frontend | **Next.js 16 (App Router) + React 19 + TypeScript strict** en Vercel | Ya lo pagas; RSC reduce JS en cliente; streaming nativo para el resumen |
| Procesamiento de media | **WebCodecs + Mediabunny** en Web Workers | 7-10× más rápido que `ffmpeg.wasm`, acelerado por hardware, 0 infra |
| Subida | **TUS resumible** contra Supabase Storage, directo desde el navegador | Reanudable, hasta 50 GB, nunca pasa por nuestro servidor |
| Auth + DB | **Supabase Auth + Postgres con RLS** | Autorización en SQL, no dispersa en código |
| Orquestación | **Edge Functions + pgmq + pg_cron + Realtime** | Cola, reintentos y progreso en vivo sin servidores |
| Transcripción + diarización | **AssemblyAI** (decisión reversible por diseño) | Idioma automático + diarización de calidad, vía webhook. Alternativas y coste real en [05](./05-pipeline-analisis.md) |
| Resumen, capítulos, citas | **Claude** vía AI SDK, con streaming | Contexto largo, citas temporales verificables |

### 4. Dos motores distintos: uno que oye y otro que entiende

Claude **no acepta audio como entrada**, así que no puede generar el transcript. Y la
diarización ("quién habla") tampoco se puede deducir del texto: la identidad vocal vive en la
señal de audio, no en las palabras. Por eso el pipeline tiene dos capas:

- 🎧 **ASR + diarización** (sobre el audio) → una API gestionada, ~0,17-0,23 USD/hora.
- 🧠 **LLM** (sobre el texto ya transcrito) → **Claude**: resumen con citas verificadas,
  capítulos, sugerencia de nombres reales de hablante.

Si esto suena confuso, el [glosario](./00-glosario.md) lo desarrolla. La comparativa completa de
proveedores — incluidas las opciones de código abierto y por qué "gratis en GitHub" no significa
"sin coste" — está en [05-pipeline-analisis.md](./05-pipeline-analisis.md).

### 5. Lo que vamos a decir "no" (por ahora)

- Transcodificar en nuestros servidores (ffmpeg en el backend). No hace falta.
- Análisis visual del video (escenas, OCR de slides, caras). Fase 5, y aún así sin infra propia.
- Transcripción en tiempo real / streaming en vivo. El MVP es asíncrono sobre archivo.
- Conservar el master original por defecto. Ver [09-costes-y-limites.md](./09-costes-y-limites.md).

---

## Material de referencia

El planteamiento de ingesta se apoya en los conceptos que Erick Wendel desarrolla en su
mini-curso de upload escalable con Node.js (*"Como Fazer Upload de Gigabytes de Arquivos de
forma escalável usando Node.js"*) y en su material sobre Streams y backpressure:

- Trocear el archivo y **nunca cargarlo entero en memoria** (`Readable` → `Transform` → `Writable`).
- **Backpressure** como mecanismo de control de flujo: el consumidor marca el ritmo, no el productor.
- Progreso e instrumentación como parte del pipe, no como un añadido.
- Pipeline por etapas: cada etapa hace una cosa y pasa el resultado a la siguiente.

Lo relevante es que **esos conceptos siguen aplicando, pero se mueven al navegador**: donde él
usa `stream.pipeline()` en Node, nosotros usamos `ReadableStream` / `WritableStream` de la Web
Streams API dentro de un Web Worker. Es el mismo modelo mental, sin servidor que operar.
Ver [04-ingesta-y-upload.md](./04-ingesta-y-upload.md#de-nodejs-streams-a-web-streams).
