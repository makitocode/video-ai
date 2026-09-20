# 03 — Arquitectura del sistema

## Vista de componentes

```mermaid
graph TB
    subgraph browser["🖥️ Navegador (donde ocurre el trabajo pesado)"]
        UI["Next.js App Router<br/>React 19 · RSC + islas"]
        SM["Máquina de estados<br/>del pipeline (XState)"]
        W1["Worker: demux + audio<br/>WebCodecs / Mediabunny"]
        W2["Worker: proxy de reproducción<br/>WebCodecs encode"]
        W3["Worker: hash + integridad"]
        OPFS[("OPFS<br/>caché local reanudable")]
    end

    subgraph vercel["▲ Vercel"]
        RSC["Server Components<br/>+ Route Handlers"]
        AISDK["Streaming del resumen<br/>(AI SDK)"]
    end

    subgraph supabase["⚡ Supabase — sin servidores que operar"]
        AUTH["Auth (JWT)"]
        PG[("Postgres<br/>+ RLS + pgmq + pg_cron")]
        ST[("Storage<br/>TUS resumible · buckets privados")]
        EF["Edge Functions<br/>(orquestación · solo JSON)"]
        RT["Realtime<br/>(progreso en vivo)"]
    end

    subgraph ext["☁️ APIs gestionadas (pago por uso)"]
        ASR["ASR: idioma + transcript<br/>+ diarización"]
        LLM["LLM: resumen con citas"]
    end

    UI --> SM
    SM --> W1 & W2 & W3
    W1 --> OPFS
    W1 -->|"audio ~25 MB"| ST
    W2 -->|"proxy ~200 MB, background"| ST
    UI -->|"JWT"| AUTH
    UI --> RSC
    RSC --> PG
    UI -->|"crear job"| EF
    EF --> PG
    EF -->|"signed URL + webhook"| ASR
    ASR -.->|"webhook con resultado"| EF
    PG -->|"pgmq + pg_cron"| EF
    EF --> LLM
    AISDK --> LLM
    PG --> RT
    RT -.->|"estado del job"| UI
    ST -->|"Range requests"| UI

    style browser fill:#1e3a5f,stroke:#4a90d9,color:#fff
    style supabase fill:#1a4731,stroke:#3ecf8e,color:#fff
    style vercel fill:#2d2d2d,stroke:#888,color:#fff
    style ext fill:#4a3520,stroke:#d98a4a,color:#fff
```

**Lo que hay que leer en este diagrama:** las flechas gruesas de datos (audio, proxy, video,
reproducción) van **del navegador directo a Storage** y de vuelta. Ninguna atraviesa Vercel ni
una Edge Function. Nuestro código solo aparece en las flechas finas, que llevan JSON.

## Los tres carriles de ejecución

El diseño separa el trabajo en tres carriles con velocidades y prioridades muy distintas.
Entender esta separación es entender el sistema entero.

| Carril | Qué transporta | Tamaño típico (video de 2 h) | Latencia | Prioridad |
|---|---|---|---|---|
| 🟢 **Rápido — Análisis** | Audio comprimido (Opus mono 16 kHz) | ~25 MB | segundos | **Máxima.** Bloquea el resultado |
| 🟡 **Medio — Reproducción** | Proxy de video (720p, CRF alto) | ~200-400 MB | minutos, en background | Media. Necesario para ver el video |
| 🔴 **Lento — Archivado** | Master original | 5 GB | ~13 min o más | **Opcional.** Solo si el usuario lo pide |

El carril rojo es opcional a propósito: *analizar* un video no requiere *conservarlo*. Ver
[09-costes-y-limites.md](./09-costes-y-limites.md).

## Flujo principal — de soltar el archivo al resumen

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuario
    participant B as Navegador (Workers)
    participant S as Supabase Storage
    participant DB as Postgres
    participant EF as Edge Function
    participant ASR as API de ASR
    participant LLM as LLM

    U->>B: suelta video.mp4 (5 GB)
    B->>B: valida magic bytes + sondea códecs<br/>(isConfigSupported)
    B->>DB: crea media_asset + job (estado: extracting)
    Note over B: ~20 s · Worker · sin red
    B->>B: demux → decode → encode Opus<br/>(25 MB) + waveform + proxy
    B->>S: sube audio.opus (TUS) — 4 s
    B->>EF: POST /jobs/{id}/transcribe
    EF->>S: crea signed URL (TTL corto)
    EF->>ASR: POST job { url, language_detection,<br/>speaker_labels, webhook }
    EF-->>B: 202 Accepted
    EF->>DB: job → transcribing
    DB-->>U: Realtime: "Transcribiendo…"

    par En paralelo, segundo plano
        B->>S: sube proxy 720p + (opcional) master
    end

    ASR-->>EF: webhook: transcript listo
    EF->>EF: verifica firma + idempotencia
    EF->>DB: guarda segments, speakers, idioma
    DB-->>U: Realtime: transcript disponible
    EF->>DB: encola resumen (pgmq)
    DB->>EF: pg_cron consume la cola
    EF->>LLM: transcript con timestamps →<br/>resumen + capítulos + citas
    EF->>EF: valida que cada cita existe<br/>en el transcript
    EF->>DB: guarda summary
    DB-->>U: Realtime: resumen listo
