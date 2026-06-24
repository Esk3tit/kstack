// no-mistakes-backend harness: bounded poll of the Neon DB for an async-flagged case
// (§6) — re-runs a verify query on a fixed interval until it returns >= N rows or the
// timeout elapses. For endpoints whose real effect lands later via a Hatchet workflow.
//
// The connection string is read from the env (NMB_DATABASE_URL) — NEVER from argv (it
// is a secret + shows in `ps`). Get it from Neon MCP `get_connection_string` for the
// resolved branch, export it, then run this. It uses `psql` (libpq); if psql is not on
// PATH it exits 3 so the caller falls back to the agent-driven Neon MCP run_sql loop.
//
// Usage:
//   export NMB_DATABASE_URL="postgres://…"   # from Neon MCP get_connection_string
//   node poll-until.mjs --sql-file verify.sql [--sql 'SELECT …'] \
//     [--expect-rows 1] [--timeout 60] [--interval 3]
//
// Exit: 0 = condition met (prints the final rows + POLL_OK)
//       2 = timeout      (prints the last rows + POLL_TIMEOUT)
//       3 = psql unavailable (caller should poll via Neon MCP run_sql instead)
//       1 = usage/transport error
// The connection string is NEVER echoed.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
}
function die(msg, code = 1) { console.error(`[poll-until] ${msg}`); process.exit(code); }

const conn = process.env.NMB_DATABASE_URL || '';
if (!conn) die('missing NMB_DATABASE_URL (export it from Neon MCP get_connection_string)');

const sqlFile = opt('sql-file');
const sqlArg = opt('sql');
const sql = sqlFile ? readFileSync(sqlFile, 'utf8') : sqlArg;
if (!sql) die('required: --sql-file <file> or --sql "<query>"');

const expectRows = Number(opt('expect-rows', '1'));
const timeoutS = Number(opt('timeout', '60'));
const intervalS = Number(opt('interval', '3'));

function havePsql() {
  try { execFileSync('psql', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] }); return true; }
  catch { return false; }
}
if (!havePsql()) die('psql not found on PATH — fall back to the Neon MCP run_sql bounded loop', 3);

// Keep the password out of argv (visible to `ps` and echoed in execFileSync error
// messages) — move it to PGPASSWORD; psql reads the rest of the URI from a sanitized,
// secret-free arg.
let connArg = conn;
const psqlEnv = { ...process.env };
try {
  const u = new URL(conn);
  if (u.password) {
    psqlEnv.PGPASSWORD = decodeURIComponent(u.password);
    u.password = '';
    connArg = u.toString();
  }
} catch { /* non-URI conninfo string — pass through unchanged */ }

// Run the query with tuples-only / unaligned output; each returned row is one line.
function runQuery() {
  const out = execFileSync('psql', [connArg, '-t', '-A', '-X', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: psqlEnv });
  const rows = out.split('\n').filter((l) => l.trim() !== '');
  return rows;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + timeoutS * 1000;
let last = [];
let attempts = 0;

while (Date.now() <= deadline) {
  attempts++;
  try { last = runQuery(); }
  catch (e) { console.error(`[poll-until] query error (attempt ${attempts}): ${(e.message || '').split('\n')[0]}`); }
  if (last.length >= expectRows) {
    process.stdout.write(last.join('\n') + '\n');
    console.log(`POLL_OK rows=${last.length} attempts=${attempts}`);
    process.exit(0);
  }
  if (Date.now() + intervalS * 1000 > deadline) break;
  await sleep(intervalS * 1000);
}

if (last.length) process.stdout.write(last.join('\n') + '\n');
console.log(`POLL_TIMEOUT rows=${last.length} expected=${expectRows} attempts=${attempts} timeout=${timeoutS}s`);
process.exit(2);
