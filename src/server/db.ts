import Database from 'better-sqlite3';
import { DATABASE_PATH, ensureDataDirs } from './config';

/**
 * Base de datos local (SQLite).
 *
 * Es el adaptador local del mismo puerto que en la nube ocupa Postgres. El esquema es
 * deliberadamente el mismo que el de `supabase/migrations/`, con dos diferencias:
 *
 * 1. **Sin RLS ni `owner_id`**: esta versión es monousuario. Al migrar a Supabase, las
 *    políticas vuelven y la forma de las tablas no cambia.
 * 2. **Tiempos del medio en enteros de milisegundos**, igual que en la nube: evita los
 *    errores de redondeo al sincronizar citas con el reproductor.
 */

const SCHEMA = `
pragma journal_mode = WAL;
pragma foreign_keys = on;

create table if not exists media_assets (
  id                text primary key,
  original_filename text    not null,
  size_bytes        integer not null,
  duration_ms       integer,
  container         text,
  ingest_route      text    not null default 'fast',
  created_at        text    not null default (datetime('now'))
);

create table if not exists media_files (
  id             text primary key,
  media_asset_id text    not null references media_assets(id) on delete cascade,
  kind           text    not null,
  storage_path   text    not null,
  size_bytes     integer,
  bytes_uploaded integer not null default 0,
  upload_state   text    not null default 'pending',
  content_type   text,
  created_at     text    not null default (datetime('now')),
  unique (media_asset_id, kind)
);

create table if not exists jobs (
  id               text primary key,
  media_asset_id   text    not null unique references media_assets(id) on delete cascade,
  state            text    not null default 'created',
  provider         text,
  provider_job_id  text,
  attempts         integer not null default 0,
  last_error       text,
  progress         real    not null default 0,
  state_changed_at text    not null default (datetime('now')),
  created_at       text    not null default (datetime('now'))
);

create table if not exists transcripts (
  id                  text primary key,
  media_asset_id      text not null unique references media_assets(id) on delete cascade,
  language_code       text not null,
  language_confidence real,
  provider            text not null,
  model_version       text,
  word_count          integer,
  created_at          text not null default (datetime('now'))
);

create table if not exists speakers (
  id                text primary key,
  transcript_id     text    not null references transcripts(id) on delete cascade,
  label             text    not null,
  display_name      text,
  suggested_name    text,
  suggestion_evidence_ms integer,
  suggestion_confidence  text,
  role              text,
  identified_by     text,
  color_index       integer not null default 0,
  total_speaking_ms integer not null default 0,
  unique (transcript_id, label)
);

create table if not exists transcript_segments (
  id            text primary key,
  transcript_id text    not null references transcripts(id) on delete cascade,
  idx           integer not null,
  start_ms      integer not null,
  end_ms        integer not null,
  speaker_id    text references speakers(id) on delete set null,
  text          text    not null,
  confidence    real,
  unique (transcript_id, idx)
);

create index if not exists transcript_segments_timeline
  on transcript_segments (transcript_id, start_ms);

create table if not exists summaries (
  id             text primary key,
  media_asset_id text not null unique references media_assets(id) on delete cascade,
  headline       text not null,
  overview       text not null default '[]',
  model          text not null,
  created_at     text not null default (datetime('now'))
);

-- Los puntos clave se agrupan por tema y los temas van en orden cronológico: es lo que
-- convierte una lista de frases sueltas en algo que se lee de arriba abajo.
create table if not exists summary_topics (
  id         text primary key,
  summary_id text    not null references summaries(id) on delete cascade,
  title      text    not null,
  start_ms   integer not null,
  end_ms     integer not null,
  order_idx  integer not null
);

create index if not exists summary_topics_order on summary_topics (summary_id, order_idx);

create table if not exists summary_claims (
  id               text primary key,
  summary_id       text    not null references summaries(id) on delete cascade,
  topic_id         text references summary_topics(id) on delete cascade,
  kind             text    not null,
  text             text    not null,
  owner_speaker_id text references speakers(id) on delete set null,
  order_idx        integer not null
);

-- La clave foránea a transcript_segments es el mecanismo de integridad del producto:
-- una cita no puede existir si no apunta a un segmento real. Si el modelo inventa un
-- timestamp, el INSERT falla y la afirmación se descarta.
create table if not exists claim_citations (
  id         text primary key,
  claim_id   text    not null references summary_claims(id) on delete cascade,
  segment_id text    not null references transcript_segments(id) on delete cascade,
  start_ms   integer not null
);

create index if not exists claim_citations_claim on claim_citations (claim_id);

-- Consumo real reportado por los proveedores, por fase.
--
-- Se guarda lo que el proveedor dice que gastó, no una estimación por conteo de palabras: los
-- tokenizadores cambian entre modelos y el razonamiento también consume sin aparecer en el
-- texto de salida. Es la única medición de coste que no se equivoca.
create table if not exists analysis_usage (
  id             text primary key,
  media_asset_id text    not null references media_assets(id) on delete cascade,
  phase          text    not null,
  provider       text    not null,
  model          text    not null,
  input_tokens   integer not null,
  cached_tokens  integer not null,
  output_tokens  integer not null,
  cost_micros    integer not null,
  created_at     text    not null default (datetime('now'))
);

create index if not exists analysis_usage_asset on analysis_usage (media_asset_id);
`;

let instance: Database.Database | null = null;

/**
 * Conexión única a la base de datos.
 *
 * Next.js recarga módulos en desarrollo, así que la instancia se guarda en `globalThis`:
 * sin eso, cada recarga abriría una conexión nueva y acabaríamos agotando descriptores.
 */
export function getDb(): Database.Database {
  if (instance !== null) return instance;

  const globalRef = globalThis as typeof globalThis & { __videoAiDb?: Database.Database };
  if (globalRef.__videoAiDb !== undefined) {
    instance = globalRef.__videoAiDb;
    return instance;
  }

  ensureDataDirs();
  const db = new Database(DATABASE_PATH);
  db.exec(SCHEMA);
  migrate(db);

  instance = db;
  globalRef.__videoAiDb = db;
  return db;
}

/**
 * Migraciones sobre bases de datos que ya existían.
 *
 * `create table if not exists` no añade columnas a una tabla ya creada, así que los campos
 * nuevos se agregan aquí. Importa de verdad: una transcripción de dos horas cuesta dinero y
 * media hora de espera, y tirar la base de datos para actualizar el esquema obligaría a
 * rehacerla.
 */
function migrate(db: Database.Database): void {
  const columns = [
    ['speakers', 'role', 'text'],
    ['speakers', 'identified_by', 'text'],
    ['summaries', 'overview', "text not null default '[]'"],
    ['summary_claims', 'topic_id', 'text'],
    // Con qué redacción de los prompts se produjo el resumen. Sin esto, comparar dos
    // resultados de la misma grabación es una opinión.
    ['summaries', 'prompt_stamp', "text not null default ''"],
    // Cuándo se identificó a los hablantes. Es una marca aparte y no se deduce de que algún
    // hablante tenga nombre: una identificación honesta puede terminar sin ponerle nombre a
    // nadie, y eso no es lo mismo que no haberla hecho nunca.
    ['transcripts', 'speakers_identified_at', 'text'],
  ] as const;

  for (const [table, column, definition] of columns) {
    // SQLite no tiene `add column if not exists`; se comprueba antes de intentarlo.
    const existing = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
    if (existing.some((row) => row.name === column)) continue;

    db.exec(`alter table ${table} add column ${column} ${definition}`);
  }
}
