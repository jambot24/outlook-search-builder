// Chip inputs: type a term and press Enter (or comma) to turn it into one chip.
// The chips are serialised into a hidden form field, so the rest of the page just reads a value.
//   mode "list":  people fields, stored as "a@x.com, Bob Smith"
//   mode "words": word fields, stored as 'invoice "past due"' (phrases quoted)

import { splitList, words } from './query.js';
import { el } from './dom.js';

function parse(mode, value) {
  return mode === 'list' ? splitList(value) : words(value).map((w) => w.replace(/"/g, ''));
}

function serialise(mode, tokens) {
  if (mode === 'list') return tokens.join(', ');
  return tokens.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(' ');
}

export function enhanceTokenField(hidden) {
  const mode = hidden.dataset.tokens;
  const labelText = hidden.closest('label')?.firstChild?.textContent?.trim() || hidden.name;
  const input = el('input', { type: 'text', class: 'token-input', placeholder: hidden.dataset.placeholder || '', 'aria-label': labelText, autocomplete: 'off' });
  const box = el('div', { class: 'tokens' });
  const wrap = el('div', { class: 'token-field', 'data-field': hidden.name }, box, input);
  hidden.after(wrap);
  wrap.addEventListener('click', () => input.focus());

  let tokens = parse(mode, hidden.value);

  function emit() {
    hidden.value = serialise(mode, tokens);
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function draw() {
    box.replaceChildren(...tokens.map((t, i) => el('span', { class: 'token' },
      el('span', {}, t),
      el('button', {
        type: 'button', class: 'token-x', 'aria-label': `Remove ${t}`,
        onclick: (e) => { e.stopPropagation(); tokens = tokens.filter((_, j) => j !== i); draw(); emit(); input.focus(); },
      }, '×'))));
    input.placeholder = tokens.length ? '' : (hidden.dataset.placeholder || '');
  }

  function commit(text) {
    const fresh = mode === 'list'
      ? splitList(text)
      : [String(text).replace(/"/g, '').trim().replace(/\s+/g, ' ')].filter(Boolean);
    const added = fresh.filter((t) => !tokens.some((x) => x.toLowerCase() === t.toLowerCase()));
    if (!added.length) return false;
    tokens = [...tokens, ...added];
    draw();
    emit();
    return true;
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || (e.key === ',' && mode === 'list')) {
      e.preventDefault();
      if (input.value.trim()) { commit(input.value); input.value = ''; }
    } else if (e.key === 'Backspace' && !input.value && tokens.length) {
      tokens = tokens.slice(0, -1);
      draw();
      emit();
    }
  });
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (mode === 'list' && /[,;\n]/.test(text)) {
      e.preventDefault();
      commit(text.replace(/\n/g, ','));
    }
  });
  // A term typed but not yet entered still counts when the user moves on.
  input.addEventListener('blur', () => {
    if (input.value.trim()) { commit(input.value); input.value = ''; }
  });
  // Stop the visible input's own events reaching the form: only the hidden value matters.
  input.addEventListener('input', (e) => e.stopPropagation());

  draw();
  return {
    // Redraw only on a real change: replacing chips mid-click would swallow the click.
    sync() {
      const next = parse(mode, hidden.value);
      if (serialise(mode, next) === serialise(mode, tokens)) return;
      tokens = next;
      draw();
    },
    focus() { input.focus(); },
  };
}

// Toggle buttons that store their selection as a comma list in a hidden field.
export function enhanceToggleGroup(hidden, options) {
  const group = el('div', { class: 'toggles', role: 'group', 'aria-label': hidden.closest('label')?.firstChild?.textContent?.trim() || hidden.name, 'data-field': hidden.name });
  hidden.after(group);
  const selected = () => new Set(String(hidden.value || '').split(',').filter(Boolean));
  let drawn = null;

  function draw() {
    drawn = hidden.value;
    const on = selected();
    group.replaceChildren(...options.map((o) => el('button', {
      type: 'button', class: `toggle${on.has(o.key) ? ' on' : ''}`, 'aria-pressed': String(on.has(o.key)),
      onclick: () => {
        const next = selected();
        if (next.has(o.key)) next.delete(o.key); else next.add(o.key);
        hidden.value = options.filter((x) => next.has(x.key)).map((x) => x.key).join(',');
        draw();
        hidden.dispatchEvent(new Event('input', { bubbles: true }));
      },
    }, o.label)));
  }
  draw();
  return { sync() { if (hidden.value !== drawn) draw(); } };
}
