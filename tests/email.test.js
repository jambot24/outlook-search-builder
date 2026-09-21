import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bytesToBinary,
  parseEml, decodeHeaderValue, parseAddressList, normalizeSubject, subjectPattern,
  suggestionsFor, headerFacts, combine, fromMsgData, readEmailFile, MAX_FILE_BYTES,
} from '../public/js/email.js';

const EML = [
  'From: "Contoso Billing" <Billing@Contoso.com>',
  'To: Jane Doe <jane@fabrikam.com>',
  'Cc: bob@fabrikam.com, "Ann" <ann@fabrikam.com>',
  'Reply-To: noreply@mailer.contoso.com',
  'Subject: =?UTF-8?B?UkU6IEludm9pY2UgIzQ4MjEzIOKAkyBTZXB0ZW1iZXI=?=',
  'Date: Mon, 21 Sep 2026 09:15:00 -0500',
  'List-Unsubscribe: <mailto:unsub@contoso.com>',
  'List-Id: Billing <billing.contoso.com>',
  'Authentication-Results: mx.fabrikam.com; spf=pass smtp.mailfrom=contoso.com; dkim=pass; dmarc=pass',
  'X-Mailer: ContosoMail 2.1',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="outer"',
  '',
  '--outer',
  'Content-Type: multipart/alternative; boundary="inner"',
  '',
  '--inner',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Your invoice is attached. Total =E2=82=AC120.',
  '--inner',
  'Content-Type: text/html',
  '',
  '<p>Your invoice</p>',
  '--inner--',
  '--outer',
  'Content-Type: application/pdf; name="invoice-48213.pdf"',
  'Content-Disposition: attachment; filename="invoice-48213.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  'JVBERi0xLjQK',
  '--outer',
  "Content-Disposition: attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.docx",
  '',
  'xx',
  '--outer--',
  '',
].join('\r\n');

test('decodeHeaderValue handles B and Q encoded words', () => {
  assert.equal(decodeHeaderValue('=?UTF-8?Q?Caf=C3=A9_menu?='), 'Café menu');
  assert.equal(decodeHeaderValue('=?utf-8?B?SGVsbG8=?= =?utf-8?B?IHdvcmxk?='), 'Hello world');
  assert.equal(decodeHeaderValue('plain'), 'plain');
});

test('parseAddressList reads names, bare addresses and lower-cases', () => {
  assert.deepEqual(parseAddressList('"Doe, Jane" <Jane@X.com>, bob@y.org'), [
    { name: 'Doe, Jane', address: 'jane@x.com' },
    { name: '', address: 'bob@y.org' },
  ]);
  assert.deepEqual(parseAddressList(''), []);
});

test('parseEml reads headers, nested multipart body and attachments', () => {
  const e = parseEml(EML);
  assert.deepEqual(e.from, { name: 'Contoso Billing', address: 'billing@contoso.com' });
  assert.equal(e.to[0].address, 'jane@fabrikam.com');
  assert.equal(e.cc.length, 2);
  assert.equal(e.subject, 'RE: Invoice #48213 – September');
  assert.equal(e.date.toISOString(), '2026-09-21T14:15:00.000Z');
  assert.deepEqual(e.attachments, ['invoice-48213.pdf', 'résumé.docx']);
  assert.equal(e.bodyText, 'Your invoice is attached. Total €120.');
});

test('parseEml tolerates a message with no body or bad date', () => {
  const e = parseEml('Subject: hi\r\nDate: not a date\r\n');
  assert.equal(e.subject, 'hi');
  assert.equal(e.date, null);
  assert.equal(e.from, null);
});

test('subjects are normalised and numbered subjects get a pattern', () => {
  assert.equal(normalizeSubject('RE: Fwd: AW: Re:  Budget  review'), 'Budget review');
  assert.equal(subjectPattern('RE: Invoice #48213 – September'), 'Invoice');
  assert.equal(subjectPattern('#48213 Your order has shipped'), 'Your order has shipped');
  assert.equal(subjectPattern('No numbers here'), '');
});

test('suggestions cover sender, domain, subject pattern, attachments, list and date', () => {
  const e = parseEml(EML);
  const s = suggestionsFor(e);
  const byId = Object.fromEntries(s.map((x) => [x.id, x]));
  assert.deepEqual(byId.from.criteria, { from: 'billing@contoso.com' });
  assert.deepEqual(byId['from-domain'].criteria, { from: 'contoso.com' });
  assert.equal(byId.subject.checked, false);
  assert.equal(byId['subject-pattern'].checked, true);
  assert.deepEqual(byId['attachment-type'].criteria, { fileTypes: 'pdf,word' });
  assert.equal(byId['attachment-type'].label, 'Has PDF or Word attachments');
  assert.ok(byId.newsletter);
  assert.deepEqual(byId['date-window'].criteria, { dateMode: 'between', date1: '2026-09-14', date2: '2026-09-28' });
  assert.equal(byId.to.criteria.to, 'jane@fabrikam.com');
});

test('free-mail domains are not offered as a sender domain', () => {
  const s = suggestionsFor({ from: { address: 'someone@gmail.com' }, headers: new Map() });
  assert.deepEqual(s.map((x) => x.id), ['from']);
});

