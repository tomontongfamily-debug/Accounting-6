import test from 'node:test';
import assert from 'node:assert/strict';
import {depositCoverage} from '../src/deposit-coverage.js';

const report = (day,shift) => `Liloan__2026-10-${day}__shift-${shift}`;
const deposit = (id,keys=[],sources=[]) => ({id,branch:'Liloan',depositDate:'2026-10-05',coveredReportKeys:keys,carryoverSourceIds:sources});

test('Deposits made on October 5 identify all six October 3–4 covered shifts', () => {
  for (const day of ['03','04']) for (const shift of [1,2,3]) {
    const saved = deposit(`${day}-${shift}`,[report(day,shift)]);
    const before = structuredClone(saved);
    const coverage = depositCoverage(saved);
    assert.equal(coverage.title,`Oct ${Number(day)}, 2026`);
    assert.match(coverage.groups[0].shiftLabel,new RegExp(`^Shift ${shift} · `));
    assert.equal(coverage.reports[0].date,`2026-10-${day}`);
    assert.deepEqual(saved,before);
  }
});

test('Batch coverage is sorted and deduplicated with each date’s selected shifts visible', () => {
  const coverage = depositCoverage(deposit('batch',[report('04',3),report('03',2),report('03',1),report('03',2)]));
  assert.deepEqual(coverage.groups.map(g=>g.label),['Oct 3, 2026 · Shifts 1, 2','Oct 4, 2026 · Shift 3 · 10pm–4am']);
  assert.equal(coverage.reports.length,3);
  assert.equal(coverage.title,'Oct 3, 2026 – Oct 4, 2026');
});

test('A later deposit of a partial balance traces its original shifts without relabeling them October 5', () => {
  const first=deposit('first',[report('03',3)]);
  const second=deposit('second',[],['first']);
  const final=deposit('final',[report('04',1)],['second','first']);
  const coverage=depositCoverage(final,[first,second,final]);
  assert.deepEqual(coverage.reports.map(r=>r.key),[report('03',3),report('04',1)]);
  assert.equal(coverage.hasCarryover,true);
  assert.equal(coverage.incomplete,false);
  assert.equal(depositCoverage(second,[first,second]).title,'Oct 3, 2026');
});

test('Unavailable, cyclic or other-station coverage never invents report coverage from the bank date', () => {
  const missing=deposit('missing',[],['unknown']);
  assert.equal(depositCoverage(missing).title,'Covered shifts unavailable');
  assert.equal(depositCoverage(missing).incomplete,true);
  const other={...deposit('other',[report('03',1)]),branch:'Mabolo'};
  const invalid=deposit('invalid',['Liloan__2026-02-30__shift-1','Mabolo__2026-10-03__shift-1'],['other']);
  assert.equal(depositCoverage(invalid,[other]).reports.length,0);
  const cycle=deposit('cycle',[report('04',2)],['cycle']);
  assert.equal(depositCoverage(cycle,[cycle]).incomplete,true);
});
