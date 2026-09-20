# 06 — Frontend

> **Este es el foco del proyecto.** Con la decisión de no tener backend propio, el frontend
> deja de ser "la capa de presentación" y pasa a ser **el motor de procesamiento del producto**:
> demuxea, transcodifica, sube, orquesta y renderiza.

---

## 1. Stack

| Capa | Elección | Justificación |
|---|---|---|
| Framework | **Next.js 16 · App Router** | Ya pagas Vercel. RSC reduce el JS enviado; streaming nativo de UI |
| UI | **React 19 + React Compiler** | Memoización automática: menos `useMemo` manual y menos errores de dependencias |
| Lenguaje | **TypeScript strict** + `noUncheckedIndexedAccess` | Un pipeline de media tiene muchos estados; el compilador debe cubrirlos |
| Estilos | **Tailwind CSS v4 + shadcn/ui (Radix)** | Accesibilidad correcta de serie; sin runtime CSS-in-JS |
| Estado de servidor | **TanStack Query** | Caché, reintentos e invalidación; se integra con Realtime |
| Estado de UI | **Zustand** | Ligero, sin providers anidados |
| **Estado del pipeline** | **XState** | Ver §2 — es la decisión de arquitectura FE más importante |
| Media en cliente | **Mediabunny** sobre **WebCodecs** | 7-10× más rápido que `ffmpeg.wasm`, sin 30 MB de WASM |
| Subida | **tus-js-client** | Reanudable contra el endpoint TUS de Supabase |
| Listas largas | **TanStack Virtual** | El transcript de 2 h tiene miles de nodos |
| Realtime | **supabase-js Realtime** | Progreso empujado, sin polling |
| Streaming de IA | **AI SDK** (`useChat` / `streamText`) | El resumen aparece token a token |
| Validación | **Zod** | Mismo esquema en cliente, Edge Functions y DB |
| Tests | **Vitest** + **Playwright** | Unit + E2E con archivos de media reales |

### Sobre el reproductor

`<video>` nativo, envuelto en **Media Chrome** (web components sin opinión de estilo) en lugar
de Video.js o Plyr. Razón: necesitamos control total sobre la sincronización con el transcript
y sobre la línea de tiempo de hablantes, y las librerías completas estorban más de lo que
aportan cuando la UI es a medida.

---

## 2. La máquina de estados es la arquitectura

El error clásico en una app así es repartir el estado del proceso entre varios `useState`
(`isUploading`, `progress`, `error`, `isExtracting`, `isPaused`…). Con 3 carriles de subida,
2 rutas de procesamiento, pausa/reanudación, reintentos y recuperación tras recarga de página,
esa vía produce combinaciones imposibles y bugs irreproducibles.

**Una máquina de estados explícita (XState) hace que los estados inválidos no se puedan
representar**, y además se documenta y se testea sola.

```
idle → probing ──┬─→ extracting → uploadingAudio → transcribing → summarizing → ready
                 │       ↕ paused                        ↑              ↑
                 └─→ uploadingSource ───────────────────┘      failed ─┘ (retry)

   (actores paralelos, independientes del carril principal)
   ├─ uploadProxy:  idle → uploading → done
   └─ uploadMaster: idle → uploading → done   [opcional]
```

Beneficios concretos:
- La UI es una **función pura del estado**. Sin banderas contradictorias.
- Pausar, reanudar y reintentar son transiciones, no `if`s dispersos.
- El estado se **serializa a OPFS** → recargar la página restaura el proceso exacto.
- El diagrama es a la vez documentación y test.

---

## 3. Rendimiento

### Regla número uno: el hilo principal solo pinta

Todo lo demás va a **Web Workers**:

| Worker | Trabajo | Por qué fuera del main thread |
|---|---|---|
| `media.worker` | Demux, decode, encode Opus, proxy, waveform | Bloquearía la UI durante minutos |
| `upload.worker` | Cliente TUS, reintentos, planificador de carriles | Mantiene el progreso fluido bajo carga |
| `transcript.worker` | Parseo, indexado y búsqueda del transcript | Miles de segmentos: parsear en main thread mata el INP |

Presupuesto: **ninguna tarea del hilo principal supera 50 ms.** Lo que no quepa se trocea con
`scheduler.yield()`.

### El transcript largo es donde todo se rompe

