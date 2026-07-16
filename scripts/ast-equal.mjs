// scripts/ast-equal.mjs
//
// Semantic gate for formatting passes: proves the assembled game script in
// dist/eldermyr.html is AST-EQUIVALENT to the frozen monolith's script — same
// structure, same values, positions and raw-token spellings ignored. Formatting
// (whitespace, quote style, line breaks) passes; ANY structural or value change fails.
//
// Usage: node scripts/ast-equal.mjs [candidateHtml=dist/eldermyr.html]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL = path.join(ROOT, 'eldermyr-rpg.html');
const CANDIDATE = path.resolve(ROOT, process.argv[2] || 'dist/eldermyr.html');

function scriptOf(file) {
  const html = fs.readFileSync(file, 'utf8');
  const a = html.indexOf('<script>');
  const b = html.indexOf('</script>', a);
  if (a < 0 || b < 0) throw new Error(`no script block in ${file}`);
  return html.slice(a + 8, b);
}

// Strip positions and raw token text; keep everything semantic (including literal
// VALUES — 'a' vs "a" both have value 'a'; 1e3 vs 1000 both value 1000).
const DROP = new Set(['start', 'end', 'loc', 'range', 'raw']);
function normalize(node) {
  if (Array.isArray(node)) return node.map(normalize);
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node).sort()) {
      if (DROP.has(k)) continue;
      const v = node[k];
      // BigInt literals carry a non-JSON value; stringify deterministically.
      out[k] = typeof v === 'bigint' ? `bigint:${v}` : normalize(v);
    }
    return out;
  }
  return node;
}

function parse(src, label) {
  try {
    return acorn.parse(src, { ecmaVersion: 2023, sourceType: 'script' });
  } catch (e) {
    console.error(`ast-equal: ${label} does not parse: ${e.message}`);
    process.exit(2);
  }
}

const a = JSON.stringify(normalize(parse(scriptOf(CANONICAL), 'canonical')));
const b = JSON.stringify(normalize(parse(scriptOf(CANDIDATE), 'candidate')));

if (a === b) {
  console.log(`ast-equal: PASS — ${path.relative(ROOT, CANDIDATE)} is AST-equivalent to eldermyr-rpg.html (${a.length} normalized bytes)`);
} else {
  // Find the first divergence coarsely to aid debugging.
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && a[i] === b[i]) i++;
  console.error(`ast-equal: FAIL — first normalized divergence at char ${i}:`);
  console.error(`  canonical: …${a.slice(Math.max(0, i - 80), i + 120)}…`);
  console.error(`  candidate: …${b.slice(Math.max(0, i - 80), i + 120)}…`);
  process.exit(1);
}
