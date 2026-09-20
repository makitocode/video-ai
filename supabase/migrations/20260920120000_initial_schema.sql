-- ============================================================================
-- Esquema inicial de video-ai
--
-- Principios (doc/07-modelo-de-datos.md):
--   1. El estado del pipeline vive en Postgres: un job es una fila.
--   2. RLS activo en TODAS las tablas. Una tabla sin política es un bug de
--      seguridad, no un descuido de configuración.
--   3. Los tiempos del medio son enteros en milisegundos, nunca segundos en
--      coma flotante: evita errores de redondeo al sincronizar con el reproductor.
-- ============================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- Enumerados
-- --------------------------------------------------------------------------

-- Ruta de ingesta elegida por el navegador (doc/02, § La ruta de escape).
create type ingest_route as enum ('fast', 'escape');

-- Estados del pipeline (doc/03, § Máquina de estados del job).
create type job_state as enum (
  'created',
  'probing',
  'extracting',
  'uploading_audio',
  'uploading_source',
  'transcribing',
  'summarizing',
  'ready',
  'failed_transcription',
  'failed_summary'
);

-- Los tres carriles de subida, más la forma de onda precalculada.
create type media_file_kind as enum ('audio', 'proxy', 'master', 'waveform');

create type upload_state as enum ('pending', 'uploading', 'complete', 'failed');

create type claim_kind as enum ('key_point', 'decision', 'action_item');

create type usage_kind as enum ('asr_minutes', 'llm_tokens', 'storage_bytes', 'egress_bytes');

-- --------------------------------------------------------------------------
-- profiles — extiende auth.users
-- --------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

comment on table profiles is 'Datos de aplicación del usuario. La identidad vive en auth.users.';

-- Crea el perfil automáticamente al registrarse, para que nunca falte.
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- --------------------------------------------------------------------------
-- media_assets — la unidad de producto: "un video analizado"
-- --------------------------------------------------------------------------

create table media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  original_filename text not null,
  size_bytes bigint not null check (size_bytes > 0),
  duration_ms integer check (duration_ms is null or duration_ms > 0),
  container text,
  -- Hash de muestreo del contenido: permite reutilizar un análisis ya pagado
  -- si se vuelve a subir el mismo archivo.
  content_hash text,
  ingest_route ingest_route not null default 'fast',
  created_at timestamptz not null default now(),
  -- Borrado lógico: revoca el acceso de inmediato vía RLS; la purga física
  -- la hace un pg_cron nocturno.
  deleted_at timestamptz
);

create index media_assets_owner_recent_idx
  on media_assets (owner_id, created_at desc)
  where deleted_at is null;

create unique index media_assets_dedup_idx
  on media_assets (owner_id, content_hash)
  where content_hash is not null and deleted_at is null;

-- --------------------------------------------------------------------------
-- media_files — los tres carriles, con ciclo de vida independiente
-- --------------------------------------------------------------------------

create table media_files (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references media_assets (id) on delete cascade,
  kind media_file_kind not null,
  storage_path text not null,
  size_bytes bigint,
  bytes_uploaded bigint not null default 0,
  upload_state upload_state not null default 'pending',
  codec text,
  -- Retención propia por carril: el master es lo caro y lo menos necesario.
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (media_asset_id, kind)
);

-- --------------------------------------------------------------------------
-- jobs — el estado del pipeline
-- --------------------------------------------------------------------------

