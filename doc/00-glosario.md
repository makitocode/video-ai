# 00 — Glosario: las capas del problema

Antes de decidir proveedores conviene tener claro qué hace cada pieza, porque los nombres se
confunden con facilidad y la confusión lleva a elegir la herramienta equivocada.

## Las tres capas

```
   🎧 CAPA 1 — OÍR                    🏷️ CAPA 2 — SEPARAR VOCES        🧠 CAPA 3 — ENTENDER
   audio → texto                      audio → "quién habla cuándo"     texto → significado

   ASR                                Diarización                      LLM
   (Whisper, AssemblyAI,              (pyannote, Sortformer,           (Claude, GPT, Gemini)
    Deepgram, Gemini Transcribe)       incluido en las APIs de ASR)

   "Creo que deberíamos                [00:00-00:12] Hablante A         "Se debatió aplazar el
    aplazar el lanzamiento"            [00:12-00:31] Hablante B          lanzamiento; sin decisión
                                                                         final. ⏱ 02:14"
```

Las capas 1 y 2 **trabajan sobre el audio**. La capa 3 **trabaja sobre el texto**. Esa frontera
es lo que determina qué herramienta puede hacer qué.

---

## ASR — *Automatic Speech Recognition*

**Reconocimiento automático del habla: convierte audio en texto.** Nada más. Es el motor que
está detrás de los subtítulos automáticos, el dictado del móvil y las notas de reunión.

- **Whisper** (OpenAI) es un modelo ASR, de pesos abiertos. Se puede descargar y ejecutar.
- **AssemblyAI, Deepgram, Groq, ElevenLabs Scribe** son ASR ofrecidos como API.
- **Gemini 3.5 Transcribe** es un ASR de Google que además acepta instrucciones en lenguaje
  natural, por eso se parece más a un LLM.

> Un ASR devuelve texto con marcas de tiempo. **No sabe de qué habla**, ni saca conclusiones.

## Diarización

**Responde "¿cuántas personas hablan y en qué tramos habla cada una?"** — no "¿cómo se llaman?".

Funciona extrayendo una **huella vocal** (*speaker embedding*) de cada fragmento de audio —
timbre, tono, formantes — y agrupando las que se parecen. Es **procesamiento de señal**, no
comprensión de lenguaje.

> ⚠️ **Por qué un LLM no puede diarizar desde el texto.** El texto no contiene la voz. Un LLM
> leyendo un transcript plano puede *adivinar* dónde cambia el turno por lógica conversacional
> ("esto responde a una pregunta, probablemente lo dice otra persona"), pero **no puede saber
> que el minuto 3 y el minuto 47 son la misma persona**. Esa información sólo existe en el
> audio. Por eso la diarización tiene que ocurrir en la capa 1-2, nunca en la 3.

Diarización **no es** identificación de hablante: da `Hablante A`, `Hablante B`. Poner nombres
reales requiere o bien conocer a los participantes (como Zoom), o bien inferirlo del contenido
y confirmarlo con el usuario ([ver 01](./01-vision-y-alcance.md)).

## LLM — *Large Language Model*

**Modelo de lenguaje: entiende y genera texto.** Claude, GPT, Gemini.

Es la capa de **comprensión**: resumir, extraer decisiones, detectar temas, redactar. Trabaja
sobre lo que las capas 1 y 2 produjeron.

### Qué entradas acepta cada modelo (importa mucho)

| Modelo | Texto | Imagen | PDF | **Audio** |
|---|:---:|:---:|:---:|:---:|
| **Claude** | ✅ | ✅ | ✅ | ❌ **No** |
| Gemini | ✅ | ✅ | ✅ | ✅ Sí |
| GPT (variantes de audio) | ✅ | ✅ | ✅ | ✅ Sí |

> **Consecuencia directa para este proyecto: Claude no puede generar el transcript, porque no
> puede oír.** Claude entra después, sobre el texto ya transcrito. Un modelo *nativo de audio*
> como Gemini sí puede hacer transcripción y diarización en un solo paso — es una alternativa
> legítima a un ASR clásico, con sus propios costes y límites
> ([ver 05](./05-pipeline-analisis.md)).

## Modelos speech-to-speech (no confundir)

**Hablan y escuchan en tiempo real.** Sirven para construir asistentes de voz conversacionales.

Ejemplo: **NVIDIA PersonaPlex-7B** (enero 2026, MIT + NVIDIA Open Model License) — modelo
full-duplex que escucha y habla simultáneamente, con ~70 ms de latencia al cambiar de turno.

> **No sirve para este proyecto.** No transcribe ni diariza grabaciones: mantiene conversaciones
> en vivo. Es una categoría distinta que se confunde fácilmente porque también es "IA de voz".

---

## Mapa: quién hace qué en nuestro sistema

| Capa | Herramienta elegida | Dónde corre |
|---|---|---|
| Extraer el audio del contenedor de video | WebCodecs / Mediabunny | **Navegador del usuario** |
| 🎧 ASR — audio a texto | API gestionada (AssemblyAI por defecto) | Proveedor externo |
| 🏷️ Diarización — separar voces | Incluida en la misma llamada de ASR | Proveedor externo |
| 🧠 LLM — resumen, capítulos, citas, nombres sugeridos | **Claude** | Proveedor externo |
| Orquestar todo lo anterior | Edge Functions + Postgres | Supabase |

## Términos que aparecen en los documentos

| Término | Significado |
|---|---|
| **DER** (*Diarization Error Rate*) | Porcentaje de tiempo mal atribuido. Menor es mejor. pyannote 3.1 ronda 11-19 % en benchmarks estándar, y sube a ~26 % en habla conversacional difícil |
| **WER / cpWER** | Tasa de error de palabra. `cpWER` la mide teniendo en cuenta también la atribución de hablante — es la métrica que de verdad importa aquí |
| **Demux** | Separar las pistas (video, audio, subtítulos) de un contenedor como MP4 |
| **Transcodificar** | Volver a codificar en otro formato o calidad. Es lo caro en CPU |
| **Codec vs contenedor** | `.mp4` es el contenedor (la caja); H.264 y AAC son los códecs (cómo van comprimidos video y audio dentro) |
| **TUS** | Protocolo abierto de subida reanudable. Lo implementa Supabase Storage |
| **Backpressure** | Control de flujo: el consumidor marca el ritmo al productor para no desbordar la memoria |
| **RLS** (*Row Level Security*) | Reglas de acceso por fila, declaradas en SQL dentro de Postgres |