2 horas de conversación ≈ 20-25k palabras ≈ **2-3k segmentos**, cada uno con avatar de
hablante, timestamp y texto resaltable. Renderizarlo ingenuamente son ~50k nodos DOM.

| Problema | Solución |
|---|---|
| Demasiados nodos DOM | **TanStack Virtual**: se montan ~20 segmentos visibles + buffer |
| Encontrar el segmento activo en cada frame | **Búsqueda binaria** sobre un array ordenado por `startMs`. `O(log n)`, no `.find()` |
| `timeupdate` dispara solo ~4 veces/s | **`requestVideoFrameCallback()`**: sincronía por frame, no a saltos |
| Re-render de toda la lista al cambiar el segmento activo | El resaltado se aplica por **atributo/clase en un único nodo**, no por estado de React que propague |
| Recalcular layout al hacer scroll | `content-visibility: auto` + `contain: layout paint` |
| Búsqueda de texto en el transcript | Índice invertido precalculado en el worker; la UI solo recibe rangos |

### Otras medidas

- **RSC por defecto.** Transcript y resumen se sirven ya renderizados desde el servidor; el JS
  del cliente se reserva para las islas interactivas (reproductor, subida, editor de hablantes).
- **`next/dynamic`** para el reproductor y el módulo de media: no cargan en la pantalla de inicio.
- **Waveform y línea de hablantes en `<canvas>`**, nunca en DOM. Miles de barras de onda como
  divs es un error caro.
- **Streaming del resumen** con AI SDK: el usuario lee la primera frase mientras se genera el
  resto. Es percepción de velocidad gratis.
- Presupuesto de bundle en CI: **< 200 KB gzip** en la ruta inicial. Falla el build si se supera.

### Objetivos medibles

| Métrica | Objetivo | Dónde se mide |
|---|---|---|
| LCP (landing) | < 1,5 s | Vercel Speed Insights |
| **INP (vista de transcript, 2 h)** | **< 200 ms** | El caso límite real |
| Bloqueo del main thread durante la extracción | **0 ms** (está en worker) | Test de Playwright con trace |
| Tiempo hasta primer byte del resumen | < 2 s | Streaming del AI SDK |
| FPS del scroll en el transcript | 60 | DevTools trace en CI |

---

## 4. Experiencia de usuario

### Progreso honesto en dos carriles

El error de UX sería mostrar una sola barra que tarda 13 minutos. La interfaz refleja la
arquitectura real: **lo que importa va rápido y se muestra primero.**

```
┌──────────────────────────────────────────────────────────┐
│  reunion-q3.mp4 · 4,8 GB · 2 h 03 min                    │
│                                                          │
│  🟢 Análisis            ████████████████████  listo ✓    │
│     Español · 4 hablantes · transcript completo          │
│                                                          │
│  🟡 Video               ██████░░░░░░░░░░░░░░  34 %       │
│     Subiendo en segundo plano · ~6 min restantes         │
│     Puedes cerrar esta pestaña, se reanuda solo.         │
└──────────────────────────────────────────────────────────┘
```

Detalles que importan:
- **Nunca una barra falsa.** Si el progreso se detiene, se dice por qué.
- Estimaciones basadas en throughput medido, no en una regla de tres sobre el tamaño.
- "Puedes cerrar la pestaña" dicho explícitamente: es una garantía técnica real (TUS + OPFS) y
  reduce la ansiedad que causa una subida larga.
- Cuando la ruta de escape se activa (códec no soportado), se explica en lenguaje llano por qué
  esta vez va a tardar más.

### La vista de análisis

```
┌────────────────────────────┬─────────────────────────────┐
│                            │  🔍 Buscar en el transcript  │
│      [ reproductor ]       ├─────────────────────────────┤
│                            │  ● María      02:14         │
│                            │  Creo que el objetivo...    │
├────────────────────────────┤                             │
│ ▓▓░░▓▓▓░░░▓░▓▓░░░▓▓▓▓░░░░  │  ● Carlos     02:41    ◀───│ activo
│ ●María ●Carlos ●Ana ●Sp.D  │  No estoy de acuerdo...     │
├────────────────────────────┤                             │
│ 📑 Resumen                 │  ● Ana        03:02         │
│ • Se aprobó el presupuesto │  Podríamos dividirlo en...  │
│   de marketing  ⏱ 14:32    │                             │
│ • Pendiente: Carlos revisa │        ⋮ (virtualizado)     │
│   el contrato   ⏱ 41:07    │                             │
└────────────────────────────┴─────────────────────────────┘
```

