// src/content/affixes.ts — the elite-affix registry (P3/S7).
//
// The "variety at zero art cost" enemy affixes, moved out of p18: AFX_DEFS (the four affix
// definitions — flag/label/pre) and AFX_KEYS (the ordered pool). The per-key SEEDING that
// rollEliteAffixes ran inline (p18:50-57) becomes an `apply(e)` hook per affix — pure, it
// mutates ONLY the enemy instance it is handed (shielded stamps a shield pool off maxHp,
// warded arms its ward window; vampiric/splitting seed nothing, so they omit apply). The affix
// PICK (the RNG splice) stays in rollEliteAffixes and the HIT behaviour stays in the hot-path
// afxHit — data-driven, not a hook per hit (p18's own note). p18 keeps positional aliases
// (`const AFX_DEFS = CONTENT.affixes.defs;`) so afxCount/rollEliteAffixes read unchanged.
//
// Adding an elite affix = one entry here (flag + label + pre + optional apply) plus its key in
// KEYS, and a hot-path branch in afxHit if it gates damage. NOT frozen (the registry rule); the
// apply hook never touches a registry row (only the enemy) — content-purity's canary guards it.
import type { AffixRegistry, EliteAffix } from './types';

const DEFS: Record<string, EliteAffix> = {
  shielded: {
    flag: 'afxShield',
    label: 'SHIELDED',
    pre: 'Shielded ',
    apply(e) {
      e.shieldMax = Math.max(1, Math.round(e.maxHp * 0.25));
      e.shieldHp = e.shieldMax;
      e.shieldRegenT = 0;
    },
  },
  vampiric: { flag: 'afxVamp', label: 'VAMPIRIC', pre: 'Vampiric ' },
  splitting: { flag: 'afxSplit', label: 'SPLITTING', pre: 'Splitting ' },
  warded: {
    flag: 'afxWard',
    label: 'WARDED',
    pre: 'Warded ',
    apply(e) {
      e.wardT = 0;
      e.wardCd = 180;
    },
  },
};

// The ordered pool rollEliteAffixes splices from (was AFX_KEYS). The order is the RNG contract
// — kept explicit and separate from DEFS exactly as the monolith had it.
const KEYS: readonly string[] = ['shielded', 'vampiric', 'splitting', 'warded'];

export const AFFIXES: AffixRegistry = {
  defs: DEFS,
  keys: KEYS,
};
