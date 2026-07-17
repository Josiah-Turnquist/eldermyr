// src/content/elements.ts — the element registry (P3/S1; verbatim from the monolith's
// ELEMENTS table, src/game/parts/p17-drawAlly.js:172).
//
// Four rows crossing sim (applyElementOnHit keys side-effects on these ids and genWeapon
// bakes `name` into item names), render (elemColor/elemRgb bolt + glow colors) and UI
// (elemHtml tags). Plain data — no hooks, no RNG. Adding an element = one row here plus
// its key in ElementKey (types.ts); the game reads rows through CONTENT.elements only.
import type { ElementDef, ElementKey } from './types';

export const ELEMENTS: Record<ElementKey, ElementDef> = {
  fire: { name: 'Fire', color: '#ff7838', rgb: '255,120,56', tag: '🔥' },
  frost: { name: 'Frost', color: '#66c6ff', rgb: '102,198,255', tag: '❄' },
  poison: { name: 'Poison', color: '#9be24a', rgb: '155,226,74', tag: '☠' },
  shock: { name: 'Shock', color: '#ffe24a', rgb: '255,226,74', tag: '⚡' },
};
