import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import { findSegmentAt } from '@/lib/citation-anchor';
import { estimateCostMicros } from './pricing';
import { ANALYSIS_PROMPT_STAMP } from './prompts';
import type { TokenUsage } from './ports/analysis';
import type {
  ClaimKind,
  JobState,
  MediaAssetDetail,
  MediaAssetSummary,
  MediaFileKind,
  Speaker,
  Summary,
  SummaryClaim,
  Topic,
  Transcript,
  TranscriptSegment,
} from '@/lib/domain';

/**
 * Acceso a datos.
 *
 * Todas las consultas viven aquí para que las rutas de API no contengan SQL. Cuando se migre
 * a Supabase, este archivo es lo único que se reescribe.
 */

// --- Tipos de fila tal como los devuelve SQLite ------------------------------

type AssetRow = {
  id: string;
  original_filename: string;
  size_bytes: number;
  duration_ms: number | null;
  created_at: string;
  state: JobState;
  progress: number;
  last_error: string | null;
  source_files: number;
};

type SpeakerRow = {
  id: string;
  label: string;
  display_name: string | null;
  suggested_name: string | null;
  suggestion_evidence_ms: number | null;
  suggestion_confidence: string | null;
  role: string | null;
  identified_by: string | null;
  color_index: number;
  total_speaking_ms: number;
};

type SegmentRow = {
  id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  speaker_id: string | null;
  text: string;
  confidence: number | null;
};

// --- Assets ------------------------------------------------------------------

export function createMediaAsset(input: {
  originalFilename: string;
  sizeBytes: number;
  durationMs: number | null;
  container: string | null;
  ingestRoute: string;
}): string {
  const db = getDb();
  const assetId = randomUUID();

  // El asset y su job se crean juntos o no se crean: un asset sin job sería un
  // registro que ningún proceso recogería nunca.
  db.transaction(() => {
    db.prepare(
      `insert into media_assets (id, original_filename, size_bytes, duration_ms, container, ingest_route)
       values (?, ?, ?, ?, ?, ?)`,
    ).run(
      assetId,
      input.originalFilename,
      input.sizeBytes,
      input.durationMs,
      input.container,
      input.ingestRoute,
    );

    db.prepare(`insert into jobs (id, media_asset_id, state) values (?, ?, 'created')`).run(
      randomUUID(),
      assetId,
    );
  })();

  return assetId;
}

const ASSET_SELECT = `
  select a.id, a.original_filename, a.size_bytes, a.duration_ms, a.created_at,
         j.state, j.progress, j.last_error,
         (select count(*) from media_files f
           where f.media_asset_id = a.id and f.kind = 'source' and f.upload_state = 'complete')
           as source_files
    from media_assets a
    join jobs j on j.media_asset_id = a.id
`;

function toAssetSummary(row: AssetRow): MediaAssetSummary {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    job: { state: row.state, progress: row.progress, lastError: row.last_error },
    hasSource: row.source_files > 0,
  };
}

export function listMediaAssets(): MediaAssetSummary[] {
  const rows = getDb().prepare(`${ASSET_SELECT} order by a.created_at desc`).all() as AssetRow[];
  return rows.map(toAssetSummary);
}

export function getMediaAsset(assetId: string): MediaAssetSummary | null {
  const row = getDb().prepare(`${ASSET_SELECT} where a.id = ?`).get(assetId) as
    AssetRow | undefined;
  return row === undefined ? null : toAssetSummary(row);
}

export function getMediaAssetDetail(assetId: string): MediaAssetDetail | null {
  const asset = getMediaAsset(assetId);
  if (asset === null) return null;

  return {
    ...asset,
    usage: getUsage(assetId),
    transcript: getTranscript(assetId),
    summary: getSummary(assetId),
  };
}

export function deleteMediaAsset(assetId: string): void {
  getDb().prepare('delete from media_assets where id = ?').run(assetId);
}

export function setAssetDuration(assetId: string, durationMs: number): void {
  getDb().prepare('update media_assets set duration_ms = ? where id = ?').run(durationMs, assetId);
}

// --- Archivos ----------------------------------------------------------------

export function upsertMediaFile(input: {
  assetId: string;
  kind: MediaFileKind;
  storagePath: string;
  sizeBytes: number | null;
  contentType: string;
}): void {
  getDb()
    .prepare(
      `insert into media_files (id, media_asset_id, kind, storage_path, size_bytes, content_type, upload_state)
       values (?, ?, ?, ?, ?, ?, 'uploading')
       on conflict (media_asset_id, kind) do update set
         storage_path = excluded.storage_path,
         size_bytes   = excluded.size_bytes,
         content_type = excluded.content_type`,
    )
    .run(
      randomUUID(),
      input.assetId,
      input.kind,
      input.storagePath,
      input.sizeBytes,
      input.contentType,
    );
}

