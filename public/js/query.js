// Turns form criteria into Outlook search query text, one variant per client.
//
// Two search engines matter:
//  - "classic": Outlook for Windows (classic), Instant Search / AQS.
//  - "modern":  new Outlook for Windows, Outlook on the web and Outlook for Mac, which share
//               the Outlook on the web keyword table. Outlook mobile has no documented syntax,
//               so it gets the modern query plus a plain-keyword fallback.
// Support levels come from Microsoft's support pages; see docs/SYNTAX.md for sources.

import { parseFileTypes, extensionsFor } from './filetypes.js';

export const CLIENTS = [
  { key: 'classic', label: 'Outlook Classic (Windows)', engine: 'classic' },
  { key: 'modern', label: 'New Outlook for Windows / Outlook on the web', engine: 'modern' },
  { key: 'mac', label: 'Outlook for Mac', engine: 'modern' },
  { key: 'mobile', label: 'Outlook mobile (iOS / Android)', engine: 'modern' },
];

// Date words each engine documents. Other periods are written out as a date range.
const PRESETS_DOCUMENTED = {
  classic: new Set(['today', 'yesterday', 'this week', 'last week', 'last month', 'last year']),
  modern: new Set(['today', 'yesterday', 'this week', 'last week']),
};
const MAX_DAYS = 3650;
const RANGE_FLOOR = '1990-01-01';
const RANGE_CEILING = '2099-12-31';
const KB_PER_MB = 1024;

export function quote(value) {
  const v = String(value ?? '').replace(/"/g, '').trim().replace(/\s+/g, ' ');
  if (!v) return '';
  return /\s/.test(v) ? `"${v}"` : v;
}

export function splitList(value) {
  return String(value ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

// Splits on spaces but keeps "quoted phrases" together: 'unsubscribe "opt out"' -> ['unsubscribe', '"opt out"'].
export function words(value) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(value ?? '')))) {
    if (m[1] !== undefined) {
      const phrase = m[1].trim().replace(/\s+/g, ' ');
      if (phrase) out.push(/\s/.test(phrase) ? `"${phrase}"` : phrase);
    } else {
      const w = m[2].replace(/"/g, '');
      if (w) out.push(w);
    }
  }
  return out;
}

const WILDCARD_WHERE = 'Outlook only supports * at the end of a single word, like migrat*. Other asterisks were removed.';
const WILDCARD_CLASSIC = 'Outlook Classic matches the start of words automatically, so a trailing * was dropped.';

// Applies Outlook's wildcard rules to one word: a trailing * is a prefix match on the modern
// engine, Classic prefix-matches without it, and * anywhere else is unsupported.
export function wildcard(word, engine, warn = () => {}) {
  let w = String(word ?? '');
  const trailing = /\*+$/.test(w);
  const core = w.replace(/\*+$/, '');
  if (core.includes('*')) warn(WILDCARD_WHERE);
  w = core.replace(/\*/g, '');
  if (!w) return '';
  if (!trailing) return w;
  if (engine === 'classic') { warn(WILDCARD_CLASSIC); return w; }
  return `${w}*`;
}

// A field value: several words become a quoted phrase, where wildcards do not work.
function term(value, engine, warn) {
  const v = String(value ?? '').replace(/"/g, '').trim().replace(/\s+/g, ' ');
  if (!v) return '';
  if (/\s/.test(v)) {
    if (v.includes('*')) warn(WILDCARD_WHERE);
    return quote(v.replace(/\*/g, ''));
  }
  return wildcard(v, engine, warn);
}

// iso is "YYYY-MM-DD" from <input type=date>.
export function formatDate(iso, format) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return '';
  const [, y, mo, d] = m;
  if (format === 'iso') return `${y}-${mo}-${d}`;
  if (format === 'dmy') return `${Number(d)}/${Number(mo)}/${y}`;
  if (format === 'mm/dd') return `${mo}/${d}/${y}`;
  return `${Number(mo)}/${Number(d)}/${y}`;
}

function previousDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function orGroup(terms) {
  if (terms.length === 0) return '';
  return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`;
}

function keywordTerms(keyword, value, engine, warn) {
  return splitList(value).map((v) => term(v, engine, warn)).filter(Boolean).map((v) => `${keyword}:${v}`);
}

function wordParts(c, engine, warn = () => {}) {
  const w = (value) => words(value).map((x) => {
    if (!x.startsWith('"')) return wildcard(x, engine, warn);
    if (x.includes('*')) warn(WILDCARD_WHERE);
    return x.replace(/\*/g, '');
  }).filter(Boolean);
  const parts = [];
  parts.push(...w(c.allWords));
  const phrase = String(c.phrase ?? '').replace(/"/g, '').trim();
  if (phrase.includes('*')) warn(WILDCARD_WHERE);
  if (quote(phrase.replace(/\*/g, ''))) parts.push(`"${quote(phrase.replace(/\*/g, '')).replace(/"/g, '')}"`);
  parts.push(orGroup(w(c.anyWords)));
  const exclude = w(c.noneWords);
  // Classic joins with AND, so "AND NOT word" reads correctly there.
  parts.push(...exclude.map((w) => (engine === 'classic' ? `NOT ${w}` : `-${w}`)));
  return parts;
}

function peopleParts(c, engine, warn) {
  const parts = ['from', 'to', 'cc', 'bcc'].map((k) => orGroup(keywordTerms(k, c[k], engine, warn)));
  const people = splitList(c.participants).map((v) => term(v, engine, warn)).filter(Boolean);
  if (people.length) {
    if (engine === 'classic') {
      // Classic does not document participants:, so spell it out with keywords it does document.
      parts.push(orGroup(people.flatMap((p) => [`from:${p}`, `to:${p}`, `cc:${p}`])));
    } else {
      parts.push(orGroup(people.map((p) => `participants:${p}`)));
    }
  }
  if (engine === 'classic' && splitList(c.bcc).length) {
    warn('Bcc only matches messages you sent, because received mail does not carry Bcc.');
  }
  return parts;
}

function contentParts(c, engine, warn) {
  const parts = [];
  if (term(c.subject, engine, warn)) parts.push(`subject:${term(c.subject, engine, warn)}`);
  if (term(c.body, engine, warn)) {
    parts.push(`body:${term(c.body, engine, warn)}`);
    if (engine === 'classic') warn('body: is not on Microsoft\'s list for classic Outlook. If it returns nothing, put the words in "All of these words".');
  }
  if (term(c.attachmentName, engine, warn)) {
    parts.push(`attachment:${term(c.attachmentName, engine, warn)}`);
    if (engine !== 'classic') warn('Searching by attachment name is not documented here. If it returns nothing, use the Attachments filter instead.');
  }
  const types = parseFileTypes(c.fileTypes);
  if (types.length) {
    parts.push(orGroup(extensionsFor(types).map((e) => `attachment:${e}`)));
    if (engine !== 'classic') warn('Searching by attachment name is not documented here. If it returns nothing, use the Attachments filter instead.');
    if (c.hasAttachments === 'no') warn('"No attachments" was ignored because file types are selected.');
    parts.push('hasattachment:yes');
  } else if (c.hasAttachments === 'yes' || c.hasAttachments === 'no') {
    parts.push(`hasattachment:${c.hasAttachments}`);
  }
  return parts;
}

function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Which engines keep a period as a relative word, so a copied or saved query stays current.
export function evergreenSupport(preset) {
  return { classic: PRESETS_DOCUMENTED.classic.has(preset), modern: PRESETS_DOCUMENTED.modern.has(preset) };
}

// A one-line explanation for the date field: does this choice stay current once copied?
export function dateHint(c, now = new Date()) {
  const mode = c?.dateMode || '';
  if (mode === 'preset') {
    const preset = String(c.datePreset || 'today');
    const { classic, modern } = evergreenSupport(preset);
    const name = preset.charAt(0).toUpperCase() + preset.slice(1);
    if (classic && modern) return `"${name}" stays relative in every version, so the query never goes out of date.`;
    const range = presetRange(preset, now);
    const dates = range ? ` (${formatDate(range[0], 'mm/dd')} to ${formatDate(range[1], 'mm/dd')})` : '';
    if (classic) return `"${name}" stays relative in Outlook Classic. New Outlook, the web and Mac do not document it, so they get exact dates${dates}. Saved searches recalculate them.`;
    return `Microsoft does not document "${preset}" in any version, so the query uses exact dates${dates}. Saved searches recalculate them.`;
  }
  if (mode === 'within' || mode === 'older' || mode === 'ago') {
    return 'Outlook has no word for a number of days, so this is written as a date. Saved searches recalculate it. For a query that never goes out of date, pick a relative period instead.';
  }
  return '';
}

// First and last day of a named period, in the user's local calendar.
export function presetRange(preset, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'this month': return [isoLocal(new Date(y, m, 1)), isoLocal(new Date(y, m + 1, 0))];
    case 'last month': return [isoLocal(new Date(y, m - 1, 1)), isoLocal(new Date(y, m, 0))];
    case 'this year': return [`${y}-01-01`, `${y}-12-31`];
    case 'last year': return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    default: return null;
  }
}

