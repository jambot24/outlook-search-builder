// Reads a dropped .eml or .msg file in the browser and suggests "find similar" criteria.
// Nothing is uploaded or stored: the file is read into memory, parsed, and discarded.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 7;

// ---------- .eml (RFC 5322 / MIME) ----------

function decodeBytes(bytes, charset = 'utf-8') {
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function base64ToBytes(s) {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
  try {
    return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function qpToBytes(s, { header = false } = {}) {
  const text = header ? s.replace(/_/g, ' ') : s.replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    const hex = text.slice(i + 1, i + 3);
    if (text[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      out.push(parseInt(hex, 16));
      i += 2;
    } else {
      const code = text.charCodeAt(i);
      if (code < 128) out.push(code);
      else out.push(...new TextEncoder().encode(text[i]));
    }
  }
  return new Uint8Array(out);
}

// RFC 2047 encoded words: =?charset?B|Q?text?=
export function decodeHeaderValue(value) {
  return String(value ?? '')
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, text) => {
      const bytes = enc.toUpperCase() === 'B' ? base64ToBytes(text) : qpToBytes(text, { header: true });
      return decodeBytes(bytes, charset.replace(/\*.*$/, ''));
    });
}

// Returns [headersMap, body]. Header names are lower-cased; repeated headers keep the first value.
function splitHeaders(raw) {
  const m = /\r?\n\r?\n/.exec(raw);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : '';
  const headers = new Map();
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(i + 1).trim());
  }
  return [headers, body];
}

export function parseHeaderBlock(text) {
  return splitHeaders(`${String(text ?? '').trim()}\r\n\r\n`)[0];
}

function headerParams(value) {
  const [main, ...rest] = String(value ?? '').split(';');
  const params = {};
  for (const p of rest) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    const key = p.slice(0, i).trim().toLowerCase();
    let v = p.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
    if (key.endsWith('*')) {
      // RFC 2231: charset'lang'percent-encoded
      const m = /^([^']*)'[^']*'(.*)$/.exec(v);
      try { v = decodeURIComponent(m ? m[2] : v); } catch { /* keep raw */ }
      params[key.replace(/\*(\d+\*?)?$/, '')] = (params[key.replace(/\*(\d+\*?)?$/, '')] || '') + v;
    } else {
      params[key] = decodeHeaderValue(v);
    }
  }
  return { value: main.trim().toLowerCase(), params };
}

function decodePartBody(body, encoding, charset) {
  const enc = String(encoding || '').toLowerCase();
  if (enc === 'base64') return decodeBytes(base64ToBytes(body), charset);
  if (enc === 'quoted-printable') return decodeBytes(qpToBytes(body), charset);
  return body;
}

const MAX_PARTS = 200;

function walkMime(raw, acc, depth = 0) {
  if (depth > 10 || acc.parts > MAX_PARTS) return;
  acc.parts += 1;
  const [headers, body] = splitHeaders(raw);
  const type = headerParams(headers.get('content-type') || 'text/plain');
  const disposition = headerParams(headers.get('content-disposition') || '');
  const filename = disposition.params.filename || type.params.name;

  if (type.value.startsWith('multipart/') && type.params.boundary) {
    const b = `--${type.params.boundary}`;
    const chunks = body.split(b).slice(1);
    for (const chunk of chunks) {
      if (chunk.startsWith('--')) break;
      walkMime(chunk.replace(/^\r?\n/, ''), acc, depth + 1);
    }
    return;
  }
  if (type.value === 'message/rfc822') {
    acc.attachments.push(filename || 'Attached message.eml');
    return;
  }
  if (filename || disposition.value === 'attachment') {
    acc.attachments.push(filename || 'attachment');
    return;
  }
  const text = decodePartBody(body, headers.get('content-transfer-encoding'), type.params.charset);
  if (type.value === 'text/plain' && !acc.text) acc.text = text.trim();
  if (type.value === 'text/html' && !acc.html) acc.html = text;
}

// "Jane Doe" <jane@contoso.com>, bob@x.com  ->  [{ name, address }]
export function parseAddressList(value) {
  const out = [];
  const s = decodeHeaderValue(value);
  const re = /(?:(?:"([^"]*)"|([^"<,]*?))\s*<([^>]+)>)|([^\s,<>"]+@[^\s,<>"]+)/g;
  let m;
  while ((m = re.exec(s))) {
    const address = (m[3] || m[4] || '').trim().toLowerCase();
    if (address.includes('@')) out.push({ name: (m[1] ?? m[2] ?? '').trim(), address });
  }
  return out;
}