**La línea de hablantes bajo el reproductor** es lo que hace que se sienta profesional: de un
vistazo se ve quién domina la conversación, dónde están los intercambios y dónde los monólogos.
Es la misma información que dan Zoom u Otter, derivada solo del audio.

Interacciones clave:
- Clic en un segmento → salta el video. Clic en `⏱ 14:32` del resumen → salta al momento citado.
- El transcript **auto-scrollea** con la reproducción, pero **se desacopla** en cuanto el usuario
  hace scroll manual, con un botón discreto de "volver a seguir".
- **Renombrar un hablante** se propaga a transcript, resumen, línea de tiempo y exportaciones,
  con actualización optimista.
- Las sugerencias de nombre del LLM aparecen como chips con su evidencia, nunca aplicadas solas.

### Accesibilidad (no es opcional en una app de transcripción)

Sería irónico que una herramienta de accesibilidad no fuera accesible.

- Navegación completa por teclado: `J/K/L` para el reproductor, `↑/↓` entre segmentos,
  `Espacio` para play/pausa.
- El transcript virtualizado necesita `aria-rowcount` / `aria-rowindex`; virtualizar rompe la
  semántica de lista si no se declara.
- Respetar `prefers-reduced-motion` en el auto-scroll.
- Contraste AA mínimo, y **los colores de hablante nunca son el único distintivo** (van con
  nombre e inicial).
- Estados de carga anunciados por `aria-live`, no solo visuales.

---

## 5. Estructura de carpetas propuesta

Organización por **feature**, no por tipo de archivo. Cada feature es un vertical que se puede
razonar (y borrar) de forma aislada.

```
src/
├─ app/                          # Rutas (App Router)
│  ├─ (marketing)/
│  ├─ (app)/
│  │  ├─ upload/
│  │  └─ media/[id]/             # RSC: carga transcript y resumen
│  └─ api/summary/route.ts       # único endpoint en Vercel: streaming del LLM
│
├─ features/
│  ├─ ingest/                    # ← el corazón técnico
│  │  ├─ machine.ts              # máquina XState del pipeline
│  │  ├─ workers/
│  │  │  ├─ media.worker.ts      # demux · audio · proxy · waveform
│  │  │  └─ upload.worker.ts     # TUS · planificador de carriles
│  │  ├─ probe.ts                # magic bytes + isConfigSupported
│  │  └─ components/
│  ├─ transcript/
│  │  ├─ index.ts                # búsqueda binaria del cue activo
│  │  ├─ search.worker.ts
│  │  └─ components/VirtualTranscript.tsx
│  ├─ player/                    # requestVideoFrameCallback + sincronía
│  ├─ speakers/                  # renombrado, colores, línea de tiempo (canvas)
│  └─ summary/                   # render de citas clicables
│
├─ lib/
│  ├─ supabase/                  # clientes browser/server, tipos generados
│  ├─ schemas/                   # Zod compartido con las Edge Functions
│  └─ telemetry/
└─ types/database.ts             # generado desde el esquema de Supabase
```

Regla: **las features no se importan entre sí.** Lo compartido sube a `lib/`. Evita el grafo de
dependencias enmarañado que hace imposible tocar nada después de seis meses.

---

## 6. Riesgos específicos del frontend

| Riesgo | Mitigación |
|---|---|
| Soporte desigual de WebCodecs (Safari/Firefox, códecs) | Sondeo previo + ruta de escape siempre disponible. Matriz probada en CI |
| Memoria del navegador con archivos enormes | Nunca `File.arrayBuffer()`. Siempre streams y `Blob.slice()`. Frames liberados con `.close()` inmediato |
| Fugas de memoria en WebCodecs | `VideoFrame`/`AudioData` no los recoge el GC: hay que cerrarlos a mano. Test de presión de memoria en CI |
| El móvil suspende la pestaña y mata la subida | Detectar `visibilitychange`, persistir en OPFS, reanudar al volver. Avisar al usuario |
| Regresión de rendimiento en el transcript | Test de Playwright que mide INP con un transcript sintético de 2 h, con umbral que rompe el build |
| Exceso de JS en la carga inicial | Presupuesto de bundle verificado en CI |