function daysAgo(days, now) {
  return isoLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
}

function rangeTerms(field, engine, fmt, from, to) {
  if (engine === 'classic') {
    const parts = [];
    if (from) parts.push(`${field}:>=${formatDate(from, fmt)}`);
    if (to) parts.push(`${field}:<=${formatDate(to, fmt)}`);
    return parts.join(' AND ');
  }
  return `${field}:${formatDate(from || RANGE_FLOOR, fmt)}..${formatDate(to || RANGE_CEILING, fmt)}`;
}

function dateParts(c, engine, warn, note, now) {
  const field = c.dateField === 'sent' ? 'sent' : 'received';
  const mode = c.dateMode || '';
  if (!mode) return [];
  // Classic reads dates in the Windows regional format; the new engine documents MM/DD/YYYY only.
  const fmt = engine === 'classic' ? (c.dateFormat || 'mdy') : 'mm/dd';

  if (mode === 'preset') {
    const preset = String(c.datePreset || 'today');
    if (PRESETS_DOCUMENTED[engine].has(preset)) return [`${field}:${quote(preset)}`];
    const range = presetRange(preset, now);
    if (!range) return [`${field}:${quote(preset)}`];
    note(`"${preset}" is written as dates (${formatDate(range[0], fmt)} to ${formatDate(range[1], fmt)}) because this Outlook does not understand the phrase. Saved searches recalculate it.`);
    return [rangeTerms(field, engine, fmt, range[0], range[1])];
  }

  if (mode === 'ago') {
    let a = Number(c.days);
    let b = Number(c.days2);
    if (![a, b].every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_DAYS)) {
      warn('Enter both numbers of days to include the date filter.');
      return [];
    }
    if (a > b) [a, b] = [b, a];
    note(`"${a} to ${b} days ago" is written as dates, so a saved search recalculates it.`);
    return [rangeTerms(field, engine, fmt, daysAgo(b, now), daysAgo(a, now))];
  }

  if (mode === 'older' || mode === 'within') {
    const days = Number(c.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      warn('Enter a number of days to include the date filter.');
      return [];
    }
    if (mode === 'older') {
      // "More than 30 days ago" = received on or before the day 31 days back.
      note(`"More than ${days} days ago" is written as a date, so a saved search recalculates it.`);
      return [rangeTerms(field, engine, fmt, '', daysAgo(days + 1, now))];
    }
    note(`"In the last ${days} days" is written as a date, so a saved search recalculates it.`);
    return [rangeTerms(field, engine, fmt, daysAgo(days, now), '')];
  }

  let d1 = c.date1;
  let d2 = c.date2;
  if (!formatDate(d1, fmt)) {
    warn('Pick a date to include the date filter.');
    return [];
  }

  if (mode === 'on') return [`${field}:${formatDate(d1, fmt)}`];

  if (engine === 'classic') {
    if (mode === 'after') return [`${field}:>=${formatDate(d1, fmt)}`];
    if (mode === 'before') return [`${field}:<${formatDate(d1, fmt)}`];
  } else {
    if (mode === 'after') return [rangeTerms(field, engine, fmt, d1, '')];
    if (mode === 'before') return [rangeTerms(field, engine, fmt, '', previousDay(d1))];
  }

  if (mode === 'between') {
    if (!formatDate(d2, fmt)) {
      warn('Pick the second date to include the date range.');
      return [];
    }
    if (d2 < d1) [d1, d2] = [d2, d1];
    return [rangeTerms(field, engine, fmt, d1, d2)];
  }
  return [];
}

function statusParts(c, engine, warn) {
  const parts = [];
  if (c.read === 'yes' || c.read === 'no') {
    parts.push(`read:${c.read}`);
    if (engine !== 'classic') warn('read: is documented for Outlook on Windows but not in the web and Mac keyword table. If it returns nothing, use the Unread filter instead.');
  }
  if (c.flagged === 'yes') parts.push(engine === 'classic' ? 'hasflag:true' : 'isflagged:yes');
  if (['high', 'normal', 'low'].includes(c.importance)) {
    parts.push(`importance:${c.importance}`);
    if (engine !== 'classic') warn('importance: is not documented here. If it returns nothing, use the Filters menu instead.');
  }
  if (term(c.category, engine, warn)) parts.push(`category:${term(c.category, engine, warn)}`);
  const mb = Number(c.sizeMb);
  if ((c.sizeOp === '>' || c.sizeOp === '<') && c.sizeMb !== '' && c.sizeMb != null && Number.isFinite(mb) && mb >= 0) {
    const size = mb < 1 ? `${Math.round(mb * KB_PER_MB)} KB` : `${+mb.toFixed(1)} MB`;
    parts.push(`messagesize:${c.sizeOp}${size}`);
    if (engine !== 'classic') warn('messagesize: is documented for Outlook on Windows but not in the web and Mac keyword table. If it returns nothing, sort the message list by size instead.');
  }
  return parts;
}

