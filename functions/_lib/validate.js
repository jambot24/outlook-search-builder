// Input rules for community submissions. Shared criteria logic comes from the front end
// so the server and the page agree on what a valid search is.

import { sanitizeCriteria } from '../../public/js/storage.js';
import { renderQueries } from '../../public/js/query.js';
import { CATEGORY_KEYS } from '../../public/js/library.js';
import { parseFileTypes } from '../../public/js/filetypes.js';

export const TITLE_MIN = 3;
export const TITLE_MAX = 80;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 140;

export class ValidationError extends Error {}

const ENUMS = {
  hasAttachments: ['yes', 'no'],
  dateField: ['received', 'sent'],
  dateMode: ['preset', 'on', 'after', 'before', 'between', 'older', 'within'],
  datePreset: ['today', 'yesterday', 'this week', 'last week', 'this month', 'last month', 'this year', 'last year'],
  read: ['yes', 'no'],
  flagged: ['yes'],
  importance: ['high', 'normal', 'low'],
  sizeOp: ['>', '<'],
};
const TEXT_FIELDS = ['allWords', 'phrase', 'anyWords', 'noneWords', 'from', 'to', 'cc', 'bcc', 'participants', 'subject', 'body', 'attachmentName', 'category'];
const DATE_FIELDS = ['date1', 'date2'];
const TEXT_MAX = 200;

// Collapses whitespace and removes control characters.
export function cleanText(value) {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Returns a canonical criteria object. Personal or display-only fields (folder, dateFormat)
// are dropped because they do not change what a shared search finds.
export function validateCriteria(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Search criteria are missing.');
  const raw = sanitizeCriteria(input);
  const out = {};
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (raw[key] === undefined || raw[key] === '') continue;
    if (!allowed.includes(raw[key])) throw new ValidationError(`Invalid value for ${key}.`);
    out[key] = raw[key];
  }
  for (const key of TEXT_FIELDS) {
    const v = cleanText(raw[key]);
    if (v.length > TEXT_MAX) throw new ValidationError(`${key} is too long.`);
    if (v) out[key] = v;
  }
  for (const key of DATE_FIELDS) {
    if (!raw[key]) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw[key])) throw new ValidationError(`Invalid ${key}.`);
    out[key] = raw[key];
  }
  if (raw.days !== undefined && raw.days !== '') {
    const days = Number(raw.days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new ValidationError('Invalid number of days.');
    out.days = String(days);
  }
  if (raw.fileTypes) {
    const types = parseFileTypes(raw.fileTypes);
    if (types.length !== String(raw.fileTypes).split(',').filter((x) => x.trim()).length) throw new ValidationError('Invalid file type.');
    out.fileTypes = types.join(',');
  }
  if (raw.sizeMb !== undefined && raw.sizeMb !== '') {
    const mb = Number(raw.sizeMb);
    if (!Number.isFinite(mb) || mb < 0 || mb > 10000) throw new ValidationError('Invalid size.');
    out.sizeMb = String(mb);
  }
  // Drop settings that only matter together with another field.
  if (!out.dateMode) { delete out.dateField; delete out.datePreset; delete out.date1; delete out.date2; }
  if (out.dateField === 'received') delete out.dateField;
  if (out.dateMode && out.dateMode !== 'preset') delete out.datePreset;
  if (out.dateMode === 'preset') { delete out.date1; delete out.date2; }
  if (out.dateMode === 'older' || out.dateMode === 'within') { delete out.date1; delete out.date2; } else delete out.days;
  if (out.dateMode && out.dateMode !== 'between') delete out.date2;
  if (!out.sizeOp || out.sizeMb === undefined) { delete out.sizeOp; delete out.sizeMb; }

  if (!renderQueries(out).modern) throw new ValidationError('The search is empty. Fill in at least one field.');
  return out;
}

export function criteriaKey(criteria) {
  return JSON.stringify(Object.keys(criteria).sort().map((k) => [k, String(criteria[k]).toLowerCase()]));
}

export function validateTitle(value) {
  const t = cleanText(value);
  if (t.length < TITLE_MIN || t.length > TITLE_MAX) throw new ValidationError(`Title must be ${TITLE_MIN} to ${TITLE_MAX} characters.`);
  return t;
}

export function validateDescription(value, { optional = false } = {}) {
  const t = cleanText(value);
  if (!t && optional) return '';
  if (t.length < DESCRIPTION_MIN || t.length > DESCRIPTION_MAX) {
    throw new ValidationError(`Description must be ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX} characters.`);
  }
  return t;
}

export function validateCategory(value) {
  if (!CATEGORY_KEYS.has(value)) throw new ValidationError('Pick a category.');
  return value;
}

export function validateTarget(type, id) {
  if (type !== 'search' && type !== 'description') throw new ValidationError('Invalid target type.');
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new ValidationError('Invalid target id.');
  return { type, id };
}
