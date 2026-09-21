// Search library: built-in searches plus community searches with votes, descriptions and reports.

import { BUILT_INS, CATEGORIES, categoryLabel } from './library.js';
import { explain } from './explain.js';
import { render } from './query.js';
import * as graph from './graph.js';
import * as turnstile from './turnstile.js';
import { DESCRIPTION_MAX_LENGTH, el } from './dom.js';

const PAGE_SIZE = 20;

export function createLibrary({ config, root, onUse, toast, getCriteria, isSignedIn, requestSignIn }) {
  const state = { tab: 'builtin', category: '', sort: 'top', items: [], offset: 0, hasMore: false, loading: false };
  const communityEnabled = graph.isConfigured(config) && turnstile.isConfigured(config);
  const challengeBox = el('div', { class: 'turnstile' });

  // ---------- API ----------

  async function api(path, { method = 'GET', body, auth = false, human = false } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (auth || isSignedIn()) {
      try { headers.Authorization = `Bearer ${await graph.getIdToken(config)}`; } catch (err) { if (auth) throw err; }
    }
    if (human) headers['CF-Turnstile-Token'] = await turnstile.getToken(config, challengeBox);
    let res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 && headers.Authorization) {
      headers.Authorization = `Bearer ${await graph.getIdToken(config, { forceRefresh: true })}`;
      if (human) headers['CF-Turnstile-Token'] = await turnstile.getToken(config, challengeBox);
      res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    }
    const payload = await res.json().catch(() => ({ success: false, error: 'The server sent an unreadable reply.' }));
    if (!payload.success) {
      const err = new Error(payload.error || `Request failed (${res.status}).`);
      err.status = res.status;
      err.data = payload.data;
      throw err;
    }
    return payload.data;
  }

  async function needSignIn(action) {
    if (isSignedIn()) return true;
    toast(`Sign in with Microsoft to ${action}.`);
    await requestSignIn();
    return isSignedIn();
  }

  // ---------- rendering ----------

  function voteControls(type, item, onChange) {
    const up = el('button', { type: 'button', class: `vote${item.myVote === 1 ? ' on' : ''}`, 'aria-label': 'Upvote', title: 'Upvote' }, '▲');
    const down = el('button', { type: 'button', class: `vote${item.myVote === -1 ? ' on' : ''}`, 'aria-label': 'Downvote', title: 'Downvote' }, '▼');
    const score = el('span', { class: 'score', 'aria-label': 'Score' }, String(item.score));
    const cast = async (value) => {
      if (!(await needSignIn('vote'))) return;
      const next = item.myVote === value ? 0 : value;
      try {
        const r = await api('/api/vote', { method: 'POST', body: { type, id: item.id, value: next }, auth: true });
        Object.assign(item, { score: r.score, myVote: r.myVote });
        onChange();
      } catch (err) { toast(err.message); }
    };
    up.addEventListener('click', () => cast(1));
    down.addEventListener('click', () => cast(-1));
    return el('div', { class: 'votes' }, up, score, down);
  }

  function reportButton(type, id) {
    return el('button', {
      type: 'button', class: 'link small',
      onclick: async () => {
        if (!(await needSignIn('report'))) return;
        try {
          await api('/api/report', { method: 'POST', body: { type, id }, auth: true, human: true });
          toast('Thanks. It will be hidden if others report it too.');
        } catch (err) { toast(err.message); }
      },
    }, 'Report');
  }

  function deleteButton(type, id) {
    return el('button', {
      type: 'button', class: 'link small danger',
      onclick: async () => {
        try {
          await api('/api/delete', { method: 'POST', body: { type, id }, auth: true });
          toast('Deleted.');
          reload();
        } catch (err) { toast(err.message); }
      },
    }, 'Delete');
  }

  function descriptionForm(item) {
    const input = el('input', { type: 'text', maxlength: String(DESCRIPTION_MAX_LENGTH), placeholder: 'Describe what this finds, in your own words' });
    const count = el('span', { class: 'hint' }, `0/${DESCRIPTION_MAX_LENGTH}`);
    input.addEventListener('input', () => { count.textContent = `${input.value.length}/${DESCRIPTION_MAX_LENGTH}`; });
    const submit = el('button', {
      type: 'button',
      onclick: async () => {
        if (!(await needSignIn('add a description'))) return;
        try {
          await api(`/api/searches/${item.id}/descriptions`, { method: 'POST', body: { text: input.value }, auth: true, human: true });
          toast('Description added.');
          reload();
        } catch (err) { toast(err.message); }
      },
    }, 'Add');
    return el('div', { class: 'desc-form hidden' }, el('div', { class: 'inline' }, input, submit), count);
  }

  function card(item, community) {
    const ours = explain(item.criteria);
    const preview = render('modern', item.criteria).query;
    const body = el('div', { class: 'lib-body' },
      el('div', { class: 'lib-head' },
        el('strong', {}, item.title),
        el('span', { class: 'chip static' }, categoryLabel(item.category))),
      el('p', { class: 'explain' }, ours),
      el('code', { class: 'preview' }, preview));

    if (community) {
      const descs = el('ul', { class: 'descs' }, ...item.descriptions.map((d) => el('li', {},
        voteControls('description', d, () => refreshList()),
        el('span', { class: 'desc-text' }, `"${d.text}"`),
        d.mine ? deleteButton('description', d.id) : reportButton('description', d.id))));
      const form = descriptionForm(item);
      body.append(descs, form);
      const actions = el('div', { class: 'lib-actions' },
        el('button', { type: 'button', class: 'primary', onclick: () => onUse(item) }, 'Use this search'),
        item.descriptions.some((d) => d.mine) ? null : el('button', { type: 'button', class: 'link small', onclick: () => form.classList.toggle('hidden') }, 'Describe it'),
        item.mine ? deleteButton('search', item.id) : reportButton('search', item.id));
      body.append(actions);
      return el('li', { class: 'lib-card' }, voteControls('search', item, () => refreshList()), body);
    }
    body.append(el('div', { class: 'lib-actions' },
      el('button', { type: 'button', class: 'primary', onclick: () => onUse(item) }, 'Use this search')));
    return el('li', { class: 'lib-card' }, body);
  }

  const tabs = el('div', { class: 'tabs', role: 'tablist' });
  const chips = el('div', { class: 'chips' });
  const sortSelect = el('select', { 'aria-label': 'Sort' },
    el('option', { value: 'top' }, 'Top voted'), el('option', { value: 'new' }, 'Newest'));
  const list = el('ul', { class: 'lib-list' });
  const empty = el('p', { class: 'muted hidden' });
  const more = el('button', { type: 'button', class: 'hidden' }, 'Show more');

  function renderTabs() {
    const make = (key, label) => el('button', {
      type: 'button', role: 'tab', class: `tab${state.tab === key ? ' on' : ''}`, 'aria-selected': String(state.tab === key),
      onclick: () => { state.tab = key; renderTabs(); reload(); },
    }, label);
    tabs.replaceChildren(make('builtin', 'Built-in'), make('community', 'Community'));
    sortSelect.classList.toggle('hidden', state.tab !== 'community');
  }

  function renderChips() {
    const make = (key, label) => el('button', {
      type: 'button', class: `chip${state.category === key ? ' on' : ''}`, 'aria-pressed': String(state.category === key),
      onclick: () => { state.category = key; renderChips(); reload(); },
    }, label);
    chips.replaceChildren(make('', 'All'), ...CATEGORIES.map((c) => make(c.key, c.label)));
  }

  function refreshList() {
    const community = state.tab === 'community';
    list.replaceChildren(...state.items.map((item) => card(item, community)));
    empty.classList.toggle('hidden', state.items.length > 0 || state.loading);
    more.classList.toggle('hidden', !community || !state.hasMore);
  }

  async function reload(append = false) {
    if (state.tab === 'builtin') {
      state.items = BUILT_INS.filter((b) => !state.category || b.category === state.category);
      empty.textContent = 'No built-in searches in this category yet.';
      refreshList();
      return;
    }
    if (!communityEnabled) {
      state.items = [];
      empty.textContent = 'Community searches are not switched on yet.';
      refreshList();
      return;
    }
    state.loading = true;
    if (!append) state.offset = 0;
    try {
      const qs = new URLSearchParams({ sort: state.sort, limit: String(PAGE_SIZE), offset: String(state.offset) });
      if (state.category) qs.set('category', state.category);
      const data = await api(`/api/searches?${qs}`);
      state.items = append ? [...state.items, ...data.searches] : data.searches;
      state.hasMore = data.hasMore;
      state.offset += data.searches.length;
      empty.textContent = 'Nothing shared in this category yet. Build a search and share it below.';
    } catch (err) {
      if (!append) state.items = [];
      empty.textContent = `Could not load community searches: ${err.message}`;
    } finally {
      state.loading = false;
      refreshList();
    }
  }

  sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; reload(); });
  more.addEventListener('click', () => reload(true));

  root.replaceChildren(
    el('div', { class: 'lib-bar' }, tabs, sortSelect),
    chips, list, empty, more, challengeBox,
  );
  renderTabs();
  renderChips();
  reload();

  // ---------- sharing ----------

  async function share({ title, category, description }) {
    if (!communityEnabled) throw new Error('Community sharing is not switched on yet.');
    if (!(await needSignIn('share a search'))) return null;
    try {
      const data = await api('/api/searches', {
        method: 'POST', auth: true, human: true,
        body: { title, category, description, criteria: getCriteria() },
      });
      state.tab = 'community';
      state.sort = 'new';
      sortSelect.value = 'new';
      renderTabs();
      reload();
      return data;
    } catch (err) {
      if (err.status === 409 && err.data?.title) throw new Error(`Already shared as "${err.data.title}". Vote on it or add a description in Community.`);
      throw err;
    }
  }

  return { share, reload, communityEnabled };
}
