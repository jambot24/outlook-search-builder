import { CLIENTS, renderAll, renderQueries } from './query.js';
import {
  loadSaved, persistSaved, createEntry, upsertEntry, removeEntry,
  toExportJson, toExportCsv, mergeImport, sanitizeCriteria,
} from './storage.js';
import * as graph from './graph.js';

const DRAFT_KEY = 'osb.draft.v1';
const TOAST_MS = 2200;
const config = window.OSB_CONFIG || {};

const form = document.getElementById('builder');
const outputs = document.getElementById('outputs');
const savedList = document.getElementById('saved');
const savedEmpty = document.getElementById('saved-empty');
const toastEl = document.getElementById('toast');

let saved = loadSaved(localStorage);

// ---------- form state ----------

function readCriteria() {
  const out = {};
  for (const el of form.elements) {
    if (el.name && el.value !== '') out[el.name] = el.value;
  }
  return out;
}

function writeCriteria(criteria) {
  form.reset();
  for (const [name, value] of Object.entries(criteria || {})) {
    const el = form.elements.namedItem(name);
    if (el && 'value' in el) el.value = value;
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

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

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
    if (r.warnings.length) card.append(el('ul', { class: 'warn' }, ...r.warnings.map((w) => el('li', {}, w))));
    return card;
  }));
}

function refresh() {
  toggleDateFields();
  const criteria = readCriteria();
  renderOutputs(criteria);
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
  if (Object.keys(criteria).filter((k) => !['dateField', 'dateFormat', 'datePreset'].includes(k)).length === 0) {
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
  // The folder name is personal to the sender's mailbox, so it is not shared.
  delete criteria.folder;
  const url = `${location.origin}${location.pathname}#q=${encodeShare(criteria)}`;
  copy(url, 'Share link copied');
}

// ---------- sign-in (optional) ----------

async function setupSignIn() {
  if (!graph.isConfigured(config)) return;
  const signInBtn = document.getElementById('sign-in');
  const signOutBtn = document.getElementById('sign-out');
  const status = document.getElementById('account-status');

  const show = (account) => {
    signInBtn.classList.toggle('hidden', Boolean(account));
    signOutBtn.classList.toggle('hidden', !account);
    status.classList.toggle('hidden', !account);
    status.textContent = account ? account.username : '';
  };

  signInBtn.addEventListener('click', async () => {
    try {
      show(await graph.signIn(config));
      await loadFolders();
    } catch (err) {
      if (!/user_cancelled/.test(err.errorCode || err.message)) toast(`Sign-in failed: ${err.message}`);
    }
  });
  signOutBtn.addEventListener('click', async () => {
    await graph.signOut(config);
    document.getElementById('folder-options').replaceChildren();
    document.getElementById('folder-hint').textContent = 'Type a folder name, or sign in (top right) to pick from your folders.';
    show(null);
  });

  show(null);
  try {
    const account = await graph.currentAccount(config);
    if (account) { show(account); await loadFolders(); }
  } catch { show(null); }
}

async function loadFolders() {
  const hint = document.getElementById('folder-hint');
  hint.textContent = 'Loading your folders…';
  try {
    const folders = await graph.listFolders(config);
    document.getElementById('folder-options').replaceChildren(...folders.map((f) => el('option', { value: f.path })));
    hint.textContent = `${folders.length} folders loaded. Start typing to pick one.`;
  } catch (err) {
    hint.textContent = err.message;
  }
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

writeCriteria(initialCriteria());
renderSaved();
setupSignIn();