export function parseEml(raw) {
  const [headers] = splitHeaders(raw);
  const acc = { text: '', html: '', attachments: [], parts: 0 };
  walkMime(raw, acc);
  const date = new Date(headers.get('date') || '');
  return {
    from: parseAddressList(headers.get('from'))[0] || null,
    to: parseAddressList(headers.get('to')),
    cc: parseAddressList(headers.get('cc')),
    replyTo: parseAddressList(headers.get('reply-to'))[0] || null,
    subject: decodeHeaderValue(headers.get('subject') || '').trim(),
    date: Number.isNaN(date.getTime()) ? null : date,
    attachments: acc.attachments,
    headers,
    bodyText: acc.text || htmlToText(acc.html),
  };
}

function htmlToText(html) {
  return String(html || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

// ---------- .msg (Outlook compound file) ----------

const RECIPIENT_TYPE = { 1: 'to', 2: 'cc', 3: 'bcc', to: 'to', cc: 'cc', bcc: 'bcc' };

export function fromMsgData(data) {
  const headers = parseHeaderBlock(data.headers || '');
  const recipients = (data.recipients || []).map((r) => ({
    name: r.name || '',
    address: String(r.smtpAddress || r.email || '').toLowerCase(),
    type: RECIPIENT_TYPE[r.recipType] || 'to',
  })).filter((r) => r.address.includes('@'));
  const fromAddress = String(data.senderSmtpAddress || data.senderEmail || '').toLowerCase();
  const dateText = data.messageDeliveryTime || data.clientSubmitTime || headers.get('date') || '';
  const date = new Date(dateText);
  return {
    from: fromAddress.includes('@') ? { name: data.senderName || '', address: fromAddress } : (parseAddressList(headers.get('from'))[0] || null),
    to: recipients.filter((r) => r.type === 'to').map(({ name, address }) => ({ name, address })),
    cc: recipients.filter((r) => r.type === 'cc').map(({ name, address }) => ({ name, address })),
    replyTo: parseAddressList(headers.get('reply-to'))[0] || null,
    subject: String(data.subject || '').trim(),
    date: Number.isNaN(date.getTime()) ? null : date,
    attachments: (data.attachments || []).map((a) => a.fileName || a.name || 'attachment').filter(Boolean),
    headers,
    bodyText: String(data.body || ''),
  };
}

async function parseMsg(buffer) {
  const { MsgReader } = await import('../vendor/msgreader.js');
  const data = new MsgReader(buffer).getFileData();
  if (data.error) throw new Error('That .msg file could not be read.');
  return fromMsgData(data);
}

export async function readEmailFile(file) {
  if (!file) throw new Error('No file was dropped.');
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is over 25 MB. Try a message without large attachments.');
  const name = String(file.name || '').toLowerCase();
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // .msg files are OLE compound files: D0 CF 11 E0.
  const isMsg = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (isMsg) return parseMsg(buffer);
  if (name.endsWith('.msg')) throw new Error('That .msg file is damaged or not an Outlook message.');
  // Latin-1 keeps every byte, so encoded parts decode correctly later.
  const raw = new TextDecoder('latin1').decode(bytes);
  if (!/^[\w-]+:/m.test(raw.slice(0, 2000))) throw new Error('That does not look like an email. Drop an .eml or .msg file.');
  return parseEml(raw);
}

// ---------- suggestions ----------

const FREE_MAIL = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'msn.com', 'proton.me', 'protonmail.com', 'gmx.com']);

export function normalizeSubject(subject) {
  let s = String(subject || '').trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/^\s*((re|fw|fwd|aw|wg|sv|vs|tr|rif|antw)\s*(\[\d+\])?\s*:\s*)+/i, '').trim();
  } while (s !== prev);
  return s.replace(/\s+/g, ' ');
}

