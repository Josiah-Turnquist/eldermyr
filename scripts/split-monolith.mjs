// scripts/split-monolith.mjs
//
// P1a: slice the frozen monolith (eldermyr-rpg.html) into positional part files at
// PARSER-VERIFIED top-level statement boundaries. No reordering, no rewriting — the
// byte-partition property is the whole point:
//
//     shell-head.html + concat(parts in manifest order) + shell-tail.html
//        === eldermyr-rpg.html   (byte-for-byte, verified below)
//
// Parts are POSITIONAL (p00, p01, …), not thematic — the monolith interleaves themes,
// so thematic placement happens later in the module codemod where the import graph
// makes file location semantically free. Part names carry their first declaration
// (p07-makeEnemy.js) purely for navigability.
//
// Re-runnable: wipes src/game/parts/ and regenerates everything from the monolith.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_HTML = path.join(ROOT, 'eldermyr-rpg.html');
const OUT_DIR = path.join(ROOT, 'src', 'game');
const PARTS_DIR = path.join(OUT_DIR, 'parts');
const TARGET_PART_BYTES = 16 * 1024;

const html = fs.readFileSync(SRC_HTML, 'utf8');

// --- locate the single <script> block -------------------------------------------------
const OPEN = '<script>', CLOSE = '</script>';
const a = html.indexOf(OPEN);
const b = html.indexOf(CLOSE, a);
if (a < 0 || b < 0) throw new Error('script block not found');
if (html.indexOf(OPEN, a + 1) !== -1) throw new Error('expected exactly one <script> block');
const head = html.slice(0, a + OPEN.length);
const js = html.slice(a + OPEN.length, b);
const tail = html.slice(b);

// --- parse and collect top-level statement start offsets ------------------------------
const ast = acorn.parse(js, { ecmaVersion: 2023, sourceType: 'script' });
const stmts = ast.body;
if (!stmts.length) throw new Error('no top-level statements parsed');

function firstDeclName(node) {
  if (node.type === 'FunctionDeclaration' && node.id) return node.id.name;
  if (node.type === 'VariableDeclaration' && node.declarations[0]?.id?.name) {
    return node.declarations[0].id.name;
  }
  if (node.type === 'ExpressionStatement') return 'stmt';
  return node.type.replace(/Statement|Declaration/g, '').toLowerCase() || 'misc';
}

// Cut whenever the running part would exceed the target size; cuts land exactly on a
// statement's start offset, so every byte between cuts (comments, whitespace) travels
// with the part that follows its preceding statement.
const cuts = [];   // { startOffset, name } — first part starts at 0
let partStart = 0;
let firstStmtOfPart = stmts[0];
for (let i = 1; i < stmts.length; i++) {
  const s = stmts[i];
  if (s.start - partStart >= TARGET_PART_BYTES) {
    cuts.push({ startOffset: partStart, name: firstDeclName(firstStmtOfPart) });
    partStart = s.start;
    firstStmtOfPart = s;
  }
}
cuts.push({ startOffset: partStart, name: firstDeclName(firstStmtOfPart) });

// --- write shell + parts + manifest ----------------------------------------------------
fs.rmSync(PARTS_DIR, { recursive: true, force: true });
fs.mkdirSync(PARTS_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'shell-head.html'), head);
fs.writeFileSync(path.join(OUT_DIR, 'shell-tail.html'), tail);

const manifest = [];
for (let i = 0; i < cuts.length; i++) {
  const from = cuts[i].startOffset;
  const to = i + 1 < cuts.length ? cuts[i + 1].startOffset : js.length;
  const safe = cuts[i].name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 24) || 'misc';
  const file = `p${String(i).padStart(2, '0')}-${safe}.js`;
  fs.writeFileSync(path.join(PARTS_DIR, file), js.slice(from, to));
  manifest.push(file);
}
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// --- byte-identity proof ----------------------------------------------------------------
const rebuilt =
  fs.readFileSync(path.join(OUT_DIR, 'shell-head.html'), 'utf8') +
  manifest.map((f) => fs.readFileSync(path.join(PARTS_DIR, f), 'utf8')).join('') +
  fs.readFileSync(path.join(OUT_DIR, 'shell-tail.html'), 'utf8');
if (rebuilt !== html) {
  // Locate first differing byte for the error message.
  let i = 0;
  while (i < rebuilt.length && rebuilt[i] === html[i]) i++;
  throw new Error(`REBUILD MISMATCH at byte ${i}: split is NOT byte-identical`);
}

const sizes = manifest.map((f) => fs.statSync(path.join(PARTS_DIR, f)).size);
console.log(`split-monolith: ${manifest.length} parts, ${Math.min(...sizes)}–${Math.max(...sizes)} bytes each`);
console.log(`byte-identity: PASS (head + ${manifest.length} parts + tail === eldermyr-rpg.html, ${html.length} bytes)`);
