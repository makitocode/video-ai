# 13 — Costes por video y elección de modelo

Qué cuesta procesar una grabación, dónde se va el dinero, y qué modelo usar en cada fase.

> **Los precios de Anthropic y AssemblyAI están verificados** contra su documentación oficial
> el 2026-09-21. **Los de OpenAI no**: su web de precios no era accesible al escribir esto, así
> que vienen de fuentes secundarias. Contrástalos antes de decidir nada sobre ellos.
>
> Todo lo demás son **estimaciones**. La aplicación ahora mide el consumo real y lo muestra en
> cada análisis: en cuanto proceses dos o tres reuniones, fíate de esos números y no de estos.

---

## 1. Dónde se gasta

El pipeline tiene cuatro fases. Sólo dos cuestan dinero:

| Fase | Dónde corre | Coste |
|---|---|---|
| Extraer el audio del video | Navegador (WebCodecs) | **0** — es CPU del usuario |
| Transcribir y separar voces | AssemblyAI | **por hora de audio** |
| Identificar participantes | LLM | **por token** |
| Analizar (resumen, temas, decisiones) | LLM | **por token** |
| Almacenar el video y el audio | Disco local | **0** |

Dos consecuencias que conviene interiorizar:

- **La extracción de audio es gratis y siempre lo será.** Es la decisión de arquitectura que
  más dinero ahorra y no aparece en ninguna factura ([ADR-001](./02-adr-backend-serverless.md)).
- **El coste crece con la duración, no con el peso del archivo.** Un video de 10 GB y uno de
  500 MB de la misma duración cuestan exactamente lo mismo.

---

## 2. Caso de referencia: reunión de 2 h 24 min

Es la grabación real con la que se probó el sistema: 19.627 palabras, 7 etiquetas de hablante.

### Transcripción

AssemblyAI con `universal-3-5-pro` y diarización:

| Concepto | Precio | Cantidad | Coste |
|---|---|---|---|
| Transcripción | 0,21 USD/h | 2,4 h | 0,504 USD |
| Diarización | 0,02 USD/h | 2,4 h | 0,048 USD |
| **Subtotal** | | | **0,55 USD** |

Con `universal-2` en lugar del insignia bajaría a **0,41 USD**, pero es el modelo que peor
maneja el español de los dos. No es donde conviene ahorrar.

### Análisis

El transcript anclado de esta reunión ronda los **50.000 tokens** (las marcas de tiempo y las
etiquetas de hablante pesan tanto como el texto). Los modelos de Claude 4.7 en adelante usan un
tokenizador que produce ~30 % más tokens para el mismo texto, ya incluido en esa cifra.

Con **Claude Opus 5 en ambas fases y caché activa**:

| Fase | Entrada | Salida | Coste |
|---|---|---|---|
| Identificar participantes | 50k escritos en caché × 6,25 USD/MTok | ~2k × 25 USD/MTok | 0,36 USD |
| Analizar | 50k leídos de caché × 0,50 USD/MTok | ~8k × 25 USD/MTok | 0,23 USD |
| **Subtotal** | | | **0,59 USD** |

### Total

**≈ 1,14 USD por esta reunión**, de principio a fin.

---

## 3. La optimización que gana más que cambiar de modelo

Las dos fases envían **exactamente el mismo transcript** con minutos de diferencia. Marcando
ese bloque como cacheable, la segunda llamada lo lee al 10 % del precio.

| | Sin caché | Con caché |
|---|---|---|
| Identificar | 0,30 USD | 0,36 USD |
| Analizar | 0,45 USD | 0,23 USD |
| **Total** | **0,75 USD** | **0,59 USD** |

**Ahorra 0,16 USD por reunión —un 22 %— sin tocar la calidad.** La escritura en caché cuesta un
25 % más que la entrada normal, así que la primera llamada sale algo más cara; la segunda lo
devuelve con creces. Por eso se aplica antes que cualquier idea de bajar de modelo: es el único
ahorro que no se paga con nada.

> ⚠️ **La caché se pierde si las dos fases usan modelos distintos.** Cada modelo tiene su
> propio espacio de caché. Es lo que hace que mezclar modelos rinda mucho menos de lo que
> parece (ver la tabla siguiente).

### El paralelo también cuesta la caché

Identificar y analizar son independientes —el análisis recibe el transcript con etiquetas
`Speaker A`, no los nombres—, así que por defecto corren **a la vez**: la espera pasa de ser la
suma de las dos llamadas a ser la más lenta de las dos.

