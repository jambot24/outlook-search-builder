// Common attachment types. Keys are stored in saved and shared searches, so never rename one.

export const FILE_TYPES = [
  { key: 'pdf', label: 'PDF', exts: ['pdf'] },
  { key: 'word', label: 'Word', exts: ['docx', 'doc'] },
  { key: 'excel', label: 'Excel', exts: ['xlsx', 'xls', 'xlsm'] },
  { key: 'powerpoint', label: 'PowerPoint', exts: ['pptx', 'ppt'] },
  { key: 'csv', label: 'CSV', exts: ['csv'] },
  { key: 'image', label: 'Images', exts: ['jpg', 'jpeg', 'png', 'gif', 'heic'] },
  { key: 'zip', label: 'Zip archives', exts: ['zip', '7z', 'rar'] },
  { key: 'calendar', label: 'Calendar (.ics)', exts: ['ics'] },
  { key: 'email', label: 'Attached emails', exts: ['eml', 'msg'] },
  { key: 'text', label: 'Text', exts: ['txt'] },
];

const BY_KEY = new Map(FILE_TYPES.map((t) => [t.key, t]));

// "pdf, word ,bogus" -> ['pdf', 'word'] in canonical order, unknown keys dropped.
export function parseFileTypes(value) {
  const wanted = new Set(String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  return FILE_TYPES.filter((t) => wanted.has(t.key)).map((t) => t.key);
}

export function extensionsFor(keys) {
  return keys.flatMap((k) => BY_KEY.get(k)?.exts || []);
}

export function labelFor(key) {
  return BY_KEY.get(key)?.label || key;
}

export function typeForExtension(ext) {
  const e = String(ext || '').toLowerCase();
  return FILE_TYPES.find((t) => t.exts.includes(e))?.key || '';
}
