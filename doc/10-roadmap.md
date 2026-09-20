# 10 — Hoja de ruta

Seis fases. Cada una tiene un **criterio de salida verificable**: no se avanza porque "parece
que funciona", sino porque se cumple una condición medible.

El orden no es arbitrario. La Fase 1 valida la hipótesis más arriesgada del proyecto **antes**
de construir producto encima de ella.

---

## Fase 0 — Fundaciones

**Objetivo:** que el esqueleto esté bien puesto. Es la fase que nadie quiere hacer y la que
evita reescribir todo en el mes 4.

- Monorepo: Next.js 16 + TypeScript `strict` + ESLint + Prettier.
- Proyecto Supabase, migraciones versionadas en el repo (nada de cambios por la UI).
- Esquema inicial + **RLS en todas las tablas desde la primera migración**.
- Supabase Auth + rutas protegidas.
- CI: typecheck, lint, tests unitarios, **tests de RLS**, presupuesto de bundle.
- Tipos de base de datos generados automáticamente.

**Criterio de salida:** un test de CI crea dos usuarios y demuestra que ninguno puede leer
datos del otro en **ninguna** tabla. Si ese test no existe y no pasa, no hay Fase 1.

---

## Fase 1 — Spike técnico: ¿la ruta rápida funciona de verdad? ⚠️

**La fase más importante.** Todo el producto descansa sobre una hipótesis:

> *Podemos extraer el audio de un video de varios GB en el navegador, rápido y de forma fiable,
> en la mayoría de los navegadores y códecs reales.*

Si es falsa, la arquitectura cambia. Mejor saberlo ahora que en la Fase 4.

**Alcance deliberadamente estrecho:** sin diseño, sin base de datos, sin auth. Una página fea
con un input de archivo.

- Sondeo de capacidades (`isConfigSupported`) + magic bytes.
- Demux + extracción de audio a Opus con Mediabunny/WebCodecs en un Web Worker.
- Medición sobre un corpus real: MP4/H.264, MOV/HEVC, MKV, WebM, AVI; 10 min / 1 h / 3 h;
  Chrome, Safari, Firefox, Edge; escritorio y móvil.
- Subida TUS a Supabase Storage con reanudación (cerrar la pestaña y volver).

**Criterios de salida (todos, o se reabre el ADR-001):**

| Criterio | Umbral |
|---|---|
| Extracción de audio de 2 h de video | < 60 s en un portátil de gama media |
| Cobertura de la ruta rápida sobre el corpus | > 85 % de las combinaciones navegador × códec |
| Bloqueo del hilo principal durante la extracción | 0 ms (medido con trace) |
| Pico de memoria del navegador | < 500 MB con un archivo de 5 GB |
| Subida reanudable tras cerrar el navegador | Funciona, verificado manualmente y en Playwright |
| Ruta de escape (subir original) | Funciona como alternativa, sin callejones sin salida |

**Entregable adicional:** un documento `doc/11-resultados-spike.md` con los números reales.
Si algún umbral no se cumple, ahí se decide qué cambia.

---

## Fase 2 — Ingesta de producción

Convertir el spike en algo que un usuario pueda usar.

- Máquina de estados XState del pipeline completo, persistida en OPFS.
- Los tres carriles de subida con planificador de prioridades y backpressure.
- Generación del proxy 720p y de la forma de onda en el cliente.
- UI de progreso en dos carriles, honesta.
- Reanudación tras recarga de página y tras cerrar el navegador.
- Deduplicación por hash de contenido.

**Criterio de salida:** subir un archivo de 5 GB en una red inestable (simulando cortes) y que
llegue completo, sin intervención del usuario.

---

## Fase 3 — Transcripción y diarización

El primer entregable de valor real.

- Abstracción `TranscriptionProvider` con **dos** implementaciones (AssemblyAI + ElevenLabs).
- Edge Function de creación de job + recepción de webhook (firma, token, idempotencia).
- Barrido de rescate con `pg_cron` para webhooks perdidos.
- Persistencia de segmentos, hablantes e idioma.
- **UI del transcript**: virtualizado, sincronizado por `requestVideoFrameCallback`, búsqueda.
- Línea de tiempo de hablantes en canvas.
- Renombrado de hablantes con propagación.
- Progreso en vivo vía Realtime.

