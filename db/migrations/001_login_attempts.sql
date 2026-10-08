-- Shared login rate-limit storage. NOT applied automatically: run once in the Supabase SQL editor.
-- Additive and reversible (DROP TABLE login_attempts). Until applied, the server logs a warning and does not rate limit.
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_start BIGINT NOT NULL,
  locked_until BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS login_attempts_window_start_idx ON login_attempts (window_start);
-- Same posture as the other tables: blocks the Supabase REST API; the server's privileged role is unaffected.
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
