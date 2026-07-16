// src/content/index.ts — content registry root (P3).
//
// Imports every registry, builds ONE object, and exposes it explicitly (greppable, no
// esbuild globalName) for the classic-script game program: scripts/build.mjs compiles
// this entry to a single non-minified IIFE chunk and prepends it to the parts concat,
// so every part sees CONTENT at load time. Parts consume via positional lexical aliases
// (`const ELEMENTS = CONTENT.elements;` at the original declaration line) or direct
// CONTENT.<registry> lookups at dispatch sites. Module era (post-P3): the chunk step is
// deleted and these imports go direct — the registries themselves don't change.
//
// Deliberately NOT frozen: sloppy-mode writes to frozen objects fail silently — the
// exact failure class this codebase refuses. The mutation tripwire is the golden oracles
// plus the content-purity battery canary (live CONTENT deep-equals a fresh re-eval of
// the chunk after a headless run).
import { ELEMENTS } from './elements';

const CONTENT = {
  elements: ELEMENTS,
};

export type Content = typeof CONTENT;

(globalThis as { CONTENT?: Content }).CONTENT = CONTENT;
