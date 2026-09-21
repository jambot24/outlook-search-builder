import { typeForExtension, labelFor } from './filetypes.js';

// Reads a dropped .eml or .msg file in the browser and suggests "find similar" criteria.
// Nothing is uploaded or stored: the file is read into memory, parsed, and discarded.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 7;
// Caps that keep a crafted file from freezing the page. Real headers and bodies are far smaller.
const MAX_HEADER_CHARS = 16 * 1024;
const MAX_HTML_CHARS = 256 * 1024;

// ---------- .eml (RFC 5322 / MIME) ----------

function decodeBytes(bytes, charset = 'utf-8') {
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// The file is held as a "binary string": one character per byte (codes 0-255).
export function bytesToBinary(bytes) {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return out;
}

function binaryToBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

// Unencoded 8-bit text: use the declared charset, otherwise UTF-8 if it is valid, otherwise Windows-1252.
function decodeRaw(str, charset) {
  if (!/[\x80-\xff]/.test(str)) return str;
  const bytes = binaryToBytes(str);
  if (charset) return decodeBytes(bytes, charset);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return decodeBytes(bytes, 'windows-1252');
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
      out.push(text.charCodeAt(i) & 0xff);
    }
  }
  return new Uint8Array(out);
}

// RFC 2047 encoded words: =?charset?B|Q?text?=
// Adjacent encoded words in the same charset are decoded together, because a multi-byte
// character may be split across them.
export function decodeHeaderValue(value) {
  const raw = decodeRaw(String(value ?? ''));
  const re = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=(?:\s+(?==\?))?/g;
  let out = '';
  let last = 0;
  let pending = null; // { charset, bytes: [] }
  const flush = () => {
    if (pending) out += decodeBytes(new Uint8Array(pending.bytes), pending.charset);
    pending = null;
  };
  let m;
  while ((m = re.exec(raw))) {
    if (m.index > last) { flush(); out += raw.slice(last, m.index); }
    const charset = m[1].replace(/\*.*$/, '').toLowerCase();
    const bytes = m[2].toUpperCase() === 'B' ? base64ToBytes(m[3]) : qpToBytes(m[3], { header: true });
    if (pending && pending.charset !== charset) flush();
    if (!pending) pending = { charset, bytes: [] };
    for (const b of bytes) pending.bytes.push(b);
    last = re.lastIndex;
  }
  flush();
  return out + raw.slice(last);
}

// Returns [headersMap, body]. Header names are lower-cased; repeated headers keep the first value.
function splitHeaders(raw) {
  // A part that starts with a blank line has no headers at all.
  const empty = /^\r?\n/.exec(raw);
  if (empty) return [new Map(), raw.slice(empty[0].length)];
  const m = /\r?\n\r?\n/.exec(raw);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : '';
  const headers = new Map();
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(i + 1, i + 1 + MAX_HEADER_CHARS).trim());
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
  return decodeRaw(body, charset);
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
  if (type.value === 'text/html' && !acc.html) acc.html = text.slice(0, MAX_HTML_CHARS);
}

// "Jane Doe" <jane@contoso.com>, bob@x.com  ->  [{ name, address }]
// A single pass over the characters: commas inside quotes or <...> do not split, and group
// syntax ("Team: a@x.com, b@x.com;") is unwrapped.
export function parseAddressList(value) {
  const s = decodeHeaderValue(value).slice(0, MAX_HEADER_CHARS);
  const pieces = [];
  let cur = '';
  let inQuote = false;
  let inAngle = false;
  for (const ch of s) {
    if (ch === '"' && !inAngle) inQuote = !inQuote;
    else if (ch === '<' && !inQuote) inAngle = true;
    else if (ch === '>' && !inQuote) inAngle = false;
    if ((ch === ',' || ch === ';') && !inQuote && !inAngle) {
      pieces.push(cur);
      cur = '';
    } else if (ch === ':' && !inQuote && !inAngle && !cur.includes('@')) {
      cur = ''; // group label
    } else {
      cur += ch;
    }
  }
  pieces.push(cur);

  const out = [];
  for (const piece of pieces) {
    const p = piece.trim();
    if (!p) continue;
    const lt = p.lastIndexOf('<');
    const gt = p.lastIndexOf('>');
    let address;
    let name = '';
    if (lt >= 0 && gt > lt) {
      address = p.slice(lt + 1, gt);
      name = p.slice(0, lt).trim().replace(/^"(.*)"$/, '$1').trim();
    } else {
      address = p.split(/\s+/).find((w) => w.includes('@')) || '';
    }
    address = address.trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (/^[^\s@]+@[^\s@]+$/.test(address)) out.push({ name, address });
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

function stripBlocks(html, tag) {
  // indexOf-based, so an unclosed <style> costs one scan instead of one scan per occurrence.
  const lower = html.toLowerCase();
  let out = '';
  let i = 0;
  for (;;) {
    const start = lower.indexOf(`<${tag}`, i);
    if (start < 0) return out + html.slice(i);
    out += `${html.slice(i, start)} `;
    const end = lower.indexOf(`</${tag}>`, start);
    if (end < 0) return out;
    i = end + tag.length + 3;
  }
}

function htmlToText(html) {
  const text = stripBlocks(stripBlocks(String(html || '').slice(0, MAX_HTML_CHARS), 'style'), 'script');
  return text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
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
  // One character per byte, so each part can be decoded with its own charset later.
  // (TextDecoder('latin1') is really Windows-1252 in browsers and would alter bytes 0x80-0x9F.)
  const raw = bytesToBinary(bytes);
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
    s = s.replace(/^\s*\[(ext|external|extern|external email|caution|spam|suspicious)[^\]]*\]\s*/i, '').trim();
  } while (s !== prev);
  return s.replace(/\s+/g, ' ');
}

// The stable part of a subject that carries numbers, e.g. "Invoice 48213 from Contoso" -> "Invoice".
export function subjectPattern(subject) {
  const words = normalizeSubject(subject).replace(/[[\](){}#:|]/g, ' ').split(/\s+/)
    .filter((w) => /[\p{L}\d]/u.test(w));
  if (!words.some((w) => /\d/.test(w))) return '';
  // The first run of adjacent words with no digits, so the phrase can match the real subject.
  const runs = [];
  let run = [];
  for (const w of words) {
    if (/\d/.test(w)) { if (run.length) runs.push(run); run = []; } else run.push(w);
  }
  if (run.length) runs.push(run);
  const pick = runs[0] || [];
  return pick.slice(0, 5).join(' ');
}

// Local calendar day, matching the date shown in the label.
function isoDay(date, offsetDays) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    const types = [...new Set(email.attachments.map((a) => typeForExtension(extension(a))).filter(Boolean))];
    if (types.length) {
      add({ id: 'attachment-type', label: `Has ${types.map(labelFor).join(' or ')} attachments`, criteria: { fileTypes: types.join(',') } });
    }
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
