import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, loadSaved, persistSaved, createEntry, upsertEntry, removeEntry,
  toExportJson, toExportCsv, mergeImport, sanitizeCriteria,
} from '../public/js/storage.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

const NOW = new Date('2026-09-21T12:00:00Z');

test('loadSaved returns [] for missing, corrupt or non-array data', () => {
  assert.deepEqual(loadSaved(memoryStorage()), []);
  assert.deepEqual(loadSaved(memoryStorage({ [STORAGE_KEY]: '{bad' })), []);
  assert.deepEqual(loadSaved(memoryStorage({ [STORAGE_KEY]: '{"a":1}' })), []);
});

test('loadSaved returns [] when storage throws', () => {
  const broken = { getItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(loadSaved(broken), []);
});

test('persist then load round-trips and drops invalid entries', () => {
  const s = memoryStorage();
  const good = createEntry('Invoices', { from: 'a' }, NOW);
  assert.equal(persistSaved(s, [good, { name: '', criteria: {} }]), true);
  assert.deepEqual(loadSaved(s), [good]);
});

test('persistSaved reports failure when storage is full', () => {
  const full = { setItem: () => { throw new Error('QuotaExceeded'); } };
  assert.equal(persistSaved(full, []), false);
});

test('createEntry requires a name and copies criteria', () => {
  assert.throws(() => createEntry('  ', {}), /name/);
  const criteria = { from: 'a' };
  const e = createEntry('  X  ', criteria, NOW);
  assert.equal(e.name, 'X');
  assert.equal(e.savedAt, NOW.toISOString());
  criteria.from = 'changed';
  assert.equal(e.criteria.from, 'a');
});

test('upsertEntry replaces same name case-insensitively without mutating input', () => {
  const a = createEntry('Report', { from: 'a' }, NOW);
  const b = createEntry('report', { from: 'b' }, NOW);
  const list = [a];
  const next = upsertEntry(list, b);
  assert.equal(next.length, 1);
  assert.equal(next[0].criteria.from, 'b');
  assert.equal(list[0], a);
});

test('removeEntry removes by id', () => {
  const a = createEntry('A', {}, NOW);
  const b = createEntry('B', {}, NOW);
  assert.deepEqual(removeEntry([a, b], a.id), [b]);
});

test('JSON export imports back into an empty list', () => {
  const list = [createEntry('A', { from: 'x' }, NOW), createEntry('B', { subject: 'y' }, NOW)];
  const { list: merged, imported, skipped } = mergeImport([], toExportJson(list, NOW));
  assert.equal(imported, 2);
  assert.equal(skipped, 0);
  assert.deepEqual(merged.map((e) => e.name), ['A', 'B']);
  assert.deepEqual(merged[0].criteria, { from: 'x' });
});

test('import accepts a bare array, overwrites same names, counts skipped', () => {
  const existing = [createEntry('A', { from: 'old' }, NOW), createEntry('Keep', {}, NOW)];
  const text = JSON.stringify([{ name: 'a', criteria: { from: 'new' } }, { nope: true }]);
  const { list, imported, skipped } = mergeImport(existing, text);
  assert.equal(imported, 1);
  assert.equal(skipped, 1);
  assert.deepEqual(list.map((e) => [e.name, e.criteria.from]), [['a', 'new'], ['Keep', undefined]]);
});

test('import rejects invalid JSON and files without searches', () => {
  assert.throws(() => mergeImport([], 'not json'), /valid JSON/);
  assert.throws(() => mergeImport([], '{"x":1}'), /saved searches/);
});

test('sanitizeCriteria keeps flat string fields only', () => {
  assert.deepEqual(
    sanitizeCriteria({ from: 'a', n: 5, obj: { x: 1 }, 'bad key': 'x', __proto__x: 'y' }),
    { from: 'a', n: '5' },
  );
});

test('CSV export quotes, escapes and neutralises formula cells', () => {
  const list = [createEntry('Say "hi", =SUM', { x: '1' }, NOW)];
  const csv = toExportCsv(list, () => ({ classic: '=cmd', modern: 'from:a', mac: 'a,b', mobile: '' }));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'Name,Saved,Outlook Classic,New Outlook / Web,Outlook for Mac,Outlook mobile');
  assert.equal(lines[1], `"Say ""hi"", =SUM",${NOW.toISOString()},'=cmd,from:a,"a,b",`);
});
