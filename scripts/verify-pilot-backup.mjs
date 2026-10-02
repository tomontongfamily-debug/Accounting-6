// Local recovery drill only: never connects to or overwrites the live database.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const folder=path.resolve(process.argv[2]||'');
const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));
for(const [name,hash] of Object.entries(manifest.files)) {
  assert.equal(path.basename(name),name,'Unsafe backup filename');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(folder,name))).digest('hex'),hash,`Corrupt backup: ${name}`);
}
const backup=JSON.parse(fs.readFileSync(path.join(folder,'backup.json')));
assert.equal(backup.schemaVersion,1);
const db=new PGlite();
try {
  await db.exec(`create table fueltech_reports(report_key text primary key,branch text,report_date date,shift_id text,data jsonb,updated_at timestamptz);
    create table fueltech_price_book(branch text,effective_date date,coverage text,shift_id text,prices jsonb,updated_at timestamptz,primary key(branch,effective_date,coverage,shift_id));
    create table fueltech_pilot_state(mode text primary key,revision bigint,data jsonb,updated_at timestamptz);`);
  await db.query('insert into fueltech_reports select * from jsonb_populate_recordset(null::fueltech_reports,$1::jsonb)',[JSON.stringify(backup.baseline.payload.reports)]);
  await db.query('insert into fueltech_price_book select * from jsonb_populate_recordset(null::fueltech_price_book,$1::jsonb)',[JSON.stringify(backup.baseline.payload.prices)]);
  await db.query('insert into fueltech_pilot_state values($1,$2,$3,$4)',[backup.config.mode,backup.state.revision,JSON.stringify(backup.state.data),backup.state.updated_at]);
  assert.deepEqual((await db.query('select data from fueltech_pilot_state')).rows[0].data,backup.state.data);
  for(const row of (await db.query('select report_key,data from fueltech_reports')).rows) assert.deepEqual(row.data,backup.baseline.payload.reports.find(r=>r.report_key===row.report_key).data);
  for(const row of (await db.query('select branch,effective_date::text,coverage,shift_id,prices from fueltech_price_book')).rows) assert.deepEqual(row.prices,backup.baseline.payload.prices.find(r=>r.branch===row.branch&&r.effective_date===row.effective_date&&r.coverage===row.coverage&&r.shift_id===row.shift_id).prices);
  for(const photo of Object.values(backup.state.data.photos)) {
    const name=path.basename(photo.file);assert.ok(manifest.files[name],'Photo bytes missing from backup');
    const bytes=fs.readFileSync(path.join(folder,name));assert.equal(bytes[0],255);assert.equal(bytes[1],216);
  }
  const result={ok:true,checkedAt:new Date().toISOString(),restoredReports:backup.baseline.payload.reports.length,restoredPrices:backup.baseline.payload.prices.length,restoredTrialRevision:backup.state.revision,verifiedPhotos:Object.keys(backup.state.data.photos).length,productionModified:false};
  fs.writeFileSync(path.join(folder,'restore-verification.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await db.close();}
