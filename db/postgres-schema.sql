-- Empire Financial / The Agent Forge — PostgreSQL (Supabase) schema.
-- Mirrors the SQLite schema in server.js column-for-column so rows copy across unchanged:
--   * Text IDs and ISO-8601 timestamps stay TEXT (the app compares and parses them as strings).
--   * 0/1 flags stay INTEGER (the app reads them as numbers).
--   * Epoch-millisecond values use BIGINT because they overflow 32-bit INTEGER.
-- No foreign keys: the SQLite schema has none and the app deletes related rows manually.
-- Safe to run repeatedly (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  needs_setup INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  initials TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'blue',
  stage_id TEXT NOT NULL,
  started TEXT NOT NULL,
  production DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_done_tasks (
  agent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, task_id)
);

CREATE TABLE IF NOT EXISTS agent_stage_history (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  entered_at TEXT NOT NULL,
  exited_at TEXT,
  duration_ms BIGINT
);

CREATE TABLE IF NOT EXISTS owner_notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  idx INTEGER NOT NULL,
  label TEXT NOT NULL,
  short TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  timeframe INTEGER NOT NULL DEFAULT 30,
  threshold DOUBLE PRECISION,
  reward TEXT NOT NULL DEFAULT '',
  resource_url TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  loom_url TEXT NOT NULL DEFAULT '',
  required INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS recruits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'interested',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bootcamp_modules (
  id TEXT PRIMARY KEY,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

-- video_storage_key / video_mime_type exist in the live SQLite data from an earlier version of the app.
-- The current code does not read them; they are kept so no existing data is dropped.
CREATE TABLE IF NOT EXISTS bootcamp_lessons (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'requirement',
  instructions TEXT NOT NULL DEFAULT '',
  resource_url TEXT NOT NULL DEFAULT '',
  required INTEGER NOT NULL DEFAULT 1,
  video_url TEXT NOT NULL DEFAULT '',
  resource_required INTEGER NOT NULL DEFAULT 0,
  contract_url TEXT NOT NULL DEFAULT '',
  contract_required INTEGER NOT NULL DEFAULT 0,
  video_storage_key TEXT NOT NULL DEFAULT '',
  video_mime_type TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS bootcamp_completions (
  agent_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS bootcamp_video_watches (
  agent_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  watched_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS bootcamp_video_progress (
  agent_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  watched_ranges TEXT NOT NULL DEFAULT '[]',
  duration_seconds DOUBLE PRECISION,
  last_position DOUBLE PRECISION NOT NULL DEFAULT 0,
  checkpoint_at BIGINT NOT NULL,
  last_playing INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS bootcamp_resource_completions (
  agent_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS bootcamp_contract_completions (
  agent_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS bootcamp_extra_topics (
  id TEXT PRIMARY KEY,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS bootcamp_extra_links (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL
);

-- Lookup indexes for the app's common queries.
CREATE INDEX IF NOT EXISTS sessions_account_id_idx ON sessions (account_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS agent_stage_history_agent_id_idx ON agent_stage_history (agent_id);
CREATE INDEX IF NOT EXISTS owner_notifications_agent_id_idx ON owner_notifications (agent_id);
CREATE INDEX IF NOT EXISTS tasks_stage_id_idx ON tasks (stage_id, idx);
CREATE INDEX IF NOT EXISTS bootcamp_lessons_module_id_idx ON bootcamp_lessons (module_id, idx);
CREATE INDEX IF NOT EXISTS bootcamp_extra_links_topic_id_idx ON bootcamp_extra_links (topic_id, idx);

-- Supabase exposes every public table through its REST API using the public anon key.
-- Enabling row level security with NO policies blocks that API from reading password hashes and
-- sessions. The server connects through DATABASE_URL as a privileged role, which bypasses RLS,
-- so the app itself is unaffected.
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_done_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruits ENABLE ROW LEVEL SECURITY;
ALTER TABLE bootcamp_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE bootcamp_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE bootcamp_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bootcamp_video_watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bootcamp_video_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE bootcamp_resource_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bootcamp_contract_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bootcamp_extra_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE bootcamp_extra_links ENABLE ROW LEVEL SECURITY;