Ese tiempo se paga aquí. Arrancando simultáneas, ninguna encuentra la caché escrita todavía, así
que las dos pagan su entrada completa: se vuelve a la columna «Sin caché», **0,75 USD en vez de
0,59 USD** en el caso de referencia.

| | En serie (`ANALYSIS_PARALLEL=false`) | En paralelo (por defecto) |
|---|---|---|
| Coste del análisis | 0,59 USD | 0,75 USD |
| Espera | suma de las dos llamadas | la más lenta de las dos |

La elección por defecto es el tiempo, porque el transcript ya está en pantalla mientras esto
ocurre y lo que queda por llegar es el resumen. Quien prefiera los 0,16 USD pone
`ANALYSIS_PARALLEL="false"`.

---

## 4. Qué modelo usar en cada fase

### Las dos fases no piden lo mismo

| | Identificar participantes | Analizar |
|---|---|---|
| Qué hace | Deducir quién es quién desde pistas dispersas | Redactar, agrupar temas, distinguir decisiones de charla |
| Entrada | 50k tokens | 50k tokens |
| Salida | ~2k tokens | ~8k tokens |
| Qué pasa si se equivoca | Nombres mal puestos en **todo** el transcript y el informe | Decisiones inventadas o temas mal agrupados |
| Se nota el error | **Sí, de inmediato** | A veces no, y es peor |

### Comparativa sobre el caso de referencia

| Configuración | Identificar | Analizar | Coste análisis | Total con ASR |
|---|---|---|---|---|
| **Opus 5 en ambas** (por defecto) | 0,36 | 0,23 | **0,59** | **1,14** |
| Opus identificar + Sonnet analizar | 0,30 | 0,18 | 0,48 | 1,03 |
| **Sonnet 5 en ambas** | 0,15 | 0,09 | **0,23** | **0,78** |
| Haiku 4.5 en ambas | 0,07 | 0,05 | 0,12 | 0,67 |

### Recomendación

**Opus 5 en las dos fases, que es el valor por defecto.** El razonamiento:

1. **La diferencia es de 0,36 USD por reunión.** Bajar a Sonnet en todo ahorra eso. A 20
   reuniones al mes son 7 USD. Comparado con el riesgo de enviar un acta con una decisión que
   nadie tomó, no compensa.
2. **Mezclar modelos es la peor opción de las tres.** Ahorra sólo 0,11 USD porque pierde la
   caché, y a cambio introduce una inconsistencia difícil de depurar: si el informe sale mal,
   hay que averiguar cuál de los dos modelos falló.
3. **El coste dominante es la transcripción, no el análisis.** Optimizar el LLM mientras el ASR
   se lleva la mitad de la factura es optimizar la parte equivocada.

**Cuándo sí bajar a Sonnet:** cuando proceses volumen alto de reuniones rutinarias donde un
error cuesta poco, y **después de haber comparado ambos sobre tus propias grabaciones**. Para
eso está el interruptor:

```bash
ANALYSIS_MODEL_IDENTIFY="claude-sonnet-5"
ANALYSIS_MODEL_ANALYZE="claude-sonnet-5"
```

Procesa la misma reunión con cada configuración y compara los informes. Es media hora de
trabajo y sustituye toda esta tabla por evidencia sobre tu propio material.

**Haiku no**, para ninguna de las dos fases. Son trabajos de deducción sobre texto largo, que
es justo donde peor rinde.

---

## 5. Cuántos videos por dólar

Normalizado por hora de grabación:

| Concepto | USD por hora de video |
|---|---|
| Transcripción + diarización | 0,23 |
| Análisis con Opus 5 (con caché) | 0,25 |
| **Total** | **0,48** |

### Por cada dólar

| Qué | Con Opus 5 | Con Sonnet 5 |
|---|---|---|
| **Horas de video procesadas de principio a fin** | **2,1 h** | **3,0 h** |
| Reuniones de 1 h | 2,1 | 3,0 |
| Reuniones de 2 h 24 min | 0,9 | 1,3 |

### Sólo transcribir (sin análisis)

| Qué | Cantidad |
|---|---|
| Horas de audio por dólar | **4,3 h** |
| Reuniones de 2 h 24 min por dólar | **1,8** |

### Sólo analizar un transcript ya existente

| Qué | Con Opus 5 | Con Sonnet 5 |
|---|---|---|
| Horas de transcript por dólar | **4,1 h** | **10,2 h** |
| Reuniones de 2 h 24 min por dólar | **1,7** | **4,3** |

