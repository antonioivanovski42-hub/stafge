#!/usr/bin/env node
// One-time, read-only-on-the-source migration: SQLite (data/agentforge.db) -> PostgreSQL (DATABASE_URL).
//
//   npm run migrate:postgres                 dry run: reports what WOULD happen, writes nothing
//   npm run migrate:postgres -- --execute    performs the migration
//
// Safety guarantees:
//   * The SQLite file is opened read-only and its SHA-256 is compared before/after.
//   * Everything runs in ONE PostgreSQL transaction; any error or verification mismatch rolls back.
//   * It refuses to run if any target table already contains rows (one-time, never overwrites).
//   * DATABASE_URL is read from the environment (or a git-ignored .env file) and is never printed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const execute = args.includes('--execute');
const sqliteArg = args.find(arg => arg.startsWith('--sqlite='));
const SQLITE_PATH = path.resolve(sqliteArg ? sqliteArg.slice('--sqlite='.length) : path.join(ROOT, 'data', 'agentforge.db'));

if (args.includes('--help')) {
  console.log('Usage: npm run migrate:postgres -- [--execute] [--sqlite=path/to/agentforge.db]\nWithout --execute this is a dry run that writes nothing.');
  process.exit(0);
}

// Allow a local, git-ignored .env to supply DATABASE_URL; a real environment variable always wins.
const envFile = path.join(ROOT, '.env');
if (!process.env.DATABASE_URL && fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { TABLES, createPool, applySchema, describeTarget, databaseUrl } = require('../db/postgres');

const fileHash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const quote = identifier => `"${identifier.replace(/"/g, '""')}"`;
const normalise = value => (value === null || value === undefined ? null : String(value));
const fingerprint = rows => {
  const hashes = rows.map(row => crypto.createHash('sha256').update(JSON.stringify(row.map(normalise))).digest('hex')).sort();
  return crypto.createHash('sha256').update(hashes.join('')).digest('hex');
};
const fail = message => { throw new Error(message); };

async function main() {
  console.log(execute ? 'MODE: EXECUTE (writes to PostgreSQL)' : 'MODE: DRY RUN (nothing is written)');
  if (!fs.existsSync(SQLITE_PATH)) fail(`SQLite database not found at ${SQLITE_PATH}`);
  const sourceHashBefore = fileHash(SQLITE_PATH);
  const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });

  // ---- Inspect the source ----
  const sourceTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
  const unknown = sourceTables.filter(name => !TABLES.includes(name));
  if (unknown.length) fail(`SQLite contains tables with no PostgreSQL equivalent, refusing to drop their data: ${unknown.join(', ')}`);
  const source = {};
  for (const table of TABLES) {
    if (!sourceTables.includes(table)) { console.warn(`  note: SQLite has no "${table}" table; treated as empty.`); source[table] = { columns: [], rows: [] }; continue; }
    const columns = sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all().map(column => column.name);
    const rows = sqlite.prepare(`SELECT ${columns.map(quote).join(', ')} FROM ${quote(table)}`).all().map(row => columns.map(column => row[column]));
    source[table] = { columns, rows };
  }
  console.log(`\nSource: ${SQLITE_PATH}`);
  for (const table of TABLES) console.log(`  ${table.padEnd(32)} ${String(source[table].rows.length).padStart(6)} rows`);

  // ---- Connect to the target ----
  let url;
  try { url = databaseUrl(); } catch (error) { if (execute) throw error; console.log(`\n${error.message}\nDry run can only validate the SQLite side without it.`); process.exitCode = 1; sqlite.close(); return; }
  console.log(`\nTarget: ${describeTarget(url)}`);
  const pool = createPool(url);
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    await client.query('BEGIN');
    // Dry runs apply the schema too, but inside a transaction that is always rolled back.
    await applySchema(client);

    // The target must match the source columns and be empty.
    for (const table of TABLES) {
      const targetColumns = (await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [table])).rows.map(row => row.column_name);
      const missing = source[table].columns.filter(column => !targetColumns.includes(column));
      if (missing.length) fail(`PostgreSQL table "${table}" is missing column(s): ${missing.join(', ')}`);
      const existing = Number((await client.query(`SELECT COUNT(*) AS count FROM ${quote(table)}`)).rows[0].count);
      if (existing > 0) fail(`Target table "${table}" already contains ${existing} row(s). This is a one-time migration and will not overwrite existing data.`);
    }
    console.log('Target schema is ready and every table is empty.');

    // ---- Copy ----
    for (const table of TABLES) {
      const { columns, rows } = source[table];
      if (!rows.length) continue;
      const chunkSize = Math.max(1, Math.min(500, Math.floor(60000 / columns.length)));
      for (let start = 0; start < rows.length; start += chunkSize) {
        const chunk = rows.slice(start, start + chunkSize);
        const placeholders = chunk.map((_, rowIndex) => `(${columns.map((__, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(', ')})`).join(', ');
        await client.query(`INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES ${placeholders}`, chunk.flat());
      }
    }

    // ---- Verify: counts and a content fingerprint of every row, per table ----
    console.log('\nVerification (source vs PostgreSQL):');
    for (const table of TABLES) {
      const { columns, rows } = source[table];
      const copied = columns.length
        ? (await client.query({ text: `SELECT ${columns.map(quote).join(', ')} FROM ${quote(table)}`, rowMode: 'array' })).rows
        : [];
      const same = copied.length === rows.length && fingerprint(copied) === fingerprint(rows);
      console.log(`  ${same ? 'OK  ' : 'FAIL'} ${table.padEnd(32)} ${rows.length} -> ${copied.length}`);
      if (!same) fail(`Verification failed for "${table}". Rolling back; nothing was written.`);
    }

    if (execute) { await client.query('COMMIT'); console.log('\nMigration COMMITTED.'); }
    else { await client.query('ROLLBACK'); console.log('\nDry run complete: all checks passed and everything was rolled back. Nothing was written.'); }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }

  const sourceHashAfter = fileHash(SQLITE_PATH);
  console.log(`SQLite source file unchanged: ${sourceHashBefore === sourceHashAfter ? 'yes' : 'NO — investigate immediately'}`);
}

main().catch(error => { console.error(`\nMigration aborted: ${error.message}`); process.exit(1); });
