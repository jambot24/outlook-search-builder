import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAll, render, formatDate, quote, splitList, wildcard, CLIENTS } from '../public/js/query.js';

test('empty criteria produce empty queries and no warnings', () => {
  const out = renderAll({});
  for (const c of CLIENTS) {
    assert.equal(out[c.key].query, '');
    assert.deepEqual(out[c.key].warnings, []);
  }
});

test('quote wraps values with spaces and strips embedded double quotes', () => {
  assert.equal(quote('invoice'), 'invoice');
  assert.equal(quote('Jane Doe'), '"Jane Doe"');
  assert.equal(quote('say "hi" now'), '"say hi now"');
  assert.equal(quote('  '), '');
});

test('splitList splits on commas and semicolons and drops blanks', () => {
  assert.deepEqual(splitList('a@x.com, b@x.com; ,c'), ['a@x.com', 'b@x.com', 'c']);
  assert.deepEqual(splitList(''), []);
});

test('words: all, phrase, any and none render per client', () => {
  const c = { allWords: 'invoice overdue', phrase: 'quarterly report', anyWords: 'contract agreement', noneWords: 'newsletter' };
  assert.equal(render('classic', c).query, 'invoice AND overdue AND "quarterly report" AND (contract OR agreement) AND NOT newsletter');
  assert.equal(render('modern', c).query, 'invoice AND overdue AND "quarterly report" AND (contract OR agreement) AND -newsletter');
});

test('single sender has no parentheses, several senders are ORed in a group', () => {
  assert.equal(render('modern', { from: 'jane@contoso.com' }).query, 'from:jane@contoso.com');
  assert.equal(
    render('modern', { from: 'jane@contoso.com, Bob Smith' }).query,
    '(from:jane@contoso.com OR from:"Bob Smith")',
  );
});

test('participants are native on modern and expanded to from/to/cc on classic', () => {
  assert.equal(render('modern', { participants: 'jane' }).query, 'participants:jane');
  assert.equal(render('classic', { participants: 'jane' }).query, '(from:jane OR to:jane OR cc:jane)');
});

test('subject with spaces is quoted as a phrase', () => {
  assert.equal(render('classic', { subject: 'weekly status' }).query, 'subject:"weekly status"');
});

test('attachments use the singular hasattachment keyword everywhere', () => {
  for (const key of ['classic', 'modern', 'mac']) {
    assert.equal(render(key, { hasAttachments: 'yes' }).query, 'hasattachment:yes');
    assert.equal(render(key, { hasAttachments: 'no' }).query, 'hasattachment:no');
  }
});

test('attachment name is emitted with a warning outside classic', () => {
  assert.equal(render('classic', { attachmentName: 'report.pdf' }).query, 'attachment:report.pdf');
  const m = render('modern', { attachmentName: 'report.pdf' });
  assert.equal(m.query, 'attachment:report.pdf');
  assert.equal(m.warnings.length, 1);
});

test('formatDate honours the requested format', () => {
  assert.equal(formatDate('2026-03-05', 'mdy'), '3/5/2026');
  assert.equal(formatDate('2026-03-05', 'dmy'), '5/3/2026');
  assert.equal(formatDate('2026-03-05', 'iso'), '2026-03-05');
  assert.equal(formatDate('not-a-date', 'mdy'), '');
});

test('relative dates are quoted when they contain a space', () => {
  const c = { dateMode: 'preset', dateField: 'received', datePreset: 'last week' };
  assert.equal(render('classic', c).query, 'received:"last week"');
  assert.equal(render('modern', { ...c, datePreset: 'today' }).query, 'received:today');
});

test('relative periods not documented for the new engine carry a warning', () => {
  const r = render('modern', { dateMode: 'preset', datePreset: 'last year' });
  assert.equal(r.query, 'received:"last year"');
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(render('classic', { dateMode: 'preset', datePreset: 'last year' }).warnings, []);
});

test('single date on classic follows the chosen format, modern is always MM/DD/YYYY', () => {
  const c = { dateMode: 'on', dateField: 'sent', date1: '2026-01-15', dateFormat: 'dmy' };
  assert.equal(render('classic', c).query, 'sent:15/1/2026');
  assert.equal(render('modern', c).query, 'sent:01/15/2026');
});

test('between uses comparisons on classic and the documented range on modern', () => {
  const c = { dateMode: 'between', date1: '2026-01-01', date2: '2026-03-31', dateFormat: 'mdy' };
  assert.equal(render('classic', c).query, 'received:>=1/1/2026 AND received:<=3/31/2026');
  assert.equal(render('modern', c).query, 'received:01/01/2026..03/31/2026');
});

test('between swaps dates entered in the wrong order', () => {
  const c = { dateMode: 'between', date1: '2026-03-31', date2: '2026-01-01' };
  assert.equal(render('modern', c).query, 'received:01/01/2026..03/31/2026');
});