```

### Puntos de diseño no obvios en este flujo

**Paso 3 — el job se crea antes de subir nada.** El estado vive en Postgres desde el primer
momento. Si el usuario cierra la pestaña en el paso 6, al volver encuentra el job y puede
reanudar. No hay estado efímero en memoria del cliente.

**Paso 10 — el paralelismo es el producto.** El transcript llega mientras el video todavía
sube. La UI está diseñada para que eso se vea y se sienta como una ventaja, no como algo a
medias.

**Paso 11 — webhook, no polling.** El ASR nos avisa. Un `pg_cron` de respaldo detecta jobs
`transcribing` estancados más de N minutos y hace polling de rescate, porque los webhooks se
pierden.

**Paso 12 — verificación e idempotencia.** Los webhooks se reintentan y llegan duplicados.
La escritura es idempotente por `job_id` (`ON CONFLICT DO NOTHING`).

**Paso 16 — el resumen se valida contra el transcript.** Si el LLM cita `14:32` y no existe
un segmento en esa marca, la afirmación se descarta. Esto convierte "resumen con timestamps"
de una promesa a una garantía verificable. Ver [05-pipeline-analisis.md](./05-pipeline-analisis.md).

## Máquina de estados del job

Un job es una fila en Postgres con un estado explícito. Todo el sistema — UI, reintentos,
observabilidad — se deriva de aquí.

```mermaid
stateDiagram-v2
    [*] --> created
    created --> probing: validar códecs
    probing --> extracting: ruta rápida (cliente)
    probing --> uploading_source: ruta de escape (códec no soportado)

    extracting --> uploading_audio
    uploading_audio --> transcribing
    uploading_source --> transcribing

    transcribing --> summarizing: webhook OK
    transcribing --> failed_transcription: error del proveedor
    failed_transcription --> transcribing: reintento (backoff exp.)

    summarizing --> ready
    summarizing --> failed_summary
    failed_summary --> summarizing: reintento

    ready --> [*]
    extracting --> uploading_source: fallback en caliente

    note right of transcribing
        Estado "pegajoso": el webhook
        puede perderse. pg_cron
        rescata jobs estancados.
    end note

    note right of ready
        El proxy y el master pueden
        seguir subiendo. No bloquean
        el estado "ready".
    end note
```

## Responsabilidades por componente

### Navegador — el motor de procesamiento

Concentra todo lo caro. Dentro de Web Workers, nunca en el hilo principal:

- **Sondeo de capacidades**: `VideoDecoder/AudioDecoder.isConfigSupported()` decide la ruta.
- **Demux y decodificación** con Mediabunny sobre WebCodecs.
- **Codificación del audio** a Opus mono 16 kHz (suficiente para ASR, ~200× más pequeño).
- **Generación del proxy** de reproducción y de la forma de onda.
- **Subida TUS** con paralelismo controlado y backpressure.
- **Caché en OPFS** para reanudar tras recargar la página.

### Vercel — la capa de presentación

- Server Components para la carga inicial de datos (transcript, resumen): HTML directo, sin
  cascadas de fetch en cliente.
- Route Handlers para lo que necesita streaming al usuario (el resumen token a token).
- **Nunca** recibe archivos. El límite de 4,5 MB lo hace imposible, y eso es correcto.

### Supabase — el sistema nervioso

- **Auth**: emite el JWT que gobierna storage y base de datos.
- **Postgres**: fuente única de verdad del estado. RLS como capa de autorización.
- **Storage**: buckets privados, subida TUS directa, entrega por CDN con `Range`.
- **Edge Functions**: orquestadores puros. Reciben JSON, llaman APIs, escriben filas.
  Nunca abren un archivo de media.
- **pgmq + pg_cron**: cola con reintentos y backoff, y el barrido de jobs estancados.
- **Realtime**: empuja los cambios de estado a la UI. Cero polling desde el cliente.

### APIs externas

- **ASR** (AssemblyAI por defecto): idioma, transcript con timestamps de palabra, diarización.
  Detrás de una interfaz `TranscriptionProvider` para no casarnos.
- **LLM** (Claude): resumen, capítulos y sugerencia de nombres de hablante.

## Qué pasa cuando algo falla

| Fallo | Comportamiento | Impacto para el usuario |
|---|---|---|
| El usuario cierra la pestaña durante la subida | TUS + OPFS reanudan desde el último chunk confirmado | Ninguno, continúa donde iba |
| Se cae la red a mitad de subida | Reintento con backoff exponencial y jitter | Barra pausada, luego continúa |
| El navegador no soporta el códec | Detectado *antes* de empezar → ruta de escape | Más lento, se le avisa |
| El webhook del ASR se pierde | `pg_cron` detecta el job estancado y hace polling | Retraso, no pérdida |
| Webhook duplicado | Escritura idempotente por `job_id` | Ninguno |
| El ASR devuelve error | Reintento con backoff; tras N intentos → `failed` con causa legible | Mensaje claro y opción de reintentar |
| El LLM alucina un timestamp | La validación contra segmentos descarta la afirmación | Resumen algo más corto, nunca incorrecto |
| El usuario sube un archivo corrupto | Falla en el demux en cliente, antes de gastar red o dinero | Error inmediato y barato |