**Criterios de salida:**
- INP < 200 ms en un transcript de 2 h (test automatizado con umbral que rompe el build).
- La diarización identifica correctamente el número de hablantes en un corpus de
  ≥ 10 grabaciones reales de referencia.
- Un webhook perdido no deja ningún job colgado: el rescate lo recupera.

---

## Fase 4 — Resumen con referencias temporales

- Prompt con transcript anclado + salida estructurada validada con Zod.
- **Validación determinista de cada cita contra segmentos reales.**
- Capítulos automáticos.
- Sugerencias de nombre de hablante con evidencia.
- Streaming del resumen con AI SDK.
- Resumen jerárquico para audio > 4 h.
- Defensas de prompt injection.

**Criterio de salida:** sobre el corpus de referencia, **0 citas inválidas persistidas** (las
inválidas se descartan, no se guardan). Medido y registrado como métrica continua.

---

## Fase 5 — Producto completo

- Búsqueda global entre videos.
- Exportación: SRT, VTT, DOCX, Markdown, PDF.
- Compartir con enlaces revocables y caducables.
- Cuotas, planes y panel de consumo.
- CSP, cabeceras de seguridad, DPAs firmados, política de retención activa.
- Observabilidad: Sentry, Vercel Analytics, dashboard de costes sobre `usage_ledger`.
- Accesibilidad auditada (WCAG AA).

**Criterio de salida:** listo para usuarios reales que no somos nosotros.

---

## Fase 6 — Solo si los datos lo justifican

**No planificar esto todavía.** Se decide con datos de producción, no con intuición.

- Análisis del contenido visual (escenas, slides, OCR, diapositivas).
- Transcripción en tiempo real.
- Integraciones (Zoom, Meet, Drive).
- Vocabulario personalizado por organización.

Es el momento de reabrir [ADR-001](./02-adr-backend-serverless.md) si el análisis visual pasa
a ser requisito de negocio.

---

## Riesgos principales del plan

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| La extracción en cliente no cubre suficientes códecs | Media | **Alto** | **La Fase 1 lo resuelve antes de invertir en producto.** La ruta de escape existe siempre |
| La diarización no llega a nivel Zoom en audio difícil | Media | Medio | Dos proveedores evaluados con el mismo corpus; el renombrado manual cubre el resto |
| El egress dispara los costes | Media | Medio | No conservar el master por defecto ([ver 09](./09-costes-y-limites.md)) |
| Rendimiento del transcript largo | Media | Medio | Virtualización desde el primer día + test de INP con umbral en CI |
| Dependencia del proveedor de ASR | Baja | Medio | Abstracción con dos implementaciones desde la Fase 3 |
| Sobre-ingeniería temprana | **Alta** | Medio | Criterios de salida por fase; nada de Fase 5 antes de tiempo |

---

## Decisiones abiertas

Cosas que **no** deben decidirse ahora, y cuándo decidirlas:

1. **¿Se conserva el master por defecto?** → decidir en la Fase 2, con datos de coste reales.
2. **¿Qué proveedor de ASR?** → decidir en la Fase 3 sobre un corpus de 10-15 grabaciones
   reales, comparando **cpWER** (precisión de palabra *y* de atribución), no la tarifa. La
   interfaz `TranscriptionProvider` hace la decisión reversible, así que no bloquea nada.
   Candidatos y economía real (incluidos modelos abiertos y GPU serverless) en
   [05](./05-pipeline-analisis.md#comparativa-de-opciones-todas-las-rutas-reales).
3. **¿Merece la pena WhisperX + pyannote propio?** → **no antes de la Fase 5**, y sólo si el
   volumen justifica un GPU permanentemente ocupado. A 0,20 USD/hora, mil horas procesadas son
   200 USD: no es el problema del primer año, y montarlo reabre el [ADR-001](./02-adr-backend-serverless.md).
4. **¿Modo gratuito con Whisper en el navegador?** → evaluar en la Fase 5 si hace falta un plan
   free. Coste cero real, pero sin diarización y con menor precisión.
3. **¿Transcripción progresiva para vista previa en vivo?** → solo si en la Fase 3 el tiempo de
   espera resulta ser un problema real de UX medido, no supuesto.
4. **¿Modelo de precios?** → Fase 5, con datos de `usage_ledger`.
