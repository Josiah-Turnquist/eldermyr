#!/usr/bin/env node
/*
 * scripts/db-dump.mjs — redacted backup of the `accounts` table (rebuild S1).
 * =============================================================================
 * Design: JOSIAH runs this (it needs DATABASE_URL, which agents never have and
 * must never use — REBUILD.md backup rule). It SELECTs every account, REDACTS
 * the secrets (token and recovery_hash are replaced by sha256 prefixes — enough
 * to correlate rows across dumps, useless for login/reclaim), and writes a JSON
 * dump OUTSIDE any committed path. The dump feeds two things:
 *   - the pre-cutover backup ("saves must survive"), and
 *   - MIGRATE_DUMP=<path> node tests/battery/migrate-roundtrip.js — runs every
 *     real blob through the pure importer (no-throw + version monotonicity).
 *
 *   node scripts/db-dump.mjs [--limit N] [--out PATH]
 *
 * Default output: <repo>/backups/dump-<ISO>.json — backups/ is gitignored
 * (verified below, not assumed). The script REFUSES to write any path that is
 * inside the repo and not gitignored: a dump must never be committable.
 */
'use strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const sha12 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 12);

// Prefer the PUBLIC url: this tool runs OUTSIDE Railway's private network by definition
// (an operator's machine via `railway run`, which injects both), and the plain
// DATABASE_URL points at *.railway.internal, unresolvable from outside.
const URL = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || '';
if (!URL) {
  console.error('db-dump: DATABASE_URL is not set — nothing to dump.');
  console.error('This script is designed to be run by the project owner against the Railway DB;');
  console.error('agents run without DATABASE_URL by design and must not set one.');
  process.exit(2);
}

const limitRaw = arg('--limit');
const limit = limitRaw === undefined ? null : Math.max(1, parseInt(limitRaw, 10) || 0);
if (limitRaw !== undefined && !limit) { console.error(`db-dump: bad --limit ${JSON.stringify(limitRaw)}`); process.exit(2); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outPath = path.resolve(arg('--out') || path.join(REPO, 'backups', `dump-${stamp}.json`));

// ---- refuse any committable output path -----------------------------------
const rel = path.relative(REPO, outPath);
const insideRepo = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
if (insideRepo) {
  const r = spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: REPO });
  if (r.status !== 0) {
    console.error(`db-dump: REFUSING to write ${outPath}`);
    console.error('It is inside the repo and NOT gitignored — a dump holds player data and must never be committable.');
    console.error('Use the default (backups/ is gitignored) or pass --out with a path outside the repo.');
    process.exit(2);
  }
}

const { Pool } = require('pg');
// TLS heuristic mirrored from server/db.js: Railway-internal host and localhost
// are plaintext; public proxies / Neon need (permissive) TLS.
const needSSL = /sslmode=require/.test(URL) || (!/\.railway\.internal/.test(URL) && !/localhost|127\.0\.0\.1/.test(URL));
const pool = new Pool({ connectionString: URL, ssl: needSSL ? { rejectUnauthorized: false } : false, max: 2 });

const schemaVersionOf = (c) => (c ? (c.schemaVersion ?? c.v ?? 1) : 'none'); // reader rule, server/migrate.js

try {
  const sql = 'SELECT token, name, recovery_hash, character, created_at, updated_at FROM accounts ORDER BY updated_at DESC'
    + (limit ? ` LIMIT ${limit}` : '');
  const res = await pool.query(sql);

  const histogram = {};
  const rows = res.rows.map((r) => {
    const sv = schemaVersionOf(r.character);
    histogram[sv] = (histogram[sv] || 0) + 1;
    return {
      tokenSha12: sha12(r.token),               // REDACTED — correlation id only
      recoveryHashSha12: sha12(r.recovery_hash), // REDACTED
      name: r.name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      character: r.character,                    // the JSONB blob itself (the thing being backed up)
    };
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    _meta: {
      dumpedAt: new Date().toISOString(),
      rowCount: rows.length,
      limited: limit || null,
      schemaVersionHistogram: histogram,
      note: 'token/recovery_hash are sha256[0:12] redactions — see scripts/db-dump.mjs',
    },
    rows,
  }, null, 2) + '\n');

  console.log(`db-dump: ${rows.length} account row(s) → ${outPath}`);
  console.log('per-schemaVersion histogram (schemaVersion ?? v ?? 1; "none" = no character saved yet):');
  for (const k of Object.keys(histogram).sort()) console.log(`  ${k}: ${histogram[k]}`);
} catch (e) {
  console.error('db-dump: query failed —', e && e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