create table jobs (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null unique references media_assets (id) on delete cascade,
  state job_state not null default 'created',
  provider text,
  provider_job_id text,
  -- Secreto aleatorio por job, incrustado en la URL del webhook. Segunda barrera
  -- además de la verificación de firma (doc/08, § T4).
  webhook_token text not null default encode(gen_random_bytes(32), 'hex'),
  attempts integer not null default 0,
  last_error text,
  state_changed_at timestamptz not null default now(),
  -- Lo usa el barrido de pg_cron para detectar jobs estancados cuando el
  -- webhook del proveedor se pierde.
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index jobs_stalled_idx on jobs (state, heartbeat_at)
  where state in ('transcribing', 'summarizing');

create index jobs_provider_lookup_idx on jobs (provider, provider_job_id)
  where provider_job_id is not null;

-- Mantiene state_changed_at fiable sin depender de que lo escriba la aplicación.
create function touch_job_state()
returns trigger
language plpgsql
as $$
begin
  if new.state is distinct from old.state then
    new.state_changed_at = now();
  end if;
  new.heartbeat_at = now();
  return new;
end;
$$;

create trigger jobs_touch_state
  before update on jobs
  for each row execute function touch_job_state();

-- --------------------------------------------------------------------------
-- transcripts, speakers, transcript_segments
-- --------------------------------------------------------------------------

create table transcripts (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null unique references media_assets (id) on delete cascade,
  language_code text not null,
  language_confidence real,
  provider text not null,
  -- Cuando el proveedor mejora el modelo hay que saber qué transcripts se
  -- generaron con cuál.
  model_version text,
  word_count integer,
  created_at timestamptz not null default now()
);

create table speakers (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references transcripts (id) on delete cascade,
  -- Etiqueta del proveedor ("Speaker A"). Estable, nunca se edita.
  label text not null,
  -- Nombre que puso el usuario. Separarlo de `label` permite renombrar
  -- actualizando UNA fila en vez de miles de segmentos.
  display_name text,
  suggested_name text,
  suggestion_evidence_ms integer,
  suggestion_confidence text check (
    suggestion_confidence is null or suggestion_confidence in ('high', 'medium', 'low')
  ),
  color_index smallint not null default 0,
  total_speaking_ms integer not null default 0,
  unique (transcript_id, label)
);

create table transcript_segments (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references transcripts (id) on delete cascade,
  idx integer not null,
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null,
  speaker_id uuid references speakers (id) on delete set null,
  text text not null,
  confidence real,
  -- Los timestamps por palabra se leen siempre junto al segmento y nunca se
  -- consultan por separado, así que van como jsonb en vez de como tabla.
  words jsonb,
  unique (transcript_id, idx),
  check (end_ms >= start_ms)
);

-- Salto temporal desde el reproductor y desde las citas del resumen.
create index transcript_segments_timeline_idx on transcript_segments (transcript_id, start_ms);

-- Búsqueda de texto. Se usa la configuración 'simple' a propósito: el idioma
-- varía por transcript y 'simple' es agnóstica al idioma.
create index transcript_segments_search_idx
  on transcript_segments using gin (to_tsvector('simple', text));

-- --------------------------------------------------------------------------
-- summaries — un grafo de afirmaciones citadas, no un blob de texto
-- --------------------------------------------------------------------------

create table summaries (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null unique references media_assets (id) on delete cascade,
  headline text not null,
  abstract text not null,
  chapters jsonb not null default '[]'::jsonb,
  model text not null,
  created_at timestamptz not null default now()
);

create table summary_claims (
  id uuid primary key default gen_random_uuid(),
  summary_id uuid not null references summaries (id) on delete cascade,
  kind claim_kind not null,
  text text not null,
  owner_speaker_id uuid references speakers (id) on delete set null,
  order_idx integer not null
);

create index summary_claims_order_idx on summary_claims (summary_id, kind, order_idx);

-- Esta tabla es el mecanismo de integridad del producto: una cita NO PUEDE
-- existir si no apunta a un segmento real del transcript. Si el LLM inventa un
-- timestamp, el INSERT falla y la afirmación se descarta. La promesa de
-- "resumen con referencias verificables" la hace cumplir la base de datos.
create table claim_citations (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references summary_claims (id) on delete cascade,
  segment_id uuid not null references transcript_segments (id) on delete cascade,
  start_ms integer not null
);

create index claim_citations_claim_idx on claim_citations (claim_id);

-- --------------------------------------------------------------------------
-- usage_ledger — registro append-only del consumo real
-- --------------------------------------------------------------------------

create table usage_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  media_asset_id uuid references media_assets (id) on delete set null,
  kind usage_kind not null,
  quantity numeric not null,
  -- Millonésimas de dólar: evita los errores de redondeo de los flotantes.
  cost_micros bigint not null default 0,
  occurred_at timestamptz not null default now()
);