export type MediaFileRow = {
  storage_path: string;
  size_bytes: number | null;
  bytes_uploaded: number;
  upload_state: string;
  content_type: string | null;
};

export function getMediaFile(assetId: string, kind: MediaFileKind): MediaFileRow | null {
  const row = getDb()
    .prepare(
      `select storage_path, size_bytes, bytes_uploaded, upload_state, content_type
         from media_files where media_asset_id = ? and kind = ?`,
    )
    .get(assetId, kind) as MediaFileRow | undefined;
  return row ?? null;
}

export function recordUploadProgress(input: {
  assetId: string;
  kind: MediaFileKind;
  bytesUploaded: number;
  complete: boolean;
}): void {
  getDb()
    .prepare(
      `update media_files set bytes_uploaded = ?, upload_state = ?
        where media_asset_id = ? and kind = ?`,
    )
    .run(input.bytesUploaded, input.complete ? 'complete' : 'uploading', input.assetId, input.kind);
}

// --- Jobs --------------------------------------------------------------------

export function updateJob(
  assetId: string,
  patch: { state?: JobState; progress?: number; lastError?: string | null; providerJobId?: string },
): void {
  const db = getDb();
  const current = db
    .prepare(
      'select state, progress, last_error, provider_job_id from jobs where media_asset_id = ?',
    )
    .get(assetId) as
    | {
        state: JobState;
        progress: number;
        last_error: string | null;
        provider_job_id: string | null;
      }
    | undefined;
  if (current === undefined) return;

  db.prepare(
    `update jobs set state = ?, progress = ?, last_error = ?, provider_job_id = ?,
            state_changed_at = datetime('now')
      where media_asset_id = ?`,
  ).run(
    patch.state ?? current.state,
    patch.progress ?? current.progress,
    patch.lastError === undefined ? current.last_error : patch.lastError,
    patch.providerJobId ?? current.provider_job_id,
    assetId,
  );
}

// --- Transcripts -------------------------------------------------------------

export type TranscriptInput = {
  languageCode: string;
  languageConfidence: number | null;
  provider: string;
  modelVersion: string | null;
  speakers: Array<{ label: string; totalSpeakingMs: number }>;
  segments: Array<{
    startMs: number;
    endMs: number;
    speakerLabel: string;
    text: string;
    confidence: number | null;
  }>;
};

