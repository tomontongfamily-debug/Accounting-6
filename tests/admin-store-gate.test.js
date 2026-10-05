import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const source = readFileSync(new URL('../src/admin-store-gate.jsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS}}).outputText;
const exported = {};
new Function('React', 'exports', compiled)(React, exported);
const Gate = exported.default;
const render = props => renderToStaticMarkup(React.createElement(Gate, {...props, retry() {}, logout() {}}, React.createElement('div', null, 'Report totals: ₱0.00')));

test('Admin displays loading progress and hides false zero totals until every page loads', () => {
  const html = render({finished: false, error: '', loadedReportCount: 400});
  assert.match(html, /Loading Admin Reports/);
  assert.match(html, /400 reports loaded/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /Report totals|₱0\.00/);
});

test('An initial request failure offers recovery without displaying an empty dashboard', () => {
  const html = render({finished: true, error: 'The request timed out', loadedReportCount: 200});
  assert.match(html, /Unable to Load Admin Reports/);
  assert.match(html, /The request timed out/);
  assert.match(html, /Try Again/);
  assert.doesNotMatch(html, /Report totals/);
});

test('A completed load displays the actual dashboard, including legitimate zero totals', () => {
  const html = render({finished: true, error: '', loadedReportCount: 1026});
  assert.match(html, /Report totals: ₱0\.00/);
  assert.doesNotMatch(html, /Loading Admin Reports|Try Again/);
});
