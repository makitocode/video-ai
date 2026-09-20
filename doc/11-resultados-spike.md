# 11 — Resultados del spike (Fase 1)

Registro de mediciones de la hipótesis central del proyecto:

> Podemos extraer el audio de un video de varios GB en el navegador, rápido y de forma
> fiable, en la mayoría de navegadores y códecs reales.

Los umbrales están en [`src/features/ingest/spike-verdict.ts`](../src/features/ingest/spike-verdict.ts)
y se evalúan automáticamente. Banco de pruebas: `/spike`.

---

## Estado: ⚠️ Parcialmente validado

La maquinaria funciona de extremo a extremo en un navegador real. **Falta lo más importante:
medirla con archivos de video reales.**

## Medición automatizada (CI)

Ejecutada por `pnpm test:e2e` en Chromium headless, sobre un WAV PCM sintético generado en el
propio test.

| Parámetro                  | Valor                                              |
| -------------------------- | -------------------------------------------------- |
| Entrada                    | WAV PCM 16 bits, estéreo, 48 kHz, 2 min, 22,0 MB   |
| Salida                     | Opus mono 16 kHz @ 24 kbps, 364,3 KB               |
| Sondeo                     | **6 ms**                                           |
| Extracción                 | **0,5 s**                                          |
| Velocidad                  | **244,7× tiempo real** (objetivo ≥ 120×)           |
| Bloqueo del hilo principal | **0 frames largos**, peor frame 17 ms (objetivo 0) |
| Reducción                  | **62×**                                            |

| Criterio de salida                    | Resultado                                             |
| ------------------------------------- | ----------------------------------------------------- |
| Extracción de 2 h en < 60 s           | ✅ a 244× serían ~29 s                                |
| 0 ms de bloqueo del hilo principal    | ✅ el peor frame fue 17 ms, cadencia normal de 60 fps |
| Ruta de escape funcional              | ✅ probada por tests unitarios de `route-decision.ts` |
| Rechazo temprano de archivos no-media | ✅ probado end-to-end                                 |

### Qué demuestra esto, y qué no

**Demuestra** que la cadena completa funciona dentro de un navegador real: demux del
contenedor, decodificación, remezcla estéreo → mono, remuestreo 48 kHz → 16 kHz, codificación
Opus y muxeo Ogg, todo dentro de un Web Worker y sin tocar el hilo principal. También que el
sondeo es efectivamente instantáneo y que la interfaz se mantiene a 60 fps mientras trabaja.

**No demuestra** el caso que importa. La entrada es PCM sin comprimir, y decodificar PCM es
prácticamente gratis: sólo hay que leer bytes. En un MP4 real el coste está en decodificar
AAC y, sobre todo, en que el demuxer recorra un archivo de gigabytes. **El factor de 244×
es un techo optimista, no una predicción.**

## Pendiente: corpus real

Lo que falta para cerrar la Fase 1. El objetivo declarado es **> 85 % de combinaciones en la
ruta rápida**; lo interesante no es el mejor caso sino cuántas caen en la ruta de escape.

| Archivo     | Contenedor / códecs | Duración | Navegador | Ruta | Velocidad | Frames largos |
| ----------- | ------------------- | -------- | --------- | ---- | --------- | ------------- |
| _pendiente_ | MP4 / H.264 + AAC   | 10 min   | Chrome    |      |           |               |
| _pendiente_ | MP4 / H.264 + AAC   | 2 h      | Chrome    |      |           |               |
| _pendiente_ | MOV / HEVC          | 30 min   | Chrome    |      |           |               |
| _pendiente_ | MKV / H.264 + AC-3  | 1 h      | Chrome    |      |           |               |
| _pendiente_ | WebM / VP9 + Opus   | 30 min   | Chrome    |      |           |               |
| _pendiente_ | MP4 / H.264 + AAC   | 2 h      | Safari    |      |           |               |
| _pendiente_ | MP4 / H.264 + AAC   | 2 h      | Firefox   |      |           |               |
| _pendiente_ | archivo > 4 GB      | 3 h      | Chrome    |      |           |               |

Además, sin medir todavía:

- **Pico de memoria con un archivo de 5 GB** (objetivo < 500 MB). Requiere un archivo real.
- **MP4 sin `faststart`**, con el índice `moov` al final. Debería funcionar porque Mediabunny
  hace lecturas por rangos sobre el `File` local, pero hay que confirmarlo.
- **Reanudación tras cerrar el navegador**, que depende de TUS y por tanto de tener Supabase
  conectado.
- **Dispositivos lentos y móviles**, donde la extracción tardará bastante más.

## Cómo añadir una medición

1. `pnpm dev` y abrir `/spike`.
2. Soltar el archivo. El sondeo indica la ruta elegida y por qué.
3. Pulsar «Extraer el audio».
4. **Escuchar el audio resultante** antes de dar el caso por bueno: un archivo del tamaño
   correcto pero con la remezcla rota arruinaría la transcripción sin que los números lo
   delaten.
5. Anotar la fila en la tabla de arriba.

## Decisión

Cuando el corpus esté completo:

- **Se cumplen los umbrales** → seguir con la Fase 2 tal como está planificada.
- **No se cumplen** → reabrir [ADR-001](./02-adr-backend-serverless.md). Las alternativas, en
  orden de preferencia: bajar el umbral de velocidad si la interfaz sigue respondiendo,
  ampliar el uso de la ruta de escape, o —sólo como último recurso— aceptar compute propio
  para la extracción.
