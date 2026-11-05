import test from 'node:test';
import assert from 'node:assert/strict';
import {readTotalizerGrid} from '../src/totalizer-grid.js';
import {gridFixture} from './totalizer-grid-fixture.mjs';

test('bounded geometry search preserves the original exhaustive search results and stable ties',()=>{
 const args=gridFixture(),original=args[0].slice(),readings=readTotalizerGrid(...args);
 assert.deepEqual(args[0],original,'A geometry search must preserve its source mask');
 assert.equal(readings.length,3);
 assert.deepEqual(readings.map(r=>({text:r.text,value:r.value,score:r.score,margin:r.margin})),Array(3).fill({text:'23456789',value:234567.89,score:0,margin:1/7}));
 // Frozen from the exhaustive pre-optimization search. Equal-score layouts
 // must keep their generation order so refinement considers the same cells.
 assert.deepEqual(readings.map(r=>r.layout.left),[397.6313920255183,399.8000370015949,401.96868197767145]);
 assert.deepEqual(readings[0].digitMargins,[2/7,1/7,2/7,1/7,1/7,1/7,1/7,1/7]);
 const missingDecimal=args[4].filter(c=>!(c.width===8&&c.height===8));
 assert.deepEqual(readTotalizerGrid(...args.slice(0,4),missingDecimal),[],'No decimal means no inferred reading');
});
