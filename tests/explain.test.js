import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../public/js/explain.js';

test('empty criteria explain to an empty string', () => {
  assert.equal(explain({}), '');
  assert.equal(explain(null), '');
});

test('status words become adjectives', () => {
  assert.equal(explain({ read: 'no', flagged: 'yes' }), 'Finds unread and flagged messages.');
  assert.equal(explain({ importance: 'high' }), 'Finds high-importance messages.');
});

test('people, words and attachments read as one sentence', () => {
  assert.equal(
    explain({ from: 'jane@contoso.com, Bob', allWords: 'invoice', hasAttachments: 'yes' }),
    'Finds messages from jane@contoso.com or Bob containing "invoice" with attachments.',
  );
});

test('word lists join with and/or and exclusions are named', () => {
  assert.equal(
    explain({ anyWords: 'a b c', noneWords: 'x' }),
    'Finds messages mentioning "a", "b" or "c" not mentioning "x".',
  );
});

test('dates are described per mode and between is ordered', () => {
  assert.equal(explain({ dateMode: 'preset', datePreset: 'last week' }), 'Finds messages received last week.');
  assert.equal(explain({ dateMode: 'on', dateField: 'sent', date1: '2026-01-15' }), 'Finds messages sent on Jan 15, 2026.');
  assert.equal(
    explain({ dateMode: 'between', date1: '2026-03-31', date2: '2026-01-01' }),
    'Finds messages received between Jan 1, 2026 and Mar 31, 2026.',
  );
  assert.equal(explain({ dateMode: 'between', date1: '2026-03-31' }), '');
});

test('size, subject, category and other fields are described', () => {
  assert.equal(
    explain({ subject: 'status', category: 'Red', sizeOp: '>', sizeMb: '5', to: 'a', cc: 'b', bcc: 'c', participants: 'd', phrase: 'p q', body: 'z', attachmentName: 'x.pdf', read: 'yes', importance: 'normal', hasAttachments: 'no', dateMode: 'after', date1: '2026-02-01' }),
    'Finds read and normal-importance messages sent to a with b on Cc with c on Bcc involving d containing the phrase "p q" with "status" in the subject with "z" in the body without attachments with an attachment named like "x.pdf" in the "Red" category received on or after Feb 1, 2026 larger than 5 MB.',
  );
  assert.equal(explain({ dateMode: 'before', date1: '2026-02-01', sizeOp: '<', sizeMb: '1' }), 'Finds messages received before Feb 1, 2026 smaller than 1 MB.');
});

test('file types and phrases are described', () => {
  assert.equal(explain({ fileTypes: 'pdf,word' }), 'Finds messages with PDF or Word attachments.');
  assert.equal(explain({ anyWords: 'unsubscribe "opt out"' }), 'Finds messages mentioning "unsubscribe" or "opt out".');
});

test('days-ago window is described', () => {
  assert.equal(explain({ dateMode: 'ago', days: '14', days2: '7' }), 'Finds messages received between 7 and 14 days ago.');
});