// The stable part of a subject that carries numbers, e.g. "Invoice 48213 from Contoso" -> "Invoice".
export function subjectPattern(subject) {
  const words = normalizeSubject(subject).replace(/[[\](){}#:|]/g, ' ').split(/\s+/).filter(Boolean);
  const firstDigit = words.findIndex((w) => /\d/.test(w));
  if (firstDigit < 0) return '';
  const before = words.slice(0, firstDigit);
  const after = words.slice(firstDigit + 1).filter((w) => !/\d/.test(w));
  const pick = before.length ? before : after;
  return pick.slice(0, 5).join(' ');
}

function isoDay(date, offsetDays) {
  return new Date(date.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

function extension(name) {
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

// Facts from headers that Outlook search cannot use directly, stated so the user knows what we saw.
export function headerFacts(email) {
  const h = email.headers || new Map();
  const facts = [];
  if (h.has('list-unsubscribe') || h.has('list-id')) facts.push(`Sent to a mailing list${h.get('list-id') ? ` (${decodeHeaderValue(h.get('list-id')).replace(/[<>]/g, '')})` : ''}.`);
  const auto = h.get('auto-submitted');
  if (auto && auto.toLowerCase() !== 'no') facts.push('Sent automatically, not by a person (Auto-Submitted header).');
  if ((h.get('precedence') || '').toLowerCase().match(/bulk|list|junk/)) facts.push(`Marked as bulk mail (Precedence: ${h.get('precedence')}).`);
  if (email.replyTo && email.from && email.replyTo.address !== email.from.address) facts.push(`Replies go to ${email.replyTo.address}, not the sender.`);
  const mailer = h.get('x-mailer') || h.get('user-agent');
  if (mailer) facts.push(`Sent with ${decodeHeaderValue(mailer).slice(0, 60)}.`);
  const auth = h.get('authentication-results') || '';
  const spf = /spf=(\w+)/i.exec(auth);
  const dkim = /dkim=(\w+)/i.exec(auth);
  const dmarc = /dmarc=(\w+)/i.exec(auth);
  if (spf || dkim || dmarc) {
    facts.push(`Sender checks: ${[spf && `SPF ${spf[1]}`, dkim && `DKIM ${dkim[1]}`, dmarc && `DMARC ${dmarc[1]}`].filter(Boolean).join(', ')}.`);
  }
  return facts;
}

// Each suggestion carries the criteria it adds. Suggestions in the same group are alternatives.
export function suggestionsFor(email) {
  const out = [];
  const add = (s) => out.push({ checked: false, group: null, ...s });
  const listMail = email.headers?.has('list-unsubscribe') || email.headers?.has('list-id');

  if (email.from?.address) {
    const domain = email.from.address.split('@')[1];
    add({ id: 'from', group: 'sender', label: `From ${email.from.address}`, criteria: { from: email.from.address }, checked: true });
    if (domain && !FREE_MAIL.has(domain)) {
      add({ id: 'from-domain', group: 'sender', label: `From anyone at ${domain}`, criteria: { from: domain } });
    }
  }

  const subject = normalizeSubject(email.subject);
  if (subject) {
    const pattern = subjectPattern(email.subject);
    add({ id: 'subject', group: 'subject', label: `Same subject: "${subject}"`, criteria: { subject }, checked: !pattern && !listMail });
    if (pattern && pattern.toLowerCase() !== subject.toLowerCase()) {
      add({ id: 'subject-pattern', group: 'subject', label: `Similar subject: "${pattern}" (numbers left out)`, criteria: { subject: pattern }, checked: true });
    }
  }

  if (email.to?.length === 1 && email.to[0].address) {
    add({ id: 'to', label: `Sent to ${email.to[0].address}`, criteria: { to: email.to[0].address } });
  }

  if (email.attachments?.length) {
    add({ id: 'attachments', label: `Has attachments (${email.attachments.length} in this email)`, criteria: { hasAttachments: 'yes' }, checked: true });
    const ext = extension(email.attachments[0]);
    if (ext) add({ id: 'attachment-type', label: `Has a .${ext} attachment`, criteria: { hasAttachments: 'yes', attachmentName: ext } });
  }

  if (listMail) {
    add({ id: 'newsletter', label: 'Other mailing-list mail (contains "unsubscribe")', criteria: { allWords: 'unsubscribe' } });
  }

  if (email.date) {
    add({
      id: 'date-window',
      label: `Received within ${WINDOW_DAYS} days of ${email.date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`,
      criteria: { dateMode: 'between', date1: isoDay(email.date, -WINDOW_DAYS), date2: isoDay(email.date, WINDOW_DAYS) },
    });
  }
  return out;
}

// Merges the checked suggestions into one criteria object.
export function combine(suggestions, checkedIds) {
  const criteria = {};
  for (const s of suggestions) {
    if (!checkedIds.has(s.id)) continue;
    for (const [k, v] of Object.entries(s.criteria)) {
      if (k === 'allWords' && criteria.allWords) criteria.allWords = `${criteria.allWords} ${v}`;
      else criteria[k] = v;
    }
  }
  return criteria;
}
