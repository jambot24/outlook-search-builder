import { CLIENTS, COMMON_FOLDERS, renderAll, renderQueries, dateHint } from './query.js';
import {
  loadSaved, persistSaved, createEntry, upsertEntry, removeEntry,
  toExportJson, toExportCsv, mergeImport, sanitizeCriteria,
} from './storage.js';
import * as graph from './graph.js';
import { createLibrary } from './community.js';
import { createSimilar } from './similar.js';
import { explain } from './explain.js';
import { CATEGORIES } from './library.js';
import { DESCRIPTION_MAX_LENGTH, el } from './dom.js';
import { enhanceTokenField, enhanceToggleGroup } from './tokenfield.js';
import { FILE_TYPES } from './filetypes.js';
import { searchFolderSteps } from './searchfolder.js';

const DRAFT_KEY = 'osb.draft.v1';
const TOAST_MS = 2200;
const config = window.OSB_CONFIG || {};

const form = document.getElementById('builder');
const outputs = document.getElementById('outputs');
const savedList = document.getElementById('saved');
const savedEmpty = document.getElementById('saved-empty');
const toastEl = document.getElementById('toast');

let saved = loadSaved(localStorage);
let account = null;
let library = null;

// ---------- form state ----------

function readCriteria() {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.value === '') continue;
    if (el.type === 'checkbox' && !el.checked) continue;
    out[el.name] = el.value;
  }
  return out;
}

const enhanced = [
  ...[...form.querySelectorAll('input[data-tokens]')].map(enhanceTokenField),
  enhanceToggleGroup(form.elements.namedItem('fileTypes'), FILE_TYPES),
];

function writeCriteria(criteria) {
  form.reset();
  // reset() leaves hidden inputs alone, so clear them explicitly.
  for (const h of form.querySelectorAll('input[type=hidden]')) h.value = '';
  for (const [name, value] of Object.entries(criteria || {})) {
    const el = form.elements.namedItem(name);
    if (el?.type === 'checkbox') el.checked = el.value === value;
    else if (el && 'value' in el) el.value = value;
  }
  refresh();
}

function toggleDateFields() {
  const mode = form.elements.namedItem('dateMode').value;
  for (const el of form.querySelectorAll('[data-show]')) {
    el.classList.toggle('hidden', !el.dataset.show.split(' ').includes(mode));
  }
}

// ---------- output ----------

function renderOutputs(criteria) {
  const all = renderAll(criteria);
  outputs.replaceChildren(...CLIENTS.map(({ key, label }) => {
    const r = all[key];
    const code = el('code', { class: r.query ? '' : 'empty' }, r.query || 'Fill in the form to build a query.');
    const card = el('div', { class: 'client' },
      el('header', {},
        el('strong', {}, label),
        el('button', { type: 'button', onclick: () => copy(r.query), ...(r.query ? {} : { disabled: '' }) }, 'Copy')),
      code);
    if (r.fallback) {
      card.append(el('div', { class: 'where' }, 'Plain keywords: '), el('code', {}, r.fallback));
    }
    if (r.scope) card.append(el('div', { class: 'where' }, r.scope));
    for (const n of r.notes || []) card.append(el('div', { class: 'where' }, n));
    if (r.query) card.append(searchFolderBlock(key, criteria));
    if (r.warnings.length) card.append(el('ul', { class: 'warn' }, ...r.warnings.map((w) => el('li', {}, w))));
    return card;
  }));
}

function searchFolderBlock(clientKey, criteria) {
  const sf = searchFolderSteps(clientKey, criteria);
  const body = [];
  if (sf.steps.length) body.push(el('ol', {}, ...sf.steps.map((t) => el('li', {}, t))));
  if (sf.leftOut.length) body.push(el('p', {}, `Not possible in a search folder, so left out: ${sf.leftOut.join(', ')}.`));
  for (const n of sf.notes) body.push(el('p', {}, n));
  return el('details', { class: 'folder-steps' }, el('summary', {}, sf.supported ? 'Save as a search folder' : 'Search folder: not available'), ...body);
}

function refresh() {
  toggleDateFields();
  enhanced.forEach((f) => f.sync());
  const criteria = readCriteria();
  renderOutputs(criteria);
  const hint = dateHint(criteria);
  const hintEl = document.getElementById('date-hint');
  hintEl.textContent = hint;
  hintEl.classList.toggle('hidden', !hint);
  const what = explain(criteria);
  document.getElementById('explain').textContent = what || 'Fill in the form and this will say, in plain English, what the search finds.';
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(criteria)); } catch { /* private mode */ }
}

// ---------- saved searches ----------

