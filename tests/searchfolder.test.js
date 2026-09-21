import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchFolderSteps } from '../public/js/searchfolder.js';

const now = new Date(2026, 8, 21);

test('classic maps criteria onto the three dialog tabs', () => {
  const r = searchFolderSteps('classic', {
    from: 'a@x.com, b@x.com', subject: 'invoice', read: 'no', fileTypes: 'pdf', importance: 'high',
    flagged: 'yes', category: 'Red', sizeOp: '>', sizeMb: '5', cc: 'c@x.com', folder: 'Inbox',
    dateMode: 'preset', datePreset: 'last month',
  }, { now });
  const text = r.steps.join('\n');
  assert.match(text, /Search for the word\(s\): invoice; In: subject field only; From…: a@x.com; b@x.com/);
  assert.match(text, /Time: received · last month/);
  assert.match(text, /Only items that are: unread; Only items with: one or more attachments; Whose importance is: high; Only items which: are flagged by me; Categories…: tick "Red"; Size \(kilobytes\): greater than 5120/);
  assert.match(text, /Advanced tab: .*CC · contains · c@x.com/);
  assert.match(text, /tick "Inbox"/);
  assert.deepEqual(r.leftOut, ['attachment name or file type']);
});

test('classic dates outside the Time list go to the Advanced tab with a fixed-date note', () => {
  const y = searchFolderSteps('classic', { dateMode: 'preset', datePreset: 'last year' }, { now });
  assert.match(y.steps.join(' '), /Received · between · 1\/1\/2025 and 12\/31\/2025/);
  assert.equal(y.notes.length, 1);
  assert.match(searchFolderSteps('classic', { dateMode: 'older', days: '30' }, { now }).steps.join(' '), /on or before · 8\/21\/2026/);
  assert.match(searchFolderSteps('classic', { dateMode: 'within', days: '7', dateField: 'sent' }, { now }).steps.join(' '), /Time: sent · in the last 7 days/);
  assert.match(searchFolderSteps('classic', { dateMode: 'within', days: '3' }, { now }).steps.join(' '), /on or after · 9\/18\/2026/);
  assert.match(searchFolderSteps('classic', { dateMode: 'between', date1: '2026-03-01', date2: '2026-01-01' }, { now }).steps.join(' '), /between · 1\/1\/2026 and 3\/1\/2026/);
  assert.match(searchFolderSteps('classic', { dateMode: 'on', date1: '2026-03-01' }).steps.join(' '), /on · 3\/1\/2026/);
  assert.match(searchFolderSteps('classic', { dateMode: 'after', date1: '2026-03-01' }).steps.join(' '), /on or after · 3\/1\/2026/);
  assert.match(searchFolderSteps('classic', { dateMode: 'before', date1: '2026-03-01' }).steps.join(' '), /before · 3\/1\/2026/);
});

test('classic flags any-word OR and lists what cannot be set', () => {
  const r = searchFolderSteps('classic', { anyWords: 'a b', noneWords: 'z', bcc: 'q', participants: 'p', hasAttachments: 'no', read: 'yes' });
  assert.match(r.steps.join(' '), /In: subject field and message body/);
  assert.match(r.steps.join(' '), /Only items that are: read; Only items with: no attachments/);
  assert.equal(r.notes.length, 1);
  assert.deepEqual(r.leftOut, ['none of these words', 'Bcc', 'anywhere in From/To/Cc']);
});

test('new Outlook picks the closest ready-made folder and lists what it leaves out', () => {
  const r = searchFolderSteps('modern', { read: 'no', from: 'a@x.com', folder: 'Inbox' });
  assert.match(r.steps.join(' '), /"Unread mail"/);
  assert.match(r.steps.join(' '), /Filter to specific folders" and pick "Inbox"/);
  assert.deepEqual(r.leftOut, ['from']);
  assert.match(searchFolderSteps('modern', { read: 'no', flagged: 'yes' }).steps.join(' '), /unread or flagged/);
  assert.match(searchFolderSteps('modern', { from: 'a@x.com' }).steps.join(' '), /full email addresses/);
  assert.match(searchFolderSteps('modern', { dateMode: 'older', days: '30' }).steps.join(' '), /"Old mail", then set the age to 30 days/);
  assert.match(searchFolderSteps('modern', { sizeOp: '>', sizeMb: '10' }).steps.join(' '), /10240 KB/);
  assert.match(searchFolderSteps('modern', { fileTypes: 'pdf' }).steps.join(' '), /Mail with attachments/);
  assert.match(searchFolderSteps('modern', { category: 'Red' }).steps.join(' '), /Categorized mail/);
  assert.match(searchFolderSteps('modern', { importance: 'high' }).steps.join(' '), /Important mail/);
  assert.match(searchFolderSteps('modern', { anyWords: 'x' }).steps.join(' '), /specific words", then enter x/);
});

test('new Outlook with nothing matching, Mac and mobile', () => {
  const none = searchFolderSteps('modern', { to: 'x@y.com' });
  assert.equal(none.supported, false);
  assert.equal(searchFolderSteps('mac', {}).supported, true);
  assert.equal(searchFolderSteps('mobile', {}).supported, false);
  assert.equal(searchFolderSteps('classic', null).supported, true);
});