### El crédito gratuito de AssemblyAI

50 USD al registrarse, sin tarjeta. A 0,23 USD/h son **unas 217 horas de audio**, o **90
reuniones** como la de referencia. La transcripción te sale gratis durante bastante tiempo; el
análisis no, porque Anthropic y OpenAI no dan crédito equivalente.

---

## 6. Medir en vez de estimar

Todo lo anterior son cuentas sobre supuestos. La aplicación ahora **registra el consumo real
que reporta cada proveedor** y lo muestra en cada análisis, bajo «Coste del análisis»:

```
Coste del análisis: $0.587
  Fase                      Modelo          Entrada           Salida    Coste
  identificar participantes claude-opus-5   51.204            1.843     $0.3597
  analizar                  claude-opus-5   112 +51.204 ⚡    7.901     $0.2229
  ⚡ 51.204 tokens servidos desde caché, al 10 % del precio de entrada.
```

Se guarda lo que el proveedor dice que gastó, no una estimación por conteo de palabras: los
tokenizadores cambian entre modelos, y el razonamiento del modelo consume presupuesto sin
aparecer en el texto de salida. **Una estimación por palabras se equivoca fácilmente en un
30 %.**

El símbolo ⚡ sirve además de verificación: si en la segunda fase no aparece, la caché no está
funcionando y se está pagando la entrada entera dos veces.

Los registros quedan en la tabla `analysis_usage`, así que se puede agregar por mes:

```sql
select model, count(*) as analisis,
       round(sum(cost_micros) / 1000000.0, 2) as usd
  from analysis_usage group by model;
```

---

## 7. Cambiar de proveedor

La arquitectura separa **puertos** (lo que el sistema necesita) de **adaptadores** (quién lo
provee), así que cambiar de proveedor no toca el pipeline:

```
src/server/
├─ ports/
│  ├─ transcription.ts     ← el contrato del reconocimiento de voz
│  └─ analysis.ts          ← el contrato del análisis
├─ adapters/
│  ├─ transcription/       ← assemblyai · mock   (aquí iría elevenlabs)
│  └─ analysis/            ← anthropic · openai · mock
│     └─ prompts.ts        ← compartidos entre proveedores, a propósito
└─ registry.ts             ← el único sitio que decide quién ocupa cada puerto
```

**Los prompts son compartidos entre adaptadores de análisis a propósito.** Si cada proveedor
recibiera instrucciones distintas, comparar cuál lo hace mejor no significaría nada: estarías
midiendo dos prompts, no dos modelos.

Para añadir ElevenLabs como alternativa a AssemblyAI: un archivo en `adapters/transcription/`
que cumpla el puerto, y una rama en `registry.ts`. El resto del sistema no se entera.

### Variables de configuración

| Variable | Qué hace |
|---|---|
| `ANALYSIS_PROVIDER` | `anthropic` · `openai` · `mock`. Si se omite, gana la primera clave disponible |
| `ANALYSIS_MODEL_IDENTIFY` | Modelo de la fase de identificación |
| `ANALYSIS_MODEL_ANALYZE` | Modelo de la fase de análisis |
| `ASSEMBLYAI_SPEECH_MODELS` | Lista ordenada de modelos de transcripción |
| `TRANSCRIPTION_LANGUAGE` | Fija el idioma en vez de detectarlo |
| `TRANSCRIPTION_PROMPT` | Describe la grabación para mejorar la precisión |
| `TRANSCRIPTION_KEYTERMS` | Nombres propios y jerga |

---

## 8. Supuestos y límites de estas cuentas

Para que se puedan rehacer cuando cambien los precios:

| Supuesto | Valor | Confianza |
|---|---|---|
| Transcript anclado de 2 h 24 | ~50.000 tokens | Media — la app ya lo mide de verdad |
| Salida de la fase de identificación | ~2.000 tokens | Media |
| Salida de la fase de análisis | ~8.000 tokens, razonamiento incluido | **Baja** — varía mucho según la reunión |
| Acierto de la caché entre fases | 100 % | Media — depende de que ambas llamadas caigan dentro de los 5 min |
| Precios de Anthropic y AssemblyAI | Documentación oficial, 2026-09-21 | **Alta** |
| Precios de OpenAI | Fuentes secundarias | **Baja — verificar** |

Lo que **no** está incluido: reintentos por fallo, análisis repetidos de la misma grabación, e
impuestos.
