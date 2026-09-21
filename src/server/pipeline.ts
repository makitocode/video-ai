import { buildAnchoredTranscript } from '@/lib/anchored-transcript';
import { config } from './config';
import type { JobState } from '@/lib/domain';
import { publishJobStatus } from './events';
import { getAnalysisPort, getTranscriptionPort } from './registry';
import { recordUsage } from './repositories';
import {
  applyIdentifiedSpeakers,
  getMediaFile,
  getTranscript,
  getTranscriptId,
  saveSummary,
  saveTranscript,
  updateJob,
} from './repositories';

/**
 * Orquestación del pipeline de análisis.
 *
 * Es el adaptador local del puerto que en la nube ocupan las Edge Functions más pgmq: allí
 * un webhook despierta una función, aquí el trabajo corre en el proceso de Next. Lo que no
 * cambia es dónde vive el estado: **cada transición se escribe en la base de datos antes de
 * publicarse**, así que recargar la página o reiniciar el servidor nunca pierde el progreso.
 *
 * Las tareas se lanzan sin esperarlas (`void`) desde las rutas de API: la petición HTTP
 * responde de inmediato y el navegador sigue el avance por SSE.
 */

/** Jobs en vuelo, para no arrancar dos veces el mismo asset. */
const running = new Set<string>();

function transition(assetId: string, state: JobState, progress: number, error?: string): void {
  updateJob(assetId, { state, progress, lastError: error ?? null });
  publishJobStatus(assetId, { state, progress, lastError: error ?? null });
}

export function isRunning(assetId: string): boolean {
  return running.has(assetId);
}

/**
 * Ejecuta el análisis completo: transcripción con diarización y después resumen.
 *
 * El resumen depende del transcript, así que van en serie. Si el resumen falla, el transcript
 * ya está guardado y sigue siendo utilizable: el estado refleja esa diferencia en vez de
 * tirar todo el trabajo.
 */
export async function runAnalysis(assetId: string, durationMs: number): Promise<void> {
  if (running.has(assetId)) return;
  running.add(assetId);

  try {
    await transcribeStage(assetId, durationMs);
    await analysisStages(assetId, durationMs);
    transition(assetId, 'ready', 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fallo desconocido en el análisis.';
    transition(assetId, 'failed', 0, message);
  } finally {
    running.delete(assetId);
  }
}

async function transcribeStage(assetId: string, durationMs: number): Promise<void> {
  const audioFile = getMediaFile(assetId, 'audio');
  if (audioFile === null || audioFile.upload_state !== 'complete') {
    throw new Error('El audio todavía no está disponible en el servidor.');
  }

  transition(assetId, 'transcribing', 0);

  const provider = getTranscriptionPort();
  const result = await provider.transcribe({
    audioStoragePath: audioFile.storage_path,
    durationMs,
    onProgress: (progress) => transition(assetId, 'transcribing', progress),
  });

  if (result.segments.length === 0) {
    throw new Error('No se detectó voz en el audio, así que no hay nada que transcribir.');
  }

  saveTranscript(assetId, {
    languageCode: result.languageCode,
    languageConfidence: result.languageConfidence,
    provider: provider.provider,
    modelVersion: result.modelVersion,
    speakers: result.speakers,
    segments: result.segments,
  });
}

/**
 * Deduce quién es cada hablante antes de enseñar nada.
 *
 * La diarización sólo da «Speaker A»; quién es cada uno se deduce de lo que se dice. Va en su
 * propia etapa porque es lo que retiene los nombres: el transcript ya se puede leer sin ella,
 * pero sustituir «Speaker C» por un nombre a mitad de lectura obliga a releer.
 */
/**
 * Identificación de hablantes y análisis: los dos trabajos que siguen al transcript.
 *
 * **Son independientes.** El análisis recibe el transcript anclado con sus etiquetas
 * (`Speaker A`), no los nombres deducidos: quién es quién se resuelve al pintar, cruzando la
 * etiqueta con la tabla de hablantes. Encadenarlos hacía esperar la suma de los dos sin que
 * el resumen ganara nada, así que por defecto corren a la vez y la espera es la del más lento.
 *
 * Lo que sí cuesta el paralelo es la caché de prompt: en serie, la segunda llamada reaprovecha
 * el transcript al 10 % de su precio; arrancando a la vez, ninguna de las dos encuentra caché
 * escrita todavía. Por eso `ANALYSIS_PARALLEL=false` recupera el ahorro para quien prefiera
 * pagar menos y esperar más.
 *
 * El estado refleja lo que de verdad está pasando: mientras los dos corren se anuncia la
 * identificación —es lo que retiene los nombres en pantalla—, y al resolverse pasa a resumen
 * si el análisis sigue en curso.
 */
async function analysisStages(assetId: string, durationMs: number): Promise<void> {
  transition(assetId, 'identifying_speakers', 0);

  if (!config.analysisParallel) {
    await identifySpeakersStage(assetId);
    await analyzeStage(assetId, durationMs);
    return;
  }

  let analyzeDone = false;

  const identifying = identifySpeakersStage(assetId).then(() => {
    // Si el análisis ya terminó, anunciar «resumiendo» sería mentir: queda ir a `ready`.
    if (!analyzeDone) transition(assetId, 'summarizing', 0.5);
  });

  const analyzing = analyzeStage(assetId, durationMs).then(() => {
    analyzeDone = true;
  });

  // `allSettled` y no `all`: con `all`, el primer fallo marca el job como fallido mientras la
  // otra llamada sigue viva y escribe después en la base de datos, sobre un estado que ya dice
  // otra cosa. Esperando a que las dos terminen, lo que se guarda es coherente con lo que se
  // muestra, y se propaga el primer error real.
  const results = await Promise.allSettled([identifying, analyzing]);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure !== undefined) throw (failure as PromiseRejectedResult).reason;
}

