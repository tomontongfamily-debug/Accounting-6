import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyHealth } from "../api/_shared/health.js";
import { isMaboloPreOpeningSlot, isStationPreOpeningSlot, openingSlotHealth } from "../src/opening-health.js";

test("Mabolo shifts before its July 29 Shift 3 opening setup are not required", () => {
  assert.equal(isMaboloPreOpeningSlot("Mabolo", "2026-07-29", "shift-1"), true);
  assert.equal(isMaboloPreOpeningSlot("Mabolo", "2026-07-29", "shift-2"), true);
  assert.equal(isMaboloPreOpeningSlot("Mabolo", "2026-07-29", "shift-3"), false);
});

test("Mabolo opening day health does not count pre-opening shifts as missing", () => {
  const health = buildDailyHealth({
    date: "2026-07-29",
    reportRows: [{
      report_key: "Mabolo__2026-07-29__shift-3",
      data: { branch: "Mabolo", date: "2026-07-29", shiftId: "shift-3", baselineReport: true, baselineConfirmed: true },
    }],
  });
  const mabolo = health.stations.find((station) => station.branch === "Mabolo");

  assert.deepEqual(mabolo.shifts.map((shift) => shift.status), ["Not Required", "Not Required", "Submitted"]);
  assert.deepEqual(mabolo.shifts.map((shift) => shift.depositStatus), ["Not Required", "Not Required", "Not Required"]);
  assert.equal(mabolo.missing, 0);
});

test("Mabolo reports after opening day are still required", () => {
  const health = buildDailyHealth({ date: "2026-07-30", reportRows: [] });
  const mabolo = health.stations.find((station) => station.branch === "Mabolo");

  assert.deepEqual(mabolo.shifts.map((shift) => shift.status), ["Missing", "Missing", "Missing"]);
});

test("Liloan starts with October 2 Shift 3 as its beginning setup without rewriting the report", () => {
  const report={branch:'Liloan',date:'2026-10-02',shiftId:'shift-3',confirmed:true,baselineConfirmed:true};
  const before=structuredClone(report);
  assert.equal(isStationPreOpeningSlot('Liloan','2026-10-02','shift-1'),true);
  assert.equal(isStationPreOpeningSlot('Liloan','2026-10-02','shift-2'),true);
  assert.equal(isStationPreOpeningSlot('Liloan','2026-10-02','shift-3'),false);
  assert.deepEqual(openingSlotHealth(report,'Liloan','2026-10-02','shift-3'),{label:'Submitted',tone:'green',detail:'Beginning Setup'});
  assert.equal(openingSlotHealth(undefined,'Liloan','2026-10-02','shift-3').label,'Missing');
  const health=buildDailyHealth({date:'2026-10-02',reportRows:[{report_key:'Liloan__2026-10-02__shift-3',data:report}]});
  const liloan=health.stations.find(s=>s.branch==='Liloan');
  assert.deepEqual(liloan.shifts.map(s=>s.status),['Not Required','Not Required','Submitted']);
  assert.equal(liloan.shifts[2].detail,'Beginning Setup');
  assert.equal(liloan.depositMissing,0);
  assert.deepEqual(report,before);
});

test("All six Liloan shifts after the opening baseline remain required and confirmed warnings stay submitted",()=>{
  for(const date of ['2026-10-03','2026-10-04']){
    assert.equal(buildDailyHealth({date}).stations.find(s=>s.branch==='Liloan').missing,3);
    const reportRows=['shift-1','shift-2','shift-3'].map(shiftId=>({report_key:`Liloan__${date}__${shiftId}`,data:{branch:'Liloan',date,shiftId,confirmed:true,pilot:true,checkRequired:true}}));
    const health=buildDailyHealth({date,reportRows}).stations.find(s=>s.branch==='Liloan');
    assert.equal(health.submitted,3);
    assert.equal(health.missing,0);
    assert.equal(openingSlotHealth(reportRows[0].data,'Liloan',date,'shift-1'),null);
  }
  assert.equal(isStationPreOpeningSlot('Arpili','2026-10-02','shift-1'),false);
  assert.equal(isStationPreOpeningSlot('Liloan','2026-10-01','shift-1'),true);
});

test('Archived Liloan dates are not treated as missing reports or deposits', () => {
  for (const date of ['2026-07-30', '2026-09-30', '2026-10-01']) {
    const station = buildDailyHealth({date}).stations.find(s => s.branch === 'Liloan');
    assert.deepEqual(station.shifts.map(s => s.status), ['Not Required', 'Not Required', 'Not Required']);
    assert.equal(station.missing, 0);
    assert.equal(station.depositMissing, 0);
  }
  assert.equal(buildDailyHealth({date:'2026-10-03'}).stations.find(s => s.branch === 'Liloan').missing, 3);
  assert.equal(buildDailyHealth({date:'2026-10-01'}).stations.find(s => s.branch === 'Arpili').missing, 3);
});
