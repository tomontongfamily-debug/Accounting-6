import assert from 'node:assert/strict';
import test from 'node:test';
import { isLiloanArchivedSlot } from '../src/opening-health.js';
import { shouldDiscardOfflineReport, isCleanRestartRejection } from '../src/offline-report.js';
import { createSessionToken } from '../api/_shared/session.js';
import saveReport from '../api/reports/save.js';
import leaseReport from '../api/reports/lease.js';
import savePrice from '../api/prices/save.js';

test('Old offline drafts cannot restore archived Liloan reports', () => {
  for (const [date, shiftId] of [['2026-08-04','shift-3'],['2026-10-01','shift-3'],['2026-10-02','shift-1'],['2026-10-02','shift-2']]) {
    assert.equal(isLiloanArchivedSlot('Liloan',date,shiftId),true);
    assert.equal(shouldDiscardOfflineReport({branch:'Liloan',date,shiftId},'2026-07-29'),true);
  }
  for (const [date, shiftId] of [['2026-10-02','shift-3'],['2026-10-03','shift-1'],['2026-10-05','shift-2']]) {
    assert.equal(shouldDiscardOfflineReport({branch:'Liloan',date,shiftId},'2026-07-29'),false);
  }
  assert.equal(shouldDiscardOfflineReport({branch:'Arpili',date:'2026-10-01',shiftId:'shift-1'},'2026-07-29'),false);
  assert.equal(isCleanRestartRejection({status:409,message:'This report is from before the clean restart in Liloan and has been archived.'}),true);
});

test('Report, edit-session and price APIs reject authenticated archived uploads before database access', async () => {
  const previous = process.env.FUELTECH_SESSION_SECRET;
  process.env.FUELTECH_SESSION_SECRET = 'local-archive-regression-secret';
  try {
    const token = createSessionToken({role:'Cashier',branch:'Liloan'});
    const cases = [
      [saveReport,{report:{branch:'Liloan',date:'2026-10-01',shiftId:'shift-3'}}],
      [saveReport,{report:{branch:'Liloan',date:'2026-10-02',shiftId:'shift-2'}}],
      [leaseReport,{branch:'Liloan',date:'2026-10-01',shiftId:'shift-3',clientId:'old-device'}],
      [leaseReport,{branch:'Liloan',date:'2026-10-02',shiftId:'shift-1',clientId:'old-device'}],
      [savePrice,{branch:'Liloan',date:'2026-10-01',coverage:'Daily',prices:{}}],
      [savePrice,{branch:'Liloan',date:'2026-10-02',coverage:'Shift',shiftId:'shift-2',prices:{}}],
    ];
    for (const [handler,body] of cases) {
      const response={code:0,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
      await handler({method:'POST',headers:{'x-fueltech-session':token},body},response);
      assert.equal(response.code,409);
      assert.match(response.body.error,/before the clean restart in Liloan.*archived/);
    }
  } finally {
    if(previous===undefined)delete process.env.FUELTECH_SESSION_SECRET;
    else process.env.FUELTECH_SESSION_SECRET=previous;
  }
});
