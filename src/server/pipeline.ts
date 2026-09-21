import { buildAnchoredTranscript } from '@/lib/anchored-transcript';
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
 * Las tres fases son trabajos separados que se piden por separado.
 *
 * Encadenarlas automáticamente tenía dos costes que no compensaban. El primero es la espera:
 * el transcript está listo en cuanto responde la transcripción, pero no se podía usar hasta
 * que terminaban dos llamadas a un modelo que tardan minutos sobre una reunión larga. El
 * segundo es el dinero: si el informe fallaba, reintentar volvía a pagar la identificación,
 * que había salido bien.
 *
 * Separadas, cada fase se pide cuando hace falta, se paga una vez y un fallo sólo cuesta
 * repetir lo que falló. La transcripción sigue arrancando sola porque es la única que no
 * decide nada: sin ella no hay nada que mirar.
 */

/** Envoltura común: un trabajo por asset, estado en la base de datos antes que en pantalla. */
async function run(assetId: string, work: () => Promise<void>): Promise<void> {
  if (running.has(assetId)) return;
  running.add(assetId);

  try {
    await work();
    // `ready` significa «no hay nada en curso», no «ya está todo hecho». Qué falta por hacer
    // se deduce de los datos: hay transcript, hay hablantes identificados, hay resumen.
    transition(assetId, 'ready', 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fallo desconocido en el análisis.';
    transition(assetId, 'failed', 0, message);
  } finally {
    running.delete(assetId);
  }
}

/** Fase 1: transcribir y separar voces. Arranca sola al terminar la subida. */
export async function runTranscription(assetId: string, durationMs: number): Promise<void> {
  return run(assetId, () => transcribeStage(assetId, durationMs));
}

/** Fase 2: deducir quién es cada «Speaker A». Se pide a mano. */
export async function runIdentification(assetId: string): Promise<void> {
  return run(assetId, () => identifySpeakersStage(assetId));
}

/** Fase 3: redactar el informe. Se pide a mano. */
export async function runSummary(assetId: string, durationMs: number): Promise<void> {
  return run(assetId, () => analyzeStage(assetId, durationMs));
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
 * Deduce quién es cada hablante a partir de lo que se dice.
 *
 * La diarización sólo da «Speaker A». Esta fase se pide aparte porque cuesta dinero y tiempo,
 * y porque el transcript ya se lee sin ella: quien sólo quiera el texto no tiene por qué
 * pagarla. Al terminar, los nombres sustituyen a las etiquetas en toda la interfaz.
 */
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