create index usage_ledger_owner_idx on usage_ledger (owner_id, occurred_at desc);

-- ============================================================================
-- Row Level Security
--
-- Se activa en todas las tablas y se deniega por defecto. Las tablas hijas
-- derivan la pertenencia de media_assets mediante EXISTS, de modo que hay un
-- único sitio donde se define quién posee qué.
-- ============================================================================

alter table profiles             enable row level security;
alter table media_assets         enable row level security;
alter table media_files          enable row level security;
alter table jobs                 enable row level security;
alter table transcripts          enable row level security;
alter table speakers             enable row level security;
alter table transcript_segments  enable row level security;
alter table summaries            enable row level security;
alter table summary_claims       enable row level security;
alter table claim_citations      enable row level security;
alter table usage_ledger         enable row level security;

-- Predicado único de pertenencia: todo lo demás se apoya en esta función.
create function owns_media_asset(asset_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from media_assets
    where id = asset_id
      and owner_id = (select auth.uid())
      and deleted_at is null
  );
$$;

create function owns_transcript(transcript_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from transcripts t
    where t.id = transcript_id
      and owns_media_asset(t.media_asset_id)
  );
$$;

create policy "perfil propio" on profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "assets propios" on media_assets
  for all to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is null)
  with check (owner_id = (select auth.uid()));

create policy "archivos de assets propios" on media_files
  for all to authenticated
  using (owns_media_asset(media_asset_id))
  with check (owns_media_asset(media_asset_id));

create policy "jobs de assets propios" on jobs
  for all to authenticated
  using (owns_media_asset(media_asset_id))
  with check (owns_media_asset(media_asset_id));

create policy "transcripts de assets propios" on transcripts
  for all to authenticated
  using (owns_media_asset(media_asset_id))
  with check (owns_media_asset(media_asset_id));

create policy "hablantes de transcripts propios" on speakers
  for all to authenticated
  using (owns_transcript(transcript_id))
  with check (owns_transcript(transcript_id));

create policy "segmentos de transcripts propios" on transcript_segments
  for all to authenticated
  using (owns_transcript(transcript_id))
  with check (owns_transcript(transcript_id));

create policy "resumenes de assets propios" on summaries
  for all to authenticated
  using (owns_media_asset(media_asset_id))
  with check (owns_media_asset(media_asset_id));

create policy "afirmaciones de resumenes propios" on summary_claims
  for all to authenticated
  using (exists (
    select 1 from summaries s
    where s.id = summary_id and owns_media_asset(s.media_asset_id)
  ))
  with check (exists (
    select 1 from summaries s
    where s.id = summary_id and owns_media_asset(s.media_asset_id)
  ));

create policy "citas de afirmaciones propias" on claim_citations
  for all to authenticated
  using (exists (
    select 1 from summary_claims c
    join summaries s on s.id = c.summary_id
    where c.id = claim_id and owns_media_asset(s.media_asset_id)
  ))
  with check (exists (
    select 1 from summary_claims c
    join summaries s on s.id = c.summary_id
    where c.id = claim_id and owns_media_asset(s.media_asset_id)
  ));

-- El consumo es de sólo lectura para el usuario: lo escriben las Edge Functions
-- con service_role, que no pasa por RLS.
create policy "consumo propio, sólo lectura" on usage_ledger
  for select to authenticated
  using (owner_id = (select auth.uid()));
