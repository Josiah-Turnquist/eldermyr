/*
 * server/db.js — persistent heroes (Postgres) with a graceful ephemeral fallback.
 * =============================================================================
 * Identity model: "hero name + recovery code", NO passwords/email.
 *   - token         : a per-browser secret (stored in the player's localStorage).
 *                     Presenting it auto-restores that hero. This is the primary key.
 *   - recovery code : a human-friendly code shown ONCE at creation. Presenting it
 *                     returns the token, so a hero can be reclaimed on another device.
 *                     Stored only as a salted-ish SHA-256 hash (never in the clear).
 *   - character     : the game's per-player snapshot slice (stats + inventory) as JSONB.
 *
 * If DATABASE_URL isn't set, every call no-ops and `enabled` is false — the server
 * still runs, heroes are just ephemeral (current behaviour). Link a Postgres in
 * Railway (Variables → Add Reference → DATABASE_URL) to switch persistence on.
 */
'use strict';
const crypto = require('crypto');

const URL = process.env.DATABASE_URL || '';
let pool = null;
if (URL) {
  try {
    const { Pool } = require('pg');
    // Railway's internal host (…​.railway.internal) and localhost don't use TLS;
    // public proxies / Neon do. Be permissive on the cert (hobby project).
    const needSSL = /sslmode=require/.test(URL) || (!/\.railway\.internal/.test(URL) && !/localhost|127\.0\.0\.1/.test(URL));
    pool = new Pool({ connectionString: URL, ssl: needSSL ? { rejectUnauthorized: false } : false, max: 4 });
    pool.on('error', (e) => console.error('[db] pool error:', e && e.message));
  } catch (e) {
    console.error('[db] pg not available — heroes will be ephemeral:', e && e.message);
    pool = null;
  }
}

const enabled = !!pool;

function token() { return crypto.randomBytes(24).toString('base64url'); }   // ~32 chars, the browser secret
function hash(s) { return crypto.createHash('sha256').update('eldermyr:' + String(s).trim().toUpperCase()).digest('hex'); }

// A readable code the player can jot down: WORD-XXXX-WORD-XXXX (~40 bits; the only
// account secret, hashed at rest, guarding a hobby save — no sensitive data).
const WORDS = ['EMBER', 'FROST', 'IRON', 'MOSS', 'DAWN', 'DUSK', 'WOLF', 'RAVEN', 'STAG', 'FANG',
  'TIDE', 'ASH', 'OAK', 'THORN', 'STORM', 'VALE', 'RUNE', 'GALE', 'MYRR', 'HOLLOW'];
function recoveryCode() {
  const b = crypto.randomBytes(6);
  const w = (i) => WORDS[b[i] % WORDS.length];
  const q = (i) => (b[i] * 256 + b[i + 1]).toString(16).toUpperCase().padStart(4, '0');
  return `${w(0)}-${q(1)}-${w(3)}-${q(4)}`;
}

async function init() {
  if (!pool) { console.log('[db] no DATABASE_URL — heroes are ephemeral this run'); return false; }
  await pool.query(`CREATE TABLE IF NOT EXISTS accounts (
    token         text PRIMARY KEY,
    name          text NOT NULL,
    recovery_hash text NOT NULL,
    character     jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS accounts_recovery_idx ON accounts (recovery_hash)');
  console.log('[db] ready — persistent heroes enabled');
  return true;
}

// Create a fresh hero. Returns { token, name, recovery } — `recovery` is shown to
// the player ONCE (it's only stored hashed), never again.
async function createAccount(name) {
  if (!pool) return null;
  const nm = (String(name || 'Hero').trim() || 'Hero').slice(0, 18);
  const tok = token(), recovery = recoveryCode();
  await pool.query('INSERT INTO accounts (token, name, recovery_hash) VALUES ($1, $2, $3)', [tok, nm, hash(recovery)]);
  return { token: tok, name: nm, recovery, character: null };
}

async function loadByToken(tok) {
  if (!pool || !tok) return null;
  const r = await pool.query('SELECT token, name, character FROM accounts WHERE token = $1', [tok]);
  return r.rows[0] ? { token: r.rows[0].token, name: r.rows[0].name, character: r.rows[0].character } : null;
}

// Reclaim a hero on a new device via its recovery code → returns its token + character.
async function loadByRecovery(code) {
  if (!pool || !code) return null;
  const r = await pool.query('SELECT token, name, character FROM accounts WHERE recovery_hash = $1 LIMIT 1', [hash(code)]);
  return r.rows[0] ? { token: r.rows[0].token, name: r.rows[0].name, character: r.rows[0].character } : null;
}

async function saveCharacter(tok, character) {
  if (!pool || !tok || !character) return;
  await pool.query('UPDATE accounts SET character = $1, updated_at = now() WHERE token = $2', [character, tok]);
}

// Rename a hero (the recovery code / save is unchanged).
async function renameAccount(tok, name) {
  if (!pool || !tok) return null;
  const nm = (String(name || '').trim()).slice(0, 18);
  if (!nm) return null;
  await pool.query('UPDATE accounts SET name = $1, updated_at = now() WHERE token = $2', [nm, tok]);
  return nm;
}

module.exports = { enabled, init, createAccount, loadByToken, loadByRecovery, saveCharacter, renameAccount };
