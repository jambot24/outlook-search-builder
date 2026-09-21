import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_INS, CATEGORIES, CATEGORY_KEYS, categoryLabel } from '../public/js/library.js';
import { renderAll } from '../public/js/query.js';
import { explain } from '../public/js/explain.js';
import { sanitizeCriteria } from '../public/js/storage.js';

test('every built-in has a unique id, a known category and a non-empty query everywhere', () => {
  const ids = new Set();
  for (const b of BUILT_INS) {
    assert.ok(!ids.has(b.id), `duplicate id ${b.id}`);
    ids.add(b.id);
    assert.ok(CATEGORY_KEYS.has(b.category), `${b.id} has unknown category ${b.category}`);
    assert.deepEqual(sanitizeCriteria(b.criteria), b.criteria, `${b.id} criteria are not flat strings`);
    for (const [client, r] of Object.entries(renderAll(b.criteria))) {
      assert.notEqual(r.query, '', `${b.id} renders nothing for ${client}`);
      assert.doesNotMatch(r.query, /\w+:(\s|$)/, `${b.id} has a dangling keyword for ${client}`);
    }
    assert.match(explain(b.criteria), /^Finds .+\.$/, `${b.id} has no explanation`);
  }
});

test('every category is used by at least one built-in, except Other', () => {
  for (const c of CATEGORIES.filter((x) => x.key !== 'other')) {
    assert.ok(BUILT_INS.some((b) => b.category === c.key), `no built-in in ${c.key}`);
  }
});

test('categoryLabel falls back to Other', () => {
  assert.equal(categoryLabel('finance'), 'Invoices & finance');
  assert.equal(categoryLabel('nope'), 'Other');
});