export function saveTranscript(assetId: string, input: TranscriptInput): void {
  const db = getDb();

  db.transaction(() => {
    // Reemplazar en vez de acumular: volver a transcribir sustituye el resultado anterior.
    db.prepare('delete from transcripts where media_asset_id = ?').run(assetId);

    const transcriptId = randomUUID();
    const wordCount = input.segments.reduce(
      (total, segment) => total + segment.text.split(/\s+/).filter(Boolean).length,
      0,
    );

    db.prepare(
      `insert into transcripts
         (id, media_asset_id, language_code, language_confidence, provider, model_version, word_count)
       values (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      transcriptId,
      assetId,
      input.languageCode,
      input.languageConfidence,
      input.provider,
      input.modelVersion,
      wordCount,
    );

    const speakerIdByLabel = new Map<string, string>();
    const insertSpeaker = db.prepare(
      `insert into speakers (id, transcript_id, label, color_index, total_speaking_ms)
       values (?, ?, ?, ?, ?)`,
    );

    input.speakers.forEach((speaker, index) => {
      const speakerId = randomUUID();
      speakerIdByLabel.set(speaker.label, speakerId);
      insertSpeaker.run(speakerId, transcriptId, speaker.label, index, speaker.totalSpeakingMs);
    });

    const insertSegment = db.prepare(
      `insert into transcript_segments
         (id, transcript_id, idx, start_ms, end_ms, speaker_id, text, confidence)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    input.segments.forEach((segment, index) => {
      insertSegment.run(
        randomUUID(),
        transcriptId,
        index,
        segment.startMs,
        segment.endMs,
        speakerIdByLabel.get(segment.speakerLabel) ?? null,
        segment.text,
        segment.confidence,
      );
    });
  })();
}

function toSpeaker(row: SpeakerRow): Speaker {
  const confidence = row.suggestion_confidence;
  return {
    id: row.id,
    label: row.label,
    displayName: row.display_name,
    suggestedName: row.suggested_name,
    suggestionEvidenceMs: row.suggestion_evidence_ms,
    suggestionConfidence:
      confidence === 'high' || confidence === 'medium' || confidence === 'low' ? confidence : null,
    role: row.role,
    identifiedBy:
      row.identified_by === 'model' || row.identified_by === 'user' ? row.identified_by : null,
    colorIndex: row.color_index,
    totalSpeakingMs: row.total_speaking_ms,
  };
}

export function getTranscript(assetId: string): Transcript | null {
  const db = getDb();
  const transcript = db
    .prepare(
      `select id, language_code, language_confidence, provider, model_version, word_count,
              speakers_identified_at
         from transcripts where media_asset_id = ?`,
    )
    .get(assetId) as
    | {
        id: string;
        language_code: string;
        language_confidence: number | null;
        provider: string;
        model_version: string | null;
        word_count: number | null;
        speakers_identified_at: string | null;
      }
    | undefined;

  if (transcript === undefined) return null;

  const speakers = db
    .prepare(
      `select id, label, display_name, suggested_name, suggestion_evidence_ms,
              suggestion_confidence, role, identified_by, color_index, total_speaking_ms
         from speakers where transcript_id = ? order by color_index`,
    )
    .all(transcript.id) as SpeakerRow[];

  const segments = db
    .prepare(
      `select id, idx, start_ms, end_ms, speaker_id, text, confidence
         from transcript_segments where transcript_id = ? order by idx`,
    )
    .all(transcript.id) as SegmentRow[];

  return {
    languageCode: transcript.language_code,
    languageConfidence: transcript.language_confidence,
    provider: transcript.provider,
    modelVersion: transcript.model_version,
    wordCount: transcript.word_count,
    speakersIdentifiedAt: transcript.speakers_identified_at,
    speakers: speakers.map(toSpeaker),
    segments: segments.map((row): TranscriptSegment => ({
      id: row.id,
      idx: row.idx,
      startMs: row.start_ms,
      endMs: row.end_ms,
      speakerId: row.speaker_id,
      text: row.text,
      confidence: row.confidence,
    })),
  };
}

export function renameSpeaker(speakerId: string, displayName: string | null): boolean {
  const result = getDb()
    .prepare("update speakers set display_name = ?, identified_by = 'user' where id = ?")
    .run(displayName, speakerId);
  return result.changes > 0;
}

/**
 * Aplica los nombres que dedujo el modelo.
 *
 * Nunca pisa un nombre puesto por una persona: si alguien ya corrigió a mano, esa decisión
 * gana sobre la del modelo aunque se vuelva a analizar.
 */
export function applyIdentifiedSpeakers(
  transcriptId: string,
  identified: ReadonlyArray<{
    label: string;
    displayName: string | null;
    role: string | null;
    suggestedName: string | null;
    evidenceMs: number | null;
    confidence: string | null;
  }>,
): void {
  const db = getDb();
  const statement = db.prepare(
    `update speakers
        set display_name = coalesce(?, display_name),
            role = coalesce(?, role),
            suggested_name = ?,
            suggestion_evidence_ms = ?,
            suggestion_confidence = ?,
            identified_by = case when identified_by = 'user' then 'user' else 'model' end
      where transcript_id = ? and label = ? and coalesce(identified_by, '') <> 'user'`,
  );

  db.transaction(() => {
    for (const speaker of identified) {
      statement.run(
        speaker.displayName,
        speaker.role,
        speaker.suggestedName,
        speaker.evidenceMs,
        speaker.confidence,
        transcriptId,
        speaker.label,
      );
    }

    // La marca va dentro de la misma transacción: o consta que la identificación se hizo y
    // están sus resultados, o no consta ninguna de las dos cosas.
    db.prepare("update transcripts set speakers_identified_at = datetime('now') where id = ?").run(
      transcriptId,
    );
  })();
}

export function applySpeakerSuggestion(input: {
  transcriptId: string;
  label: string;
  suggestedName: string;
  evidenceMs: number;
  confidence: string;
}): void {
  getDb()
    .prepare(
      `update speakers
          set suggested_name = ?, suggestion_evidence_ms = ?, suggestion_confidence = ?
        where transcript_id = ? and label = ?`,
    )
    .run(input.suggestedName, input.evidenceMs, input.confidence, input.transcriptId, input.label);
}

export function getTranscriptId(assetId: string): string | null {
  const row = getDb()
    .prepare('select id from transcripts where media_asset_id = ?')
    .get(assetId) as { id: string } | undefined;
  return row?.id ?? null;
}

// --- Resúmenes ---------------------------------------------------------------

export type ClaimInput = {
  kind: ClaimKind;
  text: string;
  ownerSpeakerLabel: string | null;
  citationsMs: number[];
};

export type SummaryInput = {
  headline: string;
  overview: string[];
  model: string;
  /** Temas en orden cronológico, cada uno con sus puntos clave. */
  topics: Array<{
    title: string;
    startMs: number;
    endMs: number;
    points: Array<Omit<ClaimInput, 'kind'>>;
  }>;
  decisions: Array<Omit<ClaimInput, 'kind'>>;
  actionItems: Array<Omit<ClaimInput, 'kind'>>;
};

/**
 * Guarda el resumen resolviendo cada cita contra un segmento real del transcript.
 *
 * Una afirmación sin ninguna cita válida **se descarta**. Es la regla que convierte
 * "resumen con referencias temporales" en una propiedad del sistema en vez de una promesa:
 * si el modelo inventa una marca de tiempo, no hay segmento que la respalde y la frase no
 * llega a la base de datos.
 *
 * Devuelve cuántas afirmaciones se guardaron y cuántas se descartaron, para poder vigilar
 * la calidad del prompt.
 */
export function saveSummary(
  assetId: string,
  input: SummaryInput,
): { saved: number; discarded: number } {
  const db = getDb();
  const transcriptId = getTranscriptId(assetId);
  if (transcriptId === null) throw new Error('No hay transcript sobre el que anclar el resumen.');

  const segmentRows = db
    .prepare(
      'select id, start_ms, end_ms from transcript_segments where transcript_id = ? order by start_ms',
    )
    .all(transcriptId) as Array<{ id: string; start_ms: number; end_ms: number }>;
  const segments = segmentRows.map((row) => ({
    id: row.id,
    startMs: row.start_ms,
    endMs: row.end_ms,
  }));

  const speakerIdByLabel = new Map(
    (
      db
        .prepare('select id, label from speakers where transcript_id = ?')
        .all(transcriptId) as Array<{
        id: string;
        label: string;
      }>
    ).map((row) => [row.label, row.id]),
  );

  let saved = 0;
  let discarded = 0;

  db.transaction(() => {
    db.prepare('delete from summaries where media_asset_id = ?').run(assetId);

    const summaryId = randomUUID();
    db.prepare(
      `insert into summaries (id, media_asset_id, headline, overview, model, prompt_stamp)
       values (?, ?, ?, ?, ?, ?)`,
    ).run(
      summaryId,
      assetId,
      input.headline,
      JSON.stringify(input.overview),
      input.model,
      ANALYSIS_PROMPT_STAMP,
    );

    const insertTopic = db.prepare(
      `insert into summary_topics (id, summary_id, title, start_ms, end_ms, order_idx)
       values (?, ?, ?, ?, ?, ?)`,
    );
    const insertClaim = db.prepare(
      `insert into summary_claims
         (id, summary_id, topic_id, kind, text, owner_speaker_id, order_idx)
       values (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertCitation = db.prepare(
      'insert into claim_citations (id, claim_id, segment_id, start_ms) values (?, ?, ?, ?)',
    );

    /**
     * Guarda una afirmación sólo si al menos una de sus citas cae en un segmento real.
     *
     * Es la regla que hace verificable el resumen: si el modelo inventa una marca de tiempo,
     * no hay nada que la respalde y la frase no llega a la base de datos.
     */
    const persistClaim = (
      claim: Omit<ClaimInput, 'kind'>,
      kind: ClaimKind,
      topicId: string | null,
      orderIdx: number,
    ): void => {
      const resolved = claim.citationsMs
        .map((startMs) => findSegmentAt(segments, startMs))
        .filter((segment) => segment !== null);

      if (resolved.length === 0) {
        discarded++;
        return;
      }

      const claimId = randomUUID();
      insertClaim.run(
        claimId,
        summaryId,
        topicId,
        kind,
        claim.text,
        claim.ownerSpeakerLabel === null
          ? null
          : (speakerIdByLabel.get(claim.ownerSpeakerLabel) ?? null),
        orderIdx,
      );

      for (const segment of resolved) {
        insertCitation.run(randomUUID(), claimId, segment.id, segment.startMs);
      }
      saved++;
    };

    input.topics.forEach((topic, topicIndex) => {
      const topicId = randomUUID();
      insertTopic.run(topicId, summaryId, topic.title, topic.startMs, topic.endMs, topicIndex);
      topic.points.forEach((point, pointIndex) => {
        persistClaim(point, 'key_point', topicId, pointIndex);
      });
    });

    // Decisiones y tareas son secciones propias, no cuelgan de ningún tema.
    input.decisions.forEach((claim, index) => persistClaim(claim, 'decision', null, index));
    input.actionItems.forEach((claim, index) => persistClaim(claim, 'action_item', null, index));
  })();

  return { saved, discarded };
}

export function getSummary(assetId: string): Summary | null {
  const db = getDb();
  const summary = db
    .prepare(
      'select id, headline, overview, model, prompt_stamp from summaries where media_asset_id = ?',
    )
    .get(assetId) as
    | { id: string; headline: string; overview: string; model: string; prompt_stamp: string }
    | undefined;

  if (summary === undefined) return null;

  const claims = db
    .prepare(
      `select id, topic_id, kind, text, owner_speaker_id from summary_claims
        where summary_id = ? order by order_idx`,
    )
    .all(summary.id) as Array<{
    id: string;
    topic_id: string | null;
    kind: ClaimKind;
    text: string;
    owner_speaker_id: string | null;
  }>;

  const citations = db
    .prepare(
      `select c.claim_id, c.segment_id, c.start_ms from claim_citations c
         join summary_claims s on s.id = c.claim_id
        where s.summary_id = ? order by c.start_ms`,
    )
    .all(summary.id) as Array<{ claim_id: string; segment_id: string; start_ms: number }>;

  const citationsByClaim = new Map<string, Array<{ segmentId: string; startMs: number }>>();
  for (const citation of citations) {
    const list = citationsByClaim.get(citation.claim_id) ?? [];
    list.push({ segmentId: citation.segment_id, startMs: citation.start_ms });
    citationsByClaim.set(citation.claim_id, list);
  }

  const toClaim = (claim: (typeof claims)[number]): SummaryClaim => ({
    id: claim.id,
    kind: claim.kind,
    text: claim.text,
    ownerSpeakerId: claim.owner_speaker_id,
    citations: citationsByClaim.get(claim.id) ?? [],
  });

  const topicRows = db
    .prepare(
      `select id, title, start_ms, end_ms from summary_topics
        where summary_id = ? order by order_idx`,
    )
    .all(summary.id) as Array<{ id: string; title: string; start_ms: number; end_ms: number }>;

  const topics: Topic[] = topicRows.map((row) => ({
    id: row.id,
    title: row.title,
    startMs: row.start_ms,
    endMs: row.end_ms,
    claims: claims.filter((claim) => claim.topic_id === row.id).map(toClaim),
  }));

  return {
    headline: summary.headline,
    overview: JSON.parse(summary.overview) as string[],
    topics,
    decisions: claims.filter((claim) => claim.kind === 'decision').map(toClaim),
    actionItems: claims.filter((claim) => claim.kind === 'action_item').map(toClaim),
    model: summary.model,
    promptStamp: summary.prompt_stamp,
  };
}

// --- Consumo -----------------------------------------------------------------

/**
 * Registra lo que costó una fase del análisis.
 *
 * Se llama después de cada llamada a un proveedor, aunque el análisis falle más adelante: los
 * tokens ya se gastaron, y un coste que no se apunta es un coste que nunca se entiende.
 */
export function recordUsage(assetId: string, phase: string, usage: TokenUsage): void {
  getDb()
    .prepare(
      `insert into analysis_usage
         (id, media_asset_id, phase, provider, model, input_tokens, cached_tokens,
          output_tokens, cost_micros)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      assetId,
      phase,
      usage.provider,
      usage.model,
      usage.inputTokens,
      usage.cachedInputTokens,
      usage.outputTokens,
      estimateCostMicros(usage),
    );
}

export type UsageRow = {
  phase: string;
  provider: string;
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costMicros: number;
};

export function getUsage(assetId: string): UsageRow[] {
  const rows = getDb()
    .prepare(
      `select phase, provider, model, input_tokens, cached_tokens, output_tokens, cost_micros
         from analysis_usage where media_asset_id = ? order by created_at`,
    )
    .all(assetId) as Array<{
    phase: string;
    provider: string;
    model: string;
    input_tokens: number;
    cached_tokens: number;
    output_tokens: number;
    cost_micros: number;
  }>;

  return rows.map((row) => ({
    phase: row.phase,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    cachedTokens: row.cached_tokens,
    outputTokens: row.output_tokens,
    costMicros: row.cost_micros,
  }));
}
