// Plain-English description of what a set of criteria finds.
// Shown under the generated queries and under every library search.

import { splitList, words } from './query.js';
import { parseFileTypes, labelFor } from './filetypes.js';

function list(items, joiner = 'or') {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1]}`;
}

function people(value) {
  return list(splitList(value));
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
    case 'older': return Number(c.days) > 0 ? `${verb} more than ${Number(c.days)} days ago` : '';
    case 'within': return Number(c.days) > 0 ? `${verb} in the last ${Number(c.days)} days` : '';
    case 'ago': {
      const [a, b] = [Number(c.days), Number(c.days2)].sort((x, y) => x - y);
      return Number.isFinite(a) && Number.isFinite(b) && c.days !== undefined && c.days2 !== undefined ? `${verb} between ${a} and ${b} days ago` : '';
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
  if (String(c.phrase ?? '').trim()) clauses.push(`containing the phrase "${String(c.phrase).replace(/"/g, '').trim()}"`);
  const any = wordsOf(c.anyWords);
  if (any.length) clauses.push(`mentioning ${list(any.map((w) => `"${w}"`))}`);
  const none = wordsOf(c.noneWords);
  if (none.length) clauses.push(`not mentioning ${list(none.map((w) => `"${w}"`))}`);

  if (String(c.subject ?? '').trim()) clauses.push(`with "${c.subject.trim()}" in the subject`);
  if (String(c.body ?? '').trim()) clauses.push(`with "${c.body.trim()}" in the body`);
  const types = parseFileTypes(c.fileTypes);
  if (types.length) clauses.push(`with ${list(types.map(labelFor))} attachments`);
  else if (c.hasAttachments === 'yes') clauses.push('with attachments');
  else if (c.hasAttachments === 'no') clauses.push('without attachments');
  if (String(c.attachmentName ?? '').trim()) clauses.push(`with an attachment named like "${c.attachmentName.trim()}"`);
  if (String(c.category ?? '').trim()) clauses.push(`in the "${c.category.trim()}" category`);

  const date = datePhrase(c);
  if (date) clauses.push(date);

  const mb = Number(c.sizeMb);
  if ((c.sizeOp === '>' || c.sizeOp === '<') && c.sizeMb !== '' && c.sizeMb != null && Number.isFinite(mb)) {
    clauses.push(`${c.sizeOp === '>' ? 'larger' : 'smaller'} than ${mb} MB`);
  }

  if (!adjectives.length && !clauses.length) return '';
  const subject = adjectives.length ? `${list(adjectives, 'and')} messages` : 'messages';
  const sentence = [`Finds ${subject}`, ...clauses].join(' ');
  return `${sentence.replace(/\s+/g, ' ').trim()}.`;
}
