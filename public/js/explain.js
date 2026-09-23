// Plain-English description of what a set of criteria finds.
// Shown under the generated queries and under every library search.

import { splitList, words, isDomain, validDays, validSizeMb } from './query.js';
import { parseFileTypes, labelFor } from './filetypes.js';

function list(items, joiner = 'or') {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1]}`;
}

function people(value) {
  return list(splitList(value).map((v) => (isDomain(v) ? `anyone at ${v.replace(/^@/, '').toLowerCase()}` : v)));
}

function wordsOf(value) {
  return words(value).map((w) => w.replace(/"/g, ''));
}

function niceDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function datePhrase(c) {
  const verb = c.dateField === 'sent' ? 'sent' : 'received';
  const d1 = niceDate(c.date1);
  const d2 = niceDate(c.date2);
  switch (c.dateMode) {
    case 'preset': return `${verb} ${c.datePreset || 'today'}`;
    case 'on': return d1 ? `${verb} on ${d1}` : '';
    case 'after': return d1 ? `${verb} on or after ${d1}` : '';
    case 'before': return d1 ? `${verb} before ${d1}` : '';
    case 'older': return validDays(c.days) ? `${verb} more than ${validDays(c.days)} days ago` : '';
    case 'within': return validDays(c.days) ? `${verb} in the last ${validDays(c.days)} days` : '';
    case 'ago': {
      const a = validDays(c.days, { min: 0 });
      const b = validDays(c.days2, { min: 0 });
      if (a === null || b === null) return '';
      return `${verb} between ${Math.min(a, b)} and ${Math.max(a, b)} days ago`;
    }
    case 'between': {
      if (!d1 || !d2) return '';
      const [a, b] = c.date1 <= c.date2 ? [d1, d2] : [d2, d1];
      return `${verb} between ${a} and ${b}`;
    }
    default: return '';
  }
}

export function explain(criteria) {
  const c = criteria || {};
  const adjectives = [];
  if (c.read === 'no') adjectives.push('unread');
  if (c.read === 'yes') adjectives.push('read');
  if (c.flagged === 'yes') adjectives.push('flagged');
  if (['high', 'low'].includes(c.importance)) adjectives.push(`${c.importance}-importance`);
  if (c.importance === 'normal') adjectives.push('normal-importance');

  const clauses = [];
  if (splitList(c.from).length) clauses.push(`from ${people(c.from)}`);
  if (splitList(c.to).length) clauses.push(`sent to ${people(c.to)}`);
  if (splitList(c.cc).length) clauses.push(`with ${people(c.cc)} on Cc`);
  if (splitList(c.bcc).length) clauses.push(`with ${people(c.bcc)} on Bcc`);
  if (splitList(c.participants).length) clauses.push(`involving ${people(c.participants)}`);

  const all = wordsOf(c.allWords);
  if (all.length) clauses.push(`containing ${list(all.map((w) => `"${w}"`), 'and')}`);
  const phrase = String(c.phrase ?? '').replace(/["*]/g, '').trim().replace(/\s+/g, ' ');
  if (phrase) clauses.push(`containing the phrase "${phrase}"`);
  const any = wordsOf(c.anyWords);
  if (any.length) clauses.push(`mentioning ${list(any.map((w) => `"${w}"`))}`);
  const none = wordsOf(c.noneWords);
  if (none.length) clauses.push(`not mentioning ${list(none.map((w) => `"${w}"`))}`);

  const field = (value, mode, where) => {
    const v = String(value ?? '').replace(/"/g, '').trim().replace(/\s+/g, ' ');
    if (!v) return '';
    if (mode === 'starts' && !/\s/.test(v)) return `with ${where} starting with "${v}"`;
    if (mode === 'all' && /\s/.test(v)) return `with the words ${list(v.split(' ').map((w) => `"${w}"`), 'and')} in ${where}`;
    return `with "${v}" in ${where}`;
  };
  for (const clause of [
    field(c.subject, c.subjectMode, 'the subject'),
    field(c.body, c.bodyMode, 'the body'),
  ]) if (clause) clauses.push(clause);
  const types = parseFileTypes(c.fileTypes);
  if (types.length) clauses.push(`with ${list(types.map(labelFor))} attachments`);
  else if (c.hasAttachments === 'yes') clauses.push('with attachments');
  else if (c.hasAttachments === 'no') clauses.push('without attachments');
  const attachmentClause = field(c.attachmentName, c.attachmentMode, 'the attachment name');
  if (attachmentClause) clauses.push(attachmentClause);
  if (String(c.category ?? '').trim()) clauses.push(`in the "${c.category.trim()}" category`);

  const date = datePhrase(c);
  if (date) clauses.push(date);

  const mb = validSizeMb(c);
  if (mb !== null) {
    clauses.push(`${c.sizeOp === '>' ? 'larger' : 'smaller'} than ${mb} MB`);
  }

  if (!adjectives.length && !clauses.length) return '';
  const subject = adjectives.length ? `${list(adjectives, 'and')} messages` : 'messages';
  const sentence = [`Finds ${subject}`, ...clauses].join(' ');
  return `${sentence.replace(/\s+/g, ' ').trim()}.`;
}
