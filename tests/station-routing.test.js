import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedCashierBranch, liloanWorkflowPath, readStationSession, redirectLiloanLogin, stationRoleFromPath} from '../src/station-routing.js';

const live = {mode: 'live', launch: {ready: true}};
for (const role of ['Cashier', 'Manager']) test(role + ' opens the new Liloan workflow from the ordinary link', async () => {
  const pathname = '/' + role.toLowerCase();
  assert.equal(stationRoleFromPath(pathname), role);
  assert.equal(liloanWorkflowPath({role, branch: 'Liloan', pathname, config: live}), '/pilot' + pathname);
  const navigated = [];
  assert.equal(await redirectLiloanLogin(role, 'Liloan', {pathname, request: async () => new Response(JSON.stringify(live)), navigate: path => navigated.push(path)}), true);
  assert.deepEqual(navigated, ['/pilot' + pathname]);
});

test('Other stations, all-station roles and existing pilot links do not redirect', async () => {
  const cases = [
    ['Cashier', 'Mabolo', '/cashier'], ['Manager', 'Barili', '/manager'],
    ['Admin', 'Liloan', '/admin'], ['Approver', 'Liloan', '/approver'],
    ['Cashier', 'Liloan', '/pilot/cashier'], ['Manager', 'Liloan', '/cashier'],
  ];
  for (const [role, branch, pathname] of cases) {
    assert.equal(liloanWorkflowPath({role, branch, pathname, config: live}), null);
    assert.equal(await redirectLiloanLogin(role, branch, {pathname, request: () => {throw Error('Must not fetch');}, navigate: () => {throw Error('Must not navigate');}}), false);
  }
});

test('Trial, disabled and unfinished opening setups preserve the existing workflow', () => {
  for (const config of [null, {mode: 'disabled'}, {mode: 'shadow'}, {mode: 'live', launch: {ready: false}}])
    assert.equal(liloanWorkflowPath({role: 'Cashier', branch: 'Liloan', pathname: '/cashier', config}), null);
});

test('A configuration failure is recoverable and cannot open unverified workflow data', async () => {
  await assert.rejects(redirectLiloanLogin('Manager', 'Liloan', {pathname: '/manager', request: async () => new Response('{}', {status: 503}), navigate: () => {throw Error('Must not navigate');}}), /Unable to check the Liloan workflow/);
});

test('Session restoration accepts only the requested role with an unexpired verified session', async () => {
  const value = {ok: true, role: 'Manager', branch: 'Liloan', expiresAt: Date.now() + 60000};
  const request = async (path, options) => {
    assert.equal(path, '/api/auth/station-session');
    assert.equal(options.cache, 'no-store');
    return new Response(JSON.stringify(value));
  };
  assert.deepEqual(await readStationSession('Manager', request), value);
  assert.equal(await readStationSession('Cashier', request), null);
  value.expiresAt = 1;
  assert.equal(await readStationSession('Manager', request), null);
  for (const status of [401, 403]) assert.equal(await readStationSession('Manager', async () => new Response('{}', {status})), null);
  await assert.rejects(readStationSession('Manager', async () => new Response('{}', {status: 503})), /Unable to check your station login/);
});

test('The offline routing hint ignores expired or malformed cashier caches', () => {
  const storage = value => ({getItem: () => value});
  assert.equal(cachedCashierBranch(storage(JSON.stringify({branch: 'Liloan', expiresAt: Date.now() + 60000}))), 'Liloan');
  assert.equal(cachedCashierBranch(storage(JSON.stringify({branch: 'Mabolo', expiresAt: Date.now() + 60000}))), 'Mabolo');
  assert.equal(cachedCashierBranch(storage(JSON.stringify({branch: 'Liloan', expiresAt: 1}))), '');
  assert.equal(cachedCashierBranch(storage('invalid-json')), '');
  assert.equal(cachedCashierBranch({getItem: () => {throw Error('Storage unavailable');}}), '');
});