function renderSaved() {
  savedEmpty.classList.toggle('hidden', saved.length > 0);
  savedList.replaceChildren(...saved.map((entry) => el('li', {},
    el('div', {},
      el('div', { class: 'name' }, entry.name),
      el('div', { class: 'meta' }, `Saved ${new Date(entry.savedAt).toLocaleString()}`)),
    el('div', { class: 'btns' },
      el('button', { type: 'button', onclick: () => { writeCriteria(entry.criteria); document.getElementById('save-name').value = entry.name; toast(`Loaded "${entry.name}"`); } }, 'Load'),
      el('button', { type: 'button', class: 'danger', onclick: () => deleteSaved(entry) }, 'Delete')))));
}

function commit(list) {
  saved = list;
  if (!persistSaved(localStorage, saved)) toast('This browser blocked saving. Export to keep your searches.');
  renderSaved();
}

function saveCurrent() {
  const nameInput = document.getElementById('save-name');
  const criteria = readCriteria();
  if (Object.keys(criteria).filter((k) => !['dateField', 'dateFormat', 'datePreset', 'folder', 'includeDeleted'].includes(k)).length === 0) {
    toast('Fill in the form before saving.');
    return;
  }
  try {
    const entry = createEntry(nameInput.value, criteria);
    commit(upsertEntry(saved, entry));
    toast(`Saved "${entry.name}"`);
  } catch (err) {
    toast(err.message);
    nameInput.focus();
  }
}

function deleteSaved(entry) {
  const previous = saved;
  commit(removeEntry(saved, entry.id));
  toastWithUndo(`Deleted "${entry.name}"`, () => commit(previous));
}

// ---------- export / import / share ----------

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function exportJson() {
  if (!saved.length) return toast('Nothing saved to export.');
  download(`outlook-searches-${stamp()}.json`, toExportJson(saved), 'application/json');
}

function exportCsv() {
  if (!saved.length) return toast('Nothing saved to export.');
  download(`outlook-searches-${stamp()}.csv`, toExportCsv(saved, renderQueries), 'text/csv');
}

async function importFile(file) {
  try {
    const { list, imported, skipped } = mergeImport(saved, await file.text());
    commit(list);
    toast(`Imported ${imported} search${imported === 1 ? '' : 'es'}${skipped ? `, skipped ${skipped}` : ''}.`);
  } catch (err) {
    toast(err.message);
  }
}

