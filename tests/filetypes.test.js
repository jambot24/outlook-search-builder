import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILE_TYPES, parseFileTypes, extensionsFor, labelFor, typeForExtension } from '../public/js/filetypes.js';

test('file type keys are unique and extensions do not overlap', () => {
  assert.equal(new Set(FILE_TYPES.map((t) => t.key)).size, FILE_TYPES.length);
  const exts = FILE_TYPES.flatMap((t) => t.exts);
  assert.equal(new Set(exts).size, exts.length);
});

test('parse, extensions, labels and reverse lookup', () => {
  assert.deepEqual(parseFileTypes(' word, pdf ,nope'), ['pdf', 'word']);
  assert.deepEqual(parseFileTypes(undefined), []);
  assert.deepEqual(extensionsFor(['pdf', 'word']), ['pdf', 'docx', 'doc']);
  assert.equal(labelFor('excel'), 'Excel');
  assert.equal(labelFor('zzz'), 'zzz');
  assert.equal(typeForExtension('DOCX'), 'word');
  assert.equal(typeForExtension('exe'), '');
});
