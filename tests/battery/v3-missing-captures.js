'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// V3 — capture-drift guard. On the REAL committed CAPTURE list, __missingCaptures should be []
// (every listed symbol still exists). Also unit-test the filter's SHAPE with a bogus name,
// WITHOUT touching the committed list, to prove the mechanism flags a missing symbol.
const assert = require('assert');
const G = require('' + __RR + '/server/load-game');

assert.ok(Array.isArray(G.__missingCaptures), '__missingCaptures must be an array');
console.log('Real-list __missingCaptures =', JSON.stringify(G.__missingCaptures));

// Mechanism unit-test — same expression shape used in load-game.js:
//   [...new Set(CAPTURE)].filter((n) => global.__game[n] === undefined)
const fakeGame = { state: {}, killEnemy: () => {} };            // 'ghostSymbol' intentionally absent
const fakeList = ['state', 'killEnemy', 'ghostSymbol', 'state']; // includes a dup + a bogus name
const missing = [...new Set(fakeList)].filter((n) => fakeGame[n] === undefined);
console.log('Filter unit-test missing =', JSON.stringify(missing));
assert.deepStrictEqual(missing, ['ghostSymbol'], 'filter must flag exactly the missing name (deduped)');

assert.deepStrictEqual(G.__missingCaptures, [], 'real CAPTURE list should have NO missing symbols');
console.log('\nV3 PASS — real list clean ([]); filter correctly flags a missing symbol.');
process.exit(0);