test('after and before on modern become open-ended ranges', () => {
  assert.equal(render('modern', { dateMode: 'after', date1: '2026-02-10' }).query, 'received:02/10/2026..12/31/2099');
  // "Before 10 Feb" must exclude 10 Feb, so the range ends on 9 Feb.
  assert.equal(render('modern', { dateMode: 'before', date1: '2026-02-10' }).query, 'received:01/01/1990..02/09/2026');
  assert.equal(render('classic', { dateMode: 'before', date1: '2026-02-10' }).query, 'received:<2/10/2026');
});

test('between with a missing second date warns and emits nothing', () => {
  const r = render('modern', { dateMode: 'between', date1: '2026-01-01' });
  assert.equal(r.query, '');
  assert.equal(r.warnings.length, 1);
});

test('status keywords differ between classic and modern', () => {
  const c = { read: 'no', flagged: 'yes' };
  assert.equal(render('classic', c).query, 'read:no AND hasflag:true');
  const m = render('modern', c);
  assert.equal(m.query, 'read:no AND isflagged:yes');
  assert.equal(m.warnings.length, 1); // read: is documented for Windows only; isflagged is in the web/Mac table
});

test('category names with spaces are quoted', () => {
  assert.equal(render('modern', { category: 'Trade Show' }).query, 'category:"Trade Show"');
});

test('size is emitted everywhere, with a warning outside classic', () => {
  assert.equal(render('classic', { sizeOp: '>', sizeMb: '5' }).query, 'messagesize:>5 MB');
  assert.equal(render('classic', { sizeOp: '<', sizeMb: '0.5' }).query, 'messagesize:<512 KB');
  const m = render('modern', { sizeOp: '>', sizeMb: '5' });
  assert.equal(m.query, 'messagesize:>5 MB');
  assert.equal(m.warnings.length, 1);
});

test('folder is never part of the query; it becomes a scope instruction', () => {
  const out = renderAll({ folder: 'Clients / Contoso', subject: 'x' });
  for (const c of CLIENTS) {
    assert.equal(out[c.key].query, 'subject:x');
    assert.match(out[c.key].scope, /Contoso/);
  }
});

test('folder defaults to Inbox and All folders uses the whole-mailbox scope', () => {
  assert.match(render('classic', { subject: 'x' }).scope, /"Inbox".*Current Folder/);
  assert.match(render('classic', { subject: 'x', folder: 'All folders' }).scope, /Current Mailbox/);
  assert.match(render('modern', { subject: 'x', folder: 'all folders' }).scope, /All folders/);
  assert.equal(render('modern', {}).scope, '');
});

test('include deleted items adds the per-client setting, except when searching Deleted Items', () => {
  assert.match(render('classic', { subject: 'x', includeDeleted: 'yes' }).scope, /File > Options > Search/);
  assert.match(render('modern', { subject: 'x', includeDeleted: 'yes' }).scope, /Include deleted items/);
  assert.match(render('mobile', { subject: 'x', includeDeleted: 'yes' }).scope, /no setting/);
  assert.doesNotMatch(render('modern', { subject: 'x', folder: 'Deleted Items', includeDeleted: 'yes' }).scope, /Settings/);
});

test('mobile gets the modern query plus a plain keyword fallback', () => {
  const r = render('mobile', { from: 'jane', allWords: 'invoice', phrase: 'past due' });
  assert.equal(r.query, 'invoice AND "past due" AND from:jane');
  assert.equal(r.fallback, 'invoice "past due" jane');
  assert.ok(r.warnings.length >= 1);
});

test('unknown client throws', () => {
  assert.throws(() => render('lotus', {}), /Unknown client/);
});

test('wildcard keeps a trailing * on modern and drops it on classic', () => {
  const warnings = [];
  assert.equal(wildcard('migrat*', 'modern'), 'migrat*');
  assert.equal(wildcard('migrat*', 'classic', (w) => warnings.push(w)), 'migrat');
  assert.equal(warnings.length, 1);
});

test('wildcard removes leading and mid-word asterisks with a warning', () => {
  const warnings = [];
  assert.equal(wildcard('*grat*', 'modern', (w) => warnings.push(w)), 'grat*');
  assert.equal(wildcard('mi*grat', 'modern', (w) => warnings.push(w)), 'migrat');
  assert.equal(wildcard('***', 'modern', (w) => warnings.push(w)), '');
  assert.equal(warnings.length, 2);
});

test('wildcards apply to words and single-word fields', () => {
  const c = { allWords: 'migrat*', subject: 'renew*', from: 'jan*' };
  assert.equal(render('modern', c).query, 'migrat* AND from:jan* AND subject:renew*');
  const classic = render('classic', c);
  assert.equal(classic.query, 'migrat AND from:jan AND subject:renew');
  assert.equal(classic.warnings.length, 1);
});

test('wildcards are stripped from quoted phrases with a warning', () => {
  const r = render('modern', { subject: 'project upd*', phrase: 'change contr*' });
  assert.equal(r.query, '"change control" AND subject:"project upd"'.replace('control', 'contr'));
  assert.equal(r.warnings.length, 1);
});

test('mobile fallback has no asterisks', () => {
  assert.equal(render('mobile', { allWords: 'migrat*' }).fallback, 'migrat');
});