function encodeShare(criteria) {
  const bytes = new TextEncoder().encode(JSON.stringify(criteria));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeShare(token) {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  return sanitizeCriteria(JSON.parse(new TextDecoder().decode(bytes)));
}

function shareLink() {
  const criteria = readCriteria();
  // A custom folder name is personal to the sender's mailbox, so only standard folders are shared.
  if (!COMMON_FOLDERS.includes(criteria.folder)) delete criteria.folder;
  const url = `${location.origin}${location.pathname}#q=${encodeShare(criteria)}`;
  copy(url, 'Share link copied');
}

// ---------- sign-in (optional) ----------

const signInBtn = document.getElementById('sign-in');
const signOutBtn = document.getElementById('sign-out');
const accountStatus = document.getElementById('account-status');
const loadFoldersBtn = document.getElementById('load-folders');

function showAccount(next) {
  account = next;
  signInBtn.classList.toggle('hidden', Boolean(account));
  signOutBtn.classList.toggle('hidden', !account);
  accountStatus.classList.toggle('hidden', !account);
  accountStatus.textContent = account ? account.username : '';
  loadFoldersBtn.classList.toggle('hidden', !account);
  library?.reload();
}

async function signIn() {
  try {
    showAccount(await graph.signIn(config));
  } catch (err) {
    if (!/user_cancelled/.test(err.errorCode || err.message)) toast(`Sign-in failed: ${err.message}`);
  }
}

async function setupSignIn() {
  if (!graph.isConfigured(config)) return;
  signInBtn.addEventListener('click', signIn);
  signOutBtn.addEventListener('click', async () => {
    await graph.signOut(config);
    fillCommonFolders();
    document.getElementById('folder-hint').textContent = 'Inbox unless you pick another. Choose All folders to search everything.';
    showAccount(null);
  });
  loadFoldersBtn.addEventListener('click', loadFolders);
  showAccount(null);
  try {
    const existing = await graph.currentAccount(config);
    if (existing) showAccount(existing);
  } catch { showAccount(null); }
}

async function loadFolders() {
  const hint = document.getElementById('folder-hint');
  hint.textContent = 'Loading your folders…';
  try {
    const folders = await graph.listFolders(config);
    const names = [...COMMON_FOLDERS, ...folders.map((f) => f.path).filter((p) => !COMMON_FOLDERS.includes(p))];
    document.getElementById('folder-options').replaceChildren(...names.map((n) => el('option', { value: n })));
    hint.textContent = `${folders.length} folders loaded. Start typing to pick one.`;
  } catch (err) {
    hint.textContent = err.message;
  }
}

// ---------- community ----------

function setupCommunity() {
  library = createLibrary({
    config,
    root: document.getElementById('library'),
    toast,
    getCriteria: readCriteria,
    isSignedIn: () => Boolean(account),
    requestSignIn: signIn,
    onUse: (item) => {
      writeCriteria(item.criteria);
      document.getElementById('outputs').scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast(`Loaded "${item.title}"`);
    },
  });

  const category = document.getElementById('share-category');
  category.replaceChildren(el('option', { value: '' }, 'Pick a category'), ...CATEGORIES.map((c) => el('option', { value: c.key }, c.label)));
  const desc = document.getElementById('share-description');
  const count = document.getElementById('share-count');
  desc.maxLength = DESCRIPTION_MAX_LENGTH;
  desc.addEventListener('input', () => { count.textContent = `${desc.value.length}/${DESCRIPTION_MAX_LENGTH}`; });

  const shareBtn = document.getElementById('share-community');
  if (!library.communityEnabled) {
    shareBtn.disabled = true;
    document.getElementById('share-note').textContent = 'Community sharing is not switched on yet.';
    return;
  }
  shareBtn.addEventListener('click', async () => {
    shareBtn.disabled = true;
    try {
      const result = await library.share({
        title: document.getElementById('save-name').value,
        category: category.value,
        description: desc.value,
      });
      if (result) {
        toast('Shared with the community. Thank you.');
        desc.value = '';
        count.textContent = `0/${DESCRIPTION_MAX_LENGTH}`;
        document.getElementById('library').scrollIntoView({ behavior: 'smooth' });
      }
    } catch (err) {
      toast(err.message);
    } finally {
      shareBtn.disabled = false;
    }
  });
}

function setupFooter() {
  const links = [];
  if (config.repoUrl) links.push(el('a', { href: config.repoUrl, rel: 'noopener' }, 'Source on GitHub'));
  links.push(el('a', { href: config.repoUrl ? `${config.repoUrl}/blob/main/LICENSE` : 'LICENSE', rel: 'noopener' }, 'MIT License'));
  if (config.coffeeUrl) links.push(el('a', { href: config.coffeeUrl, rel: 'noopener', class: 'coffee' }, '☕ Buy me a coffee'));
  const box = document.getElementById('footer-links');
  links.forEach((a, i) => { if (i) box.append(' · '); box.append(a); });
}

function fillCommonFolders() {
  document.getElementById('folder-options').replaceChildren(...COMMON_FOLDERS.map((n) => el('option', { value: n })));
}

// ---------- utilities ----------

async function copy(text, message = 'Copied') {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast('Copy failed. Select the text and copy it manually.');
  }
}

let toastTimer;
function toast(message) {
  toastEl.replaceChildren(message);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), TOAST_MS);
}

function toastWithUndo(message, undo) {
  toast(message);
  toastEl.style.pointerEvents = 'auto';
  toastEl.append(' ', el('button', { type: 'button', class: 'link', onclick: () => { undo(); toastEl.classList.remove('show'); } }, 'Undo'));
  setTimeout(() => { toastEl.style.pointerEvents = ''; }, TOAST_MS * 2);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), TOAST_MS * 2);
}

// ---------- start ----------

function initialCriteria() {
  const match = /^#q=([\w-]+)$/.exec(location.hash);
  if (match) {
    try {
      history.replaceState(null, '', location.pathname);
      return decodeShare(match[1]);
    } catch { toast('That share link is damaged.'); }
  }
  try { return sanitizeCriteria(JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')); } catch { return {}; }
}

form.addEventListener('input', refresh);
form.addEventListener('change', refresh);
form.addEventListener('submit', (e) => e.preventDefault());
document.getElementById('clear-form').addEventListener('click', () => writeCriteria({}));
document.getElementById('share').addEventListener('click', shareLink);
document.getElementById('save').addEventListener('click', saveCurrent);
document.getElementById('save-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCurrent(); });
document.getElementById('export-json').addEventListener('click', exportJson);
document.getElementById('export-csv').addEventListener('click', exportCsv);
const importInput = document.getElementById('import-file');
document.getElementById('import').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', () => {
  if (importInput.files[0]) importFile(importInput.files[0]);
  importInput.value = '';
});

fillCommonFolders();
setupFooter();
createSimilar({
  root: document.getElementById('similar'),
  toast,
  onApply: (criteria) => {
    writeCriteria(criteria);
    document.getElementById('outputs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
});
setupCommunity();
writeCriteria(initialCriteria());
renderSaved();
setupSignIn();