export const ALL_FOLDERS = 'All folders';
export const COMMON_FOLDERS = ['Inbox', 'Sent Items', 'Drafts', 'Archive', 'Junk Email', 'Deleted Items', 'Outbox', ALL_FOLDERS];

const SCOPE = {
  classic: {
    folder: (f) => `Select the "${f}" folder, then set the scope dropdown next to the search box to Current Folder.`,
    all: 'Set the scope dropdown next to the search box to Current Mailbox (or All Mailboxes to include shared and archive mailboxes).',
    deleted: 'To include Deleted Items: File > Options > Search, tick "Include messages from the Deleted Items folder in each data file when searching in All Items".',
  },
  modern: {
    folder: (f) => `Select the "${f}" folder, then choose Current folder in the scope list at the left of the search box.`,
    all: 'Choose All folders in the scope list at the left of the search box.',
    deleted: 'To include Deleted Items: Settings > General > Search, tick "Include deleted items".',
  },
  mac: {
    folder: (f) => `Select the "${f}" folder, then choose Current Folder in the search scope.`,
    all: 'Choose All Folders (or All Mailboxes) in the search scope.',
    deleted: 'Outlook for Mac has no documented setting for Deleted Items. To be sure, also run the search in the Deleted Items folder.',
  },
  mobile: {
    folder: (f) => `Outlook mobile searches every folder, so results cannot be limited to "${f}".`,
    all: 'Outlook mobile searches every folder.',
    deleted: 'Outlook mobile has no setting for Deleted Items.',
  },
};

function scopeText(c, clientKey) {
  const rules = SCOPE[clientKey];
  const folder = String(c.folder ?? '').trim() || 'Inbox';
  const lines = [folder.toLowerCase() === ALL_FOLDERS.toLowerCase() ? rules.all : rules.folder(folder)];
  if (c.includeDeleted === 'yes' && folder.toLowerCase() !== 'deleted items') lines.push(rules.deleted);
  return lines.join(' ');
}

export function render(clientKey, criteria, { now = new Date() } = {}) {
  const client = CLIENTS.find((x) => x.key === clientKey);
  if (!client) throw new Error(`Unknown client: ${clientKey}`);
  const c = criteria || {};
  const engine = client.engine;
  const warnings = [];
  const warn = (msg) => { if (!warnings.includes(msg)) warnings.push(msg); };
  const notes = [];
  const note = (msg) => { if (!notes.includes(msg)) notes.push(msg); };

  const parts = [
    ...wordParts(c, engine, warn),
    ...peopleParts(c, engine, warn),
    ...contentParts(c, engine, warn),
    ...dateParts(c, engine, warn, note, now),
    ...statusParts(c, engine, warn),
  ].filter(Boolean);

  // Explicit AND: Microsoft's Windows and web/Mac references treat bare spaces differently.
  const result = { query: parts.join(' AND '), warnings, notes, scope: parts.length ? scopeText(c, clientKey) : '' };

  if (clientKey === 'mobile' && result.query) {
    result.fallback = [
      ...wordParts(c, engine).filter((p) => p && !p.startsWith('-') && !p.startsWith('(')),
      ...['from', 'to', 'cc', 'bcc', 'participants'].flatMap((k) => splitList(c[k]).map(quote)),
      quote(c.subject),
    ].filter(Boolean).join(' ').replace(/\*/g, '');
    result.warnings.unshift('Outlook mobile does not document search keywords. If this returns nothing, search the plain keywords instead and narrow with the Filters button.');
  }
  return result;
}

export function renderAll(criteria, opts) {
  return Object.fromEntries(CLIENTS.map((c) => [c.key, render(c.key, criteria, opts)]));
}

// Flat query strings per client, used by CSV export.
export function renderQueries(criteria) {
  return Object.fromEntries(CLIENTS.map((c) => [c.key, render(c.key, criteria).query]));
}
