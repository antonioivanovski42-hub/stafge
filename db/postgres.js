// PostgreSQL (Supabase) connection support. The connection string is read ONLY from the
// DATABASE_URL environment variable — nothing here is, or may be, hardcoded.
// The live app (server.js) does not use this module yet; it is used by the migration script.
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const SCHEMA_PATH = path.join(__dirname, 'postgres-schema.sql');

// Every application table, parents first.
const TABLES = [
  'accounts', 'sessions', 'agents', 'agent_done_tasks', 'agent_stage_history', 'owner_notifications',
  'stages', 'tasks', 'recruits',
  'bootcamp_modules', 'bootcamp_lessons', 'bootcamp_completions', 'bootcamp_video_watches',
  'bootcamp_video_progress', 'bootcamp_resource_completions', 'bootcamp_contract_completions',
  'bootcamp_extra_topics', 'bootcamp_extra_links'
];

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url || !url.trim()) throw new Error('DATABASE_URL is not set. Provide it as an environment variable (see .env.example).');
  return url.trim();
}

// Host/port/database only — never the user or password.
function describeTarget(url = databaseUrl()) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}${parsed.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

function poolConfig(url = databaseUrl()) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('DATABASE_URL is not a valid connection string.'); }
  // Take TLS control away from the URL's sslmode so behaviour is explicit and identical everywhere.
  parsed.searchParams.delete('sslmode');
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  let ssl;
  if (process.env.DATABASE_SSL === 'disable' || local) ssl = false;
  else if (process.env.DATABASE_SSL_CA) ssl = { ca: fs.readFileSync(process.env.DATABASE_SSL_CA, 'utf8'), rejectUnauthorized: true };
  // Supabase's server certificate is signed by its own CA, which Node does not trust by default.
  // Traffic is still encrypted; set DATABASE_SSL_CA to the downloaded Supabase CA to also verify the server.
  else ssl = { rejectUnauthorized: false };
  return { connectionString: parsed.toString(), ssl, max: Number(process.env.DATABASE_POOL_MAX) || 5 };
}

function createPool(url) { return new Pool(poolConfig(url)); }

async function applySchema(client) {
  await client.query(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

module.exports = { TABLES, SCHEMA_PATH, createPool, applySchema, describeTarget, databaseUrl };
