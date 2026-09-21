// Turns form criteria into Outlook search query text, one variant per client.
//
// Two search engines matter:
//  - "classic": Outlook for Windows (classic), Instant Search / AQS.
//  - "modern":  new Outlook for Windows, Outlook on the web and Outlook for Mac, which share
//               the Outlook on the web keyword table. Outlook mobile has no documented syntax,
//               so it gets the modern query plus a plain-keyword fallback.
// Support levels come from Microsoft's support pages; see docs/SYNTAX.md for sources.

export const CLIENTS = [
  { key: 'classic', label: 'Outlook Classic (Windows)', engine: 'classic' },
  { key: 'modern', label: 'New Outlook for Windows / Outlook on the web', engine: 'modern' },
  { key: 'mac', label: 'Outlook for Mac', engine: 'modern' },
  { key: 'mobile', label: 'Outlook mobile (iOS / Android)', engine: 'modern' },
];

const PRESETS_DOCUMENTED_MODERN = new Set(['today', 'yesterday', 'this week', 'last week']);
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

function words(value) {
  return String(value ?? '').replace(/"/g, '').split(/\s+/).filter(Boolean);
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

function keywordTerms(keyword, value) {
  return splitList(value).map(quote).filter(Boolean).map((v) => `${keyword}:${v}`);
}

function wordParts(c, engine) {
  const parts = [];
  parts.push(...words(c.allWords));
  if (quote(c.phrase)) parts.push(`"${quote(c.phrase).replace(/"/g, '')}"`);
  parts.push(orGroup(words(c.anyWords)));
  const exclude = words(c.noneWords);
  parts.push(...exclude.map((w) => (engine === 'classic' ? `NOT ${w}` : `-${w}`)));
  return parts;
}

function peopleParts(c, engine, warn) {
  const parts = ['from', 'to', 'cc', 'bcc'].map((k) => orGroup(keywordTerms(k, c[k])));
  const people = splitList(c.participants).map(quote).filter(Boolean);
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
  if (quote(c.subject)) parts.push(`subject:${quote(c.subject)}`);
  if (quote(c.body)) {
    parts.push(`body:${quote(c.body)}`);
    if (engine === 'classic') warn('body: is not on Microsoft\'s list for classic Outlook. If it returns nothing, put the words in "All of these words".');
  }
  if (quote(c.attachmentName)) {
    parts.push(`attachment:${quote(c.attachmentName)}`);
    if (engine !== 'classic') warn('Searching by attachment name is not documented here. If it returns nothing, use the Attachments filter instead.');
  }
  if (c.hasAttachments === 'yes' || c.hasAttachments === 'no') parts.push(`hasattachment:${c.hasAttachments}`);
  return parts;
}

function dateParts(c, engine, warn) {
  const field = c.dateField === 'sent' ? 'sent' : 'received';
  const mode = c.dateMode || '';
  if (!mode) return [];

  if (mode === 'preset') {
    const preset = String(c.datePreset || 'today');
    if (engine === 'modern' && !PRESETS_DOCUMENTED_MODERN.has(preset)) {
      warn(`"${preset}" is not on Microsoft's list of date words for this Outlook. Use a date range if it returns nothing.`);
    }
    return [`${field}:${quote(preset)}`];
  }

  // Classic reads dates in the Windows regional format; the new engine documents MM/DD/YYYY only.
  const fmt = engine === 'classic' ? (c.dateFormat || 'mdy') : 'mm/dd';
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
    if (mode === 'after') return [`${field}:${formatDate(d1, fmt)}..${formatDate(RANGE_CEILING, fmt)}`];
    if (mode === 'before') return [`${field}:${formatDate(RANGE_FLOOR, fmt)}..${formatDate(previousDay(d1), fmt)}`];
  }

  if (mode === 'between') {
    if (!formatDate(d2, fmt)) {
      warn('Pick the second date to include the date range.');
      return [];
    }
    if (d2 < d1) [d1, d2] = [d2, d1];
    return engine === 'classic'
      ? [`${field}:>=${formatDate(d1, fmt)} AND ${field}:<=${formatDate(d2, fmt)}`]
      : [`${field}:${formatDate(d1, fmt)}..${formatDate(d2, fmt)}`];
  }
  return [];
}

function statusParts(c, engine, warn) {
  const parts = [];
  if (c.read === 'yes' || c.read === 'no') {
    if (engine === 'classic') parts.push(`read:${c.read}`);
    else {
      parts.push(`isread:${c.read}`);
      warn('isread: is not documented here. If it returns nothing, use the Unread filter instead.');
    }
  }
  if (c.flagged === 'yes') parts.push(engine === 'classic' ? 'hasflag:true' : 'isflagged:yes');
  if (['high', 'normal', 'low'].includes(c.importance)) {
    parts.push(`importance:${c.importance}`);
    if (engine !== 'classic') warn('importance: is not documented here. If it returns nothing, use the Filters menu instead.');
  }
  if (quote(c.category)) parts.push(`category:${quote(c.category)}`);
  const mb = Number(c.sizeMb);
  if ((c.sizeOp === '>' || c.sizeOp === '<') && c.sizeMb !== '' && c.sizeMb != null && Number.isFinite(mb) && mb >= 0) {
    if (engine === 'classic') {
      const size = mb < 1 ? `${Math.round(mb * KB_PER_MB)} KB` : `${+mb.toFixed(1)} MB`;
      parts.push(`messagesize:${c.sizeOp}${size}`);
    } else {
      warn('Size searches are only supported in Outlook Classic, so size was left out.');
    }
  }
  return parts;
}

function scopeText(c) {
  const folder = String(c.folder ?? '').trim();
  return folder ? `Search is scoped by folder, not by query text. Open or select the "${folder}" folder first, then set the search scope to Current folder.` : '';
}

export function render(clientKey, criteria) {
  const client = CLIENTS.find((x) => x.key === clientKey);
  if (!client) throw new Error(`Unknown client: ${clientKey}`);
  const c = criteria || {};
  const engine = client.engine;
  const warnings = [];
  const warn = (msg) => { if (!warnings.includes(msg)) warnings.push(msg); };

  const parts = [
    ...wordParts(c, engine),
    ...peopleParts(c, engine, warn),
    ...contentParts(c, engine, warn),
    ...dateParts(c, engine, warn),
    ...statusParts(c, engine, warn),
  ].filter(Boolean);

  const result = { query: parts.join(' '), warnings, scope: scopeText(c) };

  if (clientKey === 'mobile' && result.query) {
    result.fallback = [
      ...wordParts(c, engine).filter((p) => p && !p.startsWith('-') && !p.startsWith('(')),
      ...['from', 'to', 'cc', 'bcc', 'participants'].flatMap((k) => splitList(c[k]).map(quote)),
      quote(c.subject),
    ].filter(Boolean).join(' ');
    result.warnings.unshift('Outlook mobile does not document search keywords. If this returns nothing, search the plain keywords instead and narrow with the Filters button.');
  }
  return result;
}

export function renderAll(criteria) {
  return Object.fromEntries(CLIENTS.map((c) => [c.key, render(c.key, criteria)]));
}

// Flat query strings per client, used by CSV export.
export function renderQueries(criteria) {
  return Object.fromEntries(CLIENTS.map((c) => [c.key, render(c.key, criteria).query]));
}
