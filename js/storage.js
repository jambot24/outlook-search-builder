// Saved searches: persistence, export and import.
// Storage is injected so the logic can be tested without a browser.

export const STORAGE_KEY = 'osb.savedSearches.v1';
export const EXPORT_FORMAT = 'outlook-search-builder';
export const EXPORT_VERSION = 1;
const MAX_NAME_LENGTH = 120;
const MAX_IMPORT_ITEMS = 1000;

export function loadSaved(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidEntry) : [];
  } catch {
    return [];
  }
}

export function persistSaved(storage, list) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function createEntry(name, criteria, now = new Date()) {
  const trimmed = String(name || '').trim().slice(0, MAX_NAME_LENGTH);
  if (!trimmed) throw new Error('Give the search a name.');
  return {
    id: makeId(),
    name: trimmed,
    criteria: { ...criteria },
    savedAt: now.toISOString(),
  };
}

// Returns a new list. An entry with the same name (case-insensitive) is replaced.
export function upsertEntry(list, entry) {
  const key = entry.name.toLowerCase();
  const rest = list.filter((e) => e.name.toLowerCase() !== key);
  return [entry, ...rest];
}

export function removeEntry(list, id) {
  return list.filter((e) => e.id !== id);
}

export function toExportJson(list, now = new Date()) {
  return JSON.stringify(
    { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now.toISOString(), searches: list },
    null,
    2,
  );
}

// renderQueries(criteria) -> { classic, modern, mac, mobile } query strings.
export function toExportCsv(list, renderQueries) {
  const header = ['Name', 'Saved', 'Outlook Classic', 'New Outlook / Web', 'Outlook for Mac', 'Outlook mobile'];
  const rows = list.map((e) => {
    const q = renderQueries(e.criteria);
    return [e.name, e.savedAt, q.classic, q.modern, q.mac, q.mobile];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// Parses an export file and merges it into the current list.
// Imported entries win over existing entries with the same name.
export function mergeImport(list, text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const items = Array.isArray(parsed) ? parsed : parsed?.searches;
  if (!Array.isArray(items)) throw new Error('That file does not contain saved searches.');
  if (items.length > MAX_IMPORT_ITEMS) throw new Error(`Too many searches (limit ${MAX_IMPORT_ITEMS}).`);

  const valid = items.filter(isValidEntry).map((e) => ({
    id: makeId(),
    name: e.name.trim().slice(0, MAX_NAME_LENGTH),
    criteria: sanitizeCriteria(e.criteria),
    savedAt: typeof e.savedAt === 'string' ? e.savedAt : new Date().toISOString(),
  }));
  const merged = valid.reduceRight((acc, entry) => upsertEntry(acc, entry), list);
  return { list: merged, imported: valid.length, skipped: items.length - valid.length };
}

function isValidEntry(e) {
  return Boolean(e) && typeof e.name === 'string' && e.name.trim() !== ''
    && Boolean(e.criteria) && typeof e.criteria === 'object' && !Array.isArray(e.criteria);
}

// Criteria are flat string fields. Anything else from a file is dropped.
export function sanitizeCriteria(criteria) {
  const out = {};
  for (const [k, v] of Object.entries(criteria || {})) {
    if (/^[a-zA-Z0-9]{1,40}$/.test(k) && (typeof v === 'string' || typeof v === 'number')) {
      out[k] = String(v).slice(0, 500);
    }
  }
  return out;
}

function csvCell(value) {
  let s = String(value ?? '');
  // Stop spreadsheet apps from treating a cell as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