test('header facts explain what search cannot use', () => {
  const facts = headerFacts(parseEml(EML));
  assert.ok(facts.some((f) => f.includes('mailing list (Billing billing.contoso.com)')));
  assert.ok(facts.some((f) => f.includes('noreply@mailer.contoso.com')));
  assert.ok(facts.some((f) => f.includes('SPF pass, DKIM pass, DMARC pass')));
  assert.ok(facts.some((f) => f.includes('ContosoMail')));
  assert.deepEqual(headerFacts({ headers: new Map([['auto-submitted', 'auto-replied'], ['precedence', 'bulk']]) }).length, 2);
});

test('combine merges checked suggestions and appends words', () => {
  const s = [
    { id: 'a', criteria: { from: 'x' } },
    { id: 'b', criteria: { allWords: 'one' } },
    { id: 'c', criteria: { allWords: 'two' } },
    { id: 'd', criteria: { to: 'y' } },
  ];
  assert.deepEqual(combine(s, new Set(['a', 'b', 'c'])), { from: 'x', allWords: 'one two' });
});

test('fromMsgData maps msgreader output', () => {
  const e = fromMsgData({
    senderName: 'Jane', senderSmtpAddress: 'Jane@X.com', subject: ' Hi ',
    recipients: [{ name: 'A', smtpAddress: 'a@x.com', recipType: 'to' }, { name: 'B', email: 'b@x.com', recipType: 'cc' }, { name: 'none', email: 'EX:/o=legacy' }],
    attachments: [{ fileName: 'a.pdf' }, { name: 'b.docx' }],
    headers: 'List-Id: <l.x.com>\r\nReply-To: r@x.com',
    messageDeliveryTime: 'Mon, 21 Sep 2026 10:00:00 GMT',
  });
  assert.deepEqual(e.from, { name: 'Jane', address: 'jane@x.com' });
  assert.deepEqual(e.to, [{ name: 'A', address: 'a@x.com' }]);
  assert.deepEqual(e.cc, [{ name: 'B', address: 'b@x.com' }]);
  assert.equal(e.subject, 'Hi');
  assert.deepEqual(e.attachments, ['a.pdf', 'b.docx']);
  assert.equal(e.replyTo.address, 'r@x.com');
  assert.ok(e.headers.has('list-id'));
  assert.equal(fromMsgData({}).date, null);
});

test('readEmailFile rejects big, fake and non-email files', async () => {
  const fake = (bytes, name, size) => ({ name, size: size ?? bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer });
  await assert.rejects(readEmailFile(null), /No file/);
  await assert.rejects(readEmailFile(fake([], 'x.eml', MAX_FILE_BYTES + 1)), /25 MB/);
  await assert.rejects(readEmailFile(fake([1, 2, 3], 'x.msg')), /damaged/);
  await assert.rejects(readEmailFile(fake([...new TextEncoder().encode('just some text')], 'x.eml')), /does not look like an email/);
  const ok = await readEmailFile(fake([...new TextEncoder().encode(EML)], 'x.eml'));
  assert.equal(ok.from.address, 'billing@contoso.com');
});

// ---------- regressions from the 2026-09-21 bug hunt ----------

const utf8 = (t) => bytesToBinary(new TextEncoder().encode(t));

test('8-bit UTF-8 headers and bodies decode correctly', () => {
  const e = parseEml(utf8('Subject: Café résumé – €\r\nFrom: Zoë <zoe@x.com>\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nCafé €'));
  assert.equal(e.subject, 'Café résumé – €');
  assert.equal(e.from.name, 'Zoë');
  assert.equal(e.bodyText, 'Café €');
});

// ISO-8859-2 rather than Windows-1252: Node's TextDecoder treats windows-1252 as Latin-1, browsers do not.
test('8-bit body in a declared single-byte charset decodes', () => {
  const bytes = new Uint8Array([...new TextEncoder().encode('Content-Type: text/plain; charset=iso-8859-2\r\n\r\nmiasto '), 0xa3, 0xf3, 0x64, 0xbc]);
  assert.equal(parseEml(bytesToBinary(bytes)).bodyText, 'miasto Łódź');
});

test('encoded words split inside a character join up', () => {
  assert.equal(decodeHeaderValue('=?utf-8?Q?=C3?= =?utf-8?Q?=A9?='), 'é');
});

test('address groups and undisclosed recipients parse', () => {
  assert.deepEqual(parseAddressList('Team: a@x.com, b@x.com; undisclosed-recipients:;').map((a) => a.address), ['a@x.com', 'b@x.com']);
});

test('a MIME part with no headers keeps its body', () => {
  const e = parseEml('Content-Type: multipart/mixed; boundary=B\r\n\r\n--B\r\n\r\nplain body\r\n--B--');
  assert.equal(e.bodyText, 'plain body');
});

test('crafted input does not blow up parsing time', () => {
  const t = Date.now();
  parseAddressList('a'.repeat(200000));
  parseEml(`Content-Type: text/html\r\n\r\n${'<style>'.repeat(300000)}`);
  assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
});

test('external-sender tags are stripped and subject patterns use adjacent words', () => {
  assert.equal(normalizeSubject('[EXT] RE: [EXTERNAL] FW: Invoice 48213'), 'Invoice 48213');
  assert.equal(subjectPattern('2024-05-01 Weekly report 3 of 5 final'), 'Weekly report');
  assert.equal(subjectPattern('#4471 Server down alert 2 critical'), 'Server down alert');
});

test('find-similar date window is in local days around the label date', () => {
  const d = new Date(2026, 2, 10, 23, 30);
  const s = suggestionsFor({ date: d, headers: new Map() }).find((x) => x.id === 'date-window');
  assert.deepEqual([s.criteria.date1, s.criteria.date2], ['2026-03-03', '2026-03-17']);
});
