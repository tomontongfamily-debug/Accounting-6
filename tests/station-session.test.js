import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import stationSession from '../api/auth/station-session.js';
import {createSessionToken} from '../api/_shared/session.js';
import {readStationSession} from '../src/station-routing.js';

const previousSecret = process.env.FUELTECH_SESSION_SECRET;
after(() => { if (previousSecret === undefined) delete process.env.FUELTECH_SESSION_SECRET; else process.env.FUELTECH_SESSION_SECRET = previousSecret; });
const secret = 'station-session-test-only';
const invoke = (token, method = 'GET') => {
  process.env.FUELTECH_SESSION_SECRET = secret;
  const res = {headers: {}, setHeader(name, value) {this.headers[name] = value;}, status(code) {this.code = code; return this;}, json(body) {this.body = body; return this;}};
  stationSession({method, headers: {cookie: '__Host-fueltech_session=' + token}}, res);
  return res;
};
const tokenFor = (role, branch) => {
  process.env.FUELTECH_SESSION_SECRET = secret;
  return createSessionToken({role, branch});
};

for (const role of ['Cashier', 'Manager']) test(role + ' reuses its signed cookie without a second PIN or exposing the token', async () => {
  const token = tokenFor(role, 'Liloan');
  const res = invoke(token);
  assert.equal(res.code, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(Object.keys(res.body).sort(), ['branch', 'expiresAt', 'ok', 'role']);
  assert.equal(res.body.branch, 'Liloan');
  assert.equal(res.body.role, role);
  assert.ok(res.body.expiresAt > Date.now());
  assert.deepEqual(await readStationSession(role, async () => new Response(JSON.stringify(res.body))), res.body);
});

test('Other branch cookies remain scoped to their original station', () => {
  const res = invoke(tokenFor('Manager', 'Mabolo'));
  assert.equal(res.code, 200);
  assert.equal(res.body.branch, 'Mabolo');
});

test('Invalid, forged or expired cookies cannot restore station access', () => {
  assert.equal(invoke('').code, 401);
  assert.equal(invoke(tokenFor('Cashier', 'Liloan') + 'tampered').code, 401);
  const payload = Buffer.from(JSON.stringify({role: 'Cashier', branch: 'Liloan', exp: 1})).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  assert.equal(invoke(payload + '.' + signature).code, 401);
});

test('All-station roles, unknown branches and unsupported methods cannot use station restoration', () => {
  for (const role of ['Admin', 'Approver']) assert.equal(invoke(tokenFor(role, 'Liloan')).code, 403);
  assert.equal(invoke(tokenFor('Manager', 'Unknown')).code, 403);
  assert.equal(invoke(tokenFor('Cashier', 'Liloan'), 'POST').code, 405);
});
