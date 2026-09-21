/**
 * Contrato de la API: los tipos que cruzan la frontera cliente/servidor.
 *
 * Es el mismo contrato que tendría la versión en la nube. Al migrar a Supabase cambian los
 * adaptadores de abajo, no estos tipos — que es justo lo que permite que el frontend no se
 * entere del cambio.
 */

export type JobState =
  | 'created'
  | 'uploading_audio'
  | 'transcribing'
  // Etapa propia y no un detalle del resumen: hasta que no se sabe quién es quién, el
  // transcript no se enseña. Un «Speaker C» no le sirve a nadie para leer una reunión.
  | 'identifying_speakers'
  | 'summarizing'
  | 'ready'
  | 'failed';

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
  /** Papel en la reunión: «modera», «cliente», «responsable de producto»… */
  role: string | null;
  /** Quién puso el nombre: distingue lo deducido de lo confirmado por una persona. */
  identifiedBy: 'model' | 'user' | null;
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

/**
 * Un tema de la reunión con sus puntos clave.
 *
 * Agrupar por tema y ordenar cronológicamente es lo que convierte una lista de frases
 * sueltas en algo que se lee de arriba abajo y deja claro de qué fue la reunión.
 */
export type Topic = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  claims: SummaryClaim[];
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
  /** Dos párrafos; tres cuando la grabación pasa de hora y media. */
  overview: string[];
  /** Puntos clave agrupados por tema, en orden cronológico. */
  topics: Topic[];
  decisions: SummaryClaim[];
  actionItems: SummaryClaim[];
  model: string;
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
