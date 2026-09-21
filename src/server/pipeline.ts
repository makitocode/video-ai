import { buildAnchoredTranscript } from '@/lib/anchored-transcript';
import type { JobState } from '@/lib/domain';
import { publishJobStatus } from './events';
import { getSummaryProvider } from './providers/summary';
import { getTranscriptionProvider } from './providers/transcription';
import {
  applySpeakerSuggestion,
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
    await summarizeStage(assetId, durationMs);
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

  const provider = getTranscriptionProvider();
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
    provider: provider.name,
    modelVersion: result.modelVersion,
    speakers: result.speakers,
    segments: result.segments,
  });
}

async function summarizeStage(assetId: string, durationMs: number): Promise<void> {
  const transcript = getTranscript(assetId);
  if (transcript === null) throw new Error('No hay transcript que resumir.');

  transition(assetId, 'summarizing', 0);

  const speakerLabelById = new Map(transcript.speakers.map((s) => [s.id, s.label]));
  const anchored = buildAnchoredTranscript(
    transcript.segments.map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      speakerLabel:
        segment.speakerId === null
          ? 'Desconocido'
          : (speakerLabelById.get(segment.speakerId) ?? 'Desconocido'),
      text: segment.text,
    })),
  );

  const provider = getSummaryProvider();
  const payload = await provider.summarize({
    anchoredTranscript: anchored,
    languageCode: transcript.languageCode,
    durationMs,
  });

  transition(assetId, 'summarizing', 0.8);

  const claims = [
    ...payload.keyPoints.map((claim) => ({ ...claim, kind: 'key_point' as const })),
    ...payload.decisions.map((claim) => ({ ...claim, kind: 'decision' as const })),
    ...payload.actionItems.map((claim) => ({ ...claim, kind: 'action_item' as const })),
  ];

  const { discarded } = saveSummary(assetId, {
    headline: payload.headline,
    abstract: payload.abstract,
    chapters: payload.chapters,
    model: provider.model,
    claims: claims.map((claim) => ({
      kind: claim.kind,
      text: claim.text,
      ownerSpeakerLabel: claim.ownerSpeakerLabel,
      citationsMs: claim.citations.map((citation) => citation.startMs),
    })),
  });

  if (discarded > 0) {
    // No es un fallo: es la verificación haciendo su trabajo. Se registra porque una tasa
    // alta de descartes indica que el prompt necesita ajuste.
    console.warn(
      `[video-ai] ${discarded} afirmación(es) descartadas por citar marcas de tiempo ` +
        'que no corresponden a ningún segmento del transcript.',
    );
  }

  // Las sugerencias de nombre se guardan como tales, nunca aplicadas: el usuario decide.
  const transcriptId = getTranscriptId(assetId);
  if (transcriptId !== null) {
    for (const suggestion of payload.speakerNameSuggestions) {
      applySpeakerSuggestion({
        transcriptId,
        label: suggestion.label,
        suggestedName: suggestion.suggestedName,
        evidenceMs: suggestion.evidenceMs,
        confidence: suggestion.confidence,
      });
    }
  }
}
