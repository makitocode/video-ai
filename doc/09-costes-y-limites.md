# 09 — Costes y límites de plataforma

## Límites que condicionan el diseño

Estos números no son trivia: **cada uno explica una decisión de arquitectura.**

### Vercel Functions
| Límite | Valor | Consecuencia en el diseño |
|---|---|---|
| Cuerpo de petición/respuesta | **4,5 MB** | **Imposible subir video por Vercel.** Por eso va directo a Supabase Storage |
| Respuestas en streaming | Sin ese límite | Por eso el resumen del LLM se transmite token a token |
| `maxDuration` | Configurable | Solo importa para el streaming del resumen |
| Tamaño de bundle (Fluid Compute) | Hasta 5 GB | Irrelevante: no empaquetamos binarios de media |

### Supabase Storage
| Límite | Valor | Consecuencia |
|---|---|---|
| Tamaño máximo por archivo (TUS, plan Pro) | **50 GB** | Cubre de sobra el objetivo de 10 GB |
| Tamaño de chunk TUS | **6 MB exactos** | Requisito, no preferencia. Configurarlo mal rompe la subida |
| Soporte de `Range` en descarga | Sí | Habilita el *seek* del reproductor sin descargar todo |

### Supabase Edge Functions
| Límite | Valor | Consecuencia |
|---|---|---|
| **CPU por petición** | **~2 s** | **La razón por la que nuestras funciones solo mueven JSON.** Un `ffmpeg` moriría al instante |
| Wall clock | 400 s (pago) / 150 s (free) | Suficiente para orquestar; insuficiente para procesar |
| Memoria | **256 MB** | No cabe un frame de video descomprimido en 4K, ni hablar de un archivo |
| Tamaño de función | 20 MB | Sin binarios pesados |
| `EdgeRuntime.waitUntil()` | No extiende el wall clock | Sirve para fire-and-forget, no para trabajo largo |

> Leído junto: **2 s de CPU y 256 MB de RAM describen un orquestador, no un procesador.** El
> diseño encaja con eso en vez de pelearse. Ver [ADR-001](./02-adr-backend-serverless.md).

---

## Coste marginal por video

Escenario de referencia: **1 video de 2 horas, 4,8 GB, visto 3 veces**.

| Concepto | Cantidad | Coste |
|---|---|---|
| ASR con diarización + idioma automático | 2 h | ~0,34-0,46 USD |
| LLM: resumen (~35k in / ~2k out) | 1 llamada | ~0,10-0,25 USD |
| Extracción de audio + proxy | — | **0** (CPU del usuario) |
| Orquestación (Edge Functions) | ~10 invocaciones | ~0 (incluido) |
| Storage: audio + proxy (~420 MB/mes) | | ~0,01 USD/mes |
| Storage: master, si se conserva (4,8 GB/mes) | | ~0,10 USD/mes |
| **Egress: 3 reproducciones del proxy (~1,2 GB)** | | **incluido hasta el límite del plan** |
| **Egress: 3 reproducciones del master (~14,4 GB)** | | **⚠️ consume 6 % del incluido con UN video** |

**Coste de procesamiento: ~0,45-0,70 USD por video de 2 h.** Predecible y aceptable.

## El coste que hay que vigilar no es la CPU: es el egress

Este es el hallazgo más importante del análisis de costes, y contradice la intuición.

El plan Pro de Supabase incluye ~250 GB de egress. Con el **master** de 4,8 GB servido
directamente:

```
1 video × 3 reproducciones = 14,4 GB  →  ~17 videos agotan el egress incluido del mes
```

Con el **proxy** de 400 MB:

```
1 video × 3 reproducciones = 1,2 GB   →  ~208 videos con el mismo presupuesto
```

**12× más de capacidad, sin cambiar nada de la infraestructura.**

### Consecuencia de producto: no conservar el master por defecto

Es una decisión de producto, no técnica, y merece discutirse explícitamente:

> **Analizar un video no requiere conservarlo.**

Propuesta:
- **Por defecto**: se conservan `audio` + `proxy` + transcript + resumen. El master se descarta
  tras el procesamiento (o directamente **no se sube nunca**).
- **Opción "conservar original"**: toggle explícito, con su coste reflejado en el plan.
- El proxy se genera **en el cliente con WebCodecs, durante la subida**. Coste de compute para
  nosotros: **cero**. Un backend tradicional tendría que transcodificar esto en servidores
  propios — otra ventaja concreta de la arquitectura elegida, no solo una mitigación.

Esto reduce a la vez el coste de almacenamiento (12×), el de egress (12×) y el tiempo de
subida percibido.

### Otras palancas si el egress sigue creciendo
1. CDN por delante de Storage con caché agresiva (`immutable`, los archivos nunca cambian).
2. Purgar el proxy de contenido no visto en 90 días; regenerable desde el master si existe.
3. Solo entonces, evaluar un CDN de video dedicado. **No antes de tener datos reales.**

---

## Cuotas y protección frente a bombas de coste

Aplicadas **en la base de datos**, no en el cliente (el cliente es del usuario):

| Control | Valor inicial | Motivo |
|---|---|---|
| Tamaño máximo por archivo | 10 GB | Cubre el caso de uso real |
| Duración máxima | 4 h | Por encima, el resumen necesita estrategia jerárquica |
| Minutos de ASR por usuario/mes | Según plan | Es el coste variable dominante |
| Jobs concurrentes por usuario | 3 | Evita agotar la cuota de ASR de golpe |
| Rate limit de creación de jobs | 10/hora | Anti-abuso |

Todo consumo se registra en `usage_ledger` ([ver 07](./07-modelo-de-datos.md#usage_ledger))
**desde el primer día**. Saber el coste real por usuario antes de que llegue la factura es la
diferencia entre ajustar precios con datos o con sustos.

---

## Umbrales de revisión

Señales concretas que obligan a reabrir decisiones de arquitectura:

| Señal | Acción |
|---|---|
| Egress > 80 % del incluido | Activar CDN + purga de proxies fríos |
| ASR > 40 % de los ingresos | Renegociar volumen o cambiar de proveedor (la abstracción ya existe) |
| > 15 % de subidas por la ruta de escape | Reevaluar: quizá haga falta transcodificación del lado servidor → reabrir [ADR-001](./02-adr-backend-serverless.md) |
| p95 de extracción en cliente > 3 min | Investigar el perfil de dispositivos; considerar ruta de escape por defecto para móvil |