async function identifySpeakersStage(assetId: string): Promise<void> {
  const transcript = getTranscript(assetId);
  const transcriptId = getTranscriptId(assetId);
  if (transcript === null || transcriptId === null) return;

  transition(assetId, 'identifying_speakers', 0);

  const provider = await getAnalysisPort();
  const { payload: identification, usage: identifyUsage } = await provider.identifySpeakers({
    anchoredTranscript: buildAnchored(transcript),
    speakers: transcript.speakers.map((speaker) => ({
      label: speaker.label,
      totalSpeakingMs: speaker.totalSpeakingMs,
    })),
    languageCode: transcript.languageCode,
  });
  recordUsage(assetId, 'identify', identifyUsage);

  // Una etiqueta que el modelo señala como la misma persona que otra recibe su mismo nombre.
  // No se fusionan las etiquetas: eso destruiría la atribución original y sería irreversible
  // si la deducción fuera errónea. Compartir nombre da el resultado visible que se busca y
  // deja los datos intactos.
  const nameByLabel = new Map(
    identification.speakers
      .filter((speaker) => speaker.name !== null)
      .map((speaker) => [speaker.label, speaker.name as string]),
  );

  applyIdentifiedSpeakers(
    transcriptId,
    identification.speakers.map((speaker) => {
      const resolvedName =
        speaker.name ??
        (speaker.sameAsLabel === null ? null : (nameByLabel.get(speaker.sameAsLabel) ?? null));

      // Sólo se aplica como nombre definitivo lo que el modelo sostiene con confianza; lo
      // dudoso queda como sugerencia para que una persona lo confirme.
      const confident = speaker.confidence === 'high' || speaker.confidence === 'medium';

      return {
        label: speaker.label,
        displayName: confident ? resolvedName : null,
        role: speaker.role,
        suggestedName: confident ? null : resolvedName,
        evidenceMs: speaker.evidenceMs,
        confidence: speaker.confidence,
      };
    }),
  );

  transition(assetId, 'identifying_speakers', 1);
}

async function analyzeStage(assetId: string, durationMs: number): Promise<void> {
  const transcript = getTranscript(assetId);
  if (transcript === null) throw new Error('No hay transcript que analizar.');

  transition(assetId, 'summarizing', 0);

  const provider = await getAnalysisPort();
  const { payload, usage: analyzeUsage } = await provider.analyze({
    anchoredTranscript: buildAnchored(transcript),
    languageCode: transcript.languageCode,
    durationMs,
  });
  recordUsage(assetId, 'analyze', analyzeUsage);

  transition(assetId, 'summarizing', 0.8);

  const { discarded } = saveSummary(assetId, {
    headline: payload.headline,
    overview: payload.overview,
    model: provider.models.analyze,
    topics: payload.topics.map((topic) => ({
      title: topic.title,
      startMs: topic.startMs,
      endMs: topic.endMs,
      points: topic.points.map(toClaimInput),
    })),
    decisions: payload.decisions.map(toClaimInput),
    actionItems: payload.actionItems.map((item) => ({
      ...toClaimInput(item),
      // `owner` es texto libre del modelo; la atribución fiable es la etiqueta del hablante.
      ownerSpeakerLabel: item.speakerLabel,
    })),
  });

  if (discarded > 0) {
    // No es un fallo: es la verificación haciendo su trabajo. Se registra porque una tasa
    // alta de descartes indica que el prompt necesita ajuste.
    console.warn(
      `[video-ai] ${discarded} afirmación(es) descartadas por citar marcas de tiempo que no ` +
        'corresponden a ningún segmento del transcript.',
    );
  }
}

function toClaimInput(claim: {
  text: string;
  speakerLabel: string | null;
  citations: ReadonlyArray<{ startMs: number }>;
}): { text: string; ownerSpeakerLabel: string | null; citationsMs: number[] } {
  return {
    text: claim.text,
    ownerSpeakerLabel: claim.speakerLabel,
    citationsMs: claim.citations.map((citation) => citation.startMs),
  };
}

/** Vista anclada del transcript: cada intervención con su marca de tiempo y su hablante. */
function buildAnchored(transcript: NonNullable<ReturnType<typeof getTranscript>>): string {
  const labelById = new Map(transcript.speakers.map((speaker) => [speaker.id, speaker.label]));

  return buildAnchoredTranscript(
    transcript.segments.map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      speakerLabel:
        segment.speakerId === null
          ? 'Desconocido'
          : (labelById.get(segment.speakerId) ?? 'Desconocido'),
      text: segment.text,
    })),
  );
}
