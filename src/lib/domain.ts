/**
 * Contrato de la API: los tipos que cruzan la frontera cliente/servidor.
 *
 * Es el mismo contrato que tendría la versión en la nube. Al migrar a Supabase cambian los
 * adaptadores de abajo, no estos tipos — que es justo lo que permite que el frontend no se
 * entere del cambio.
 */

export type JobState =
  'created' | 'uploading_audio' | 'transcribing' | 'summarizing' | 'ready' | 'failed';

export type MediaFileKind = 'audio' | 'source';

export type JobStatus = {
  state: JobState;
  /** Entre 0 y 1 dentro de la etapa actual. */
  progress: number;
  lastError: string | null;
};

export type MediaAssetSummary = {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  durationMs: number | null;
  createdAt: string;
  job: JobStatus;
  hasSource: boolean;
};

export type Speaker = {
  id: string;
  label: string;
  /** Nombre puesto por el usuario. Tiene prioridad sobre `label` en la interfaz. */
  displayName: string | null;
  suggestedName: string | null;
  suggestionEvidenceMs: number | null;
  suggestionConfidence: 'high' | 'medium' | 'low' | null;
  colorIndex: number;
  totalSpeakingMs: number;
};

export type TranscriptSegment = {
  id: string;
  idx: number;
  startMs: number;
  endMs: number;
  speakerId: string | null;
  text: string;
  confidence: number | null;
};

export type Transcript = {
  languageCode: string;
  languageConfidence: number | null;
  provider: string;
  modelVersion: string | null;
  wordCount: number | null;
  speakers: Speaker[];
  segments: TranscriptSegment[];
};

export type Chapter = {
  title: string;
  startMs: number;
  endMs: number;
};

export type ClaimKind = 'key_point' | 'decision' | 'action_item';

export type Citation = {
  segmentId: string;
  startMs: number;
};

export type SummaryClaim = {
  id: string;
  kind: ClaimKind;
  text: string;
  ownerSpeakerId: string | null;
  citations: Citation[];
};

export type Summary = {
  headline: string;
  abstract: string;
  chapters: Chapter[];
  model: string;
  claims: SummaryClaim[];
};

export type MediaAssetDetail = MediaAssetSummary & {
  transcript: Transcript | null;
  summary: Summary | null;
};

/** Nombre a mostrar para un hablante: lo que puso el usuario, o la etiqueta del proveedor. */
export function speakerName(speaker: Speaker): string {
  return speaker.displayName ?? speaker.label;
}

/** Paleta de hablantes. El color nunca es el único distintivo: siempre va con el nombre. */
export const SPEAKER_COLORS = [
  '#2f6fed',
  '#12805c',
  '#c0362c',
  '#7c3aed',
  '#b45309',
  '#0e7490',
  '#be185d',
  '#4d7c0f',
] as const;

export function speakerColor(colorIndex: number): string {
  return SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length] ?? SPEAKER_COLORS[0];
}
