// "Find similar": drop an .eml or .msg anywhere on the page, pick which parts to match on,
// and load them into the builder. The email stays in memory only and is dropped on Discard.

import { readEmailFile, suggestionsFor, headerFacts, combine } from './email.js';
import { el } from './dom.js';

export function createSimilar({ root, onApply, toast }) {
  let current = null; // { email, suggestions, checked:Set }

  const fileInput = el('input', { type: 'file', accept: '.eml,.msg,message/rfc822,application/vnd.ms-outlook', class: 'hidden', 'aria-label': 'Choose an email file' });
  const pick = el('button', { type: 'button', class: 'link' }, 'choose a file');
  const zone = el('div', { class: 'drop-zone', tabindex: '0', role: 'button', 'aria-label': 'Drop an email file to find similar messages' },
    el('strong', {}, 'Find emails like one you already have'),
    el('span', {}, 'Drag an .eml or .msg file here, or ', pick, '. It is read in your browser and never uploaded.'));
  const result = el('div', { class: 'similar hidden', 'aria-live': 'polite' });
  const overlay = el('div', { class: 'drop-overlay hidden' }, el('div', {}, 'Drop the email to find similar messages'));

  pick.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  zone.addEventListener('click', () => fileInput.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handle(fileInput.files[0]);
    fileInput.value = '';
  });

  // Page-wide drag and drop, only for drags that carry files.
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth += 1; overlay.classList.remove('hidden'); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.classList.add('hidden'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.classList.add('hidden');
    const file = e.dataTransfer.files[0];
    if (file) handle(file);
  });

  async function handle(file) {
    zone.classList.add('busy');
    try {
      const email = await readEmailFile(file);
      const suggestions = suggestionsFor(email);
      current = { email, suggestions, checked: new Set(suggestions.filter((s) => s.checked).map((s) => s.id)) };
      draw();
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      toast(err.message);
    } finally {
      zone.classList.remove('busy');
    }
  }

  function discard() {
    current = null;
    result.replaceChildren();
    result.classList.add('hidden');
    zone.classList.remove('hidden');
  }

  function toggle(s, on) {
    if (on && s.group) {
      for (const other of current.suggestions) if (other.group === s.group) current.checked.delete(other.id);
    }
    if (on) current.checked.add(s.id); else current.checked.delete(s.id);
    draw();
  }

  function draw() {
    const { email, suggestions, checked } = current;
    const summary = [
      email.from ? `From ${email.from.name && email.from.name.toLowerCase() !== email.from.address ? `${email.from.name} <${email.from.address}>` : email.from.address}` : 'Sender unknown',
      email.subject ? `“${email.subject}”` : 'No subject',
      email.date ? email.date.toLocaleString() : null,
      email.attachments.length ? `${email.attachments.length} attachment${email.attachments.length === 1 ? '' : 's'}` : null,
    ].filter(Boolean);

    const list = el('ul', { class: 'suggestions' }, ...suggestions.map((s) => {
      const box = el('input', { type: 'checkbox', id: `sim-${s.id}` });
      box.checked = checked.has(s.id);
      box.addEventListener('change', () => toggle(s, box.checked));
      return el('li', {}, box, el('label', { for: `sim-${s.id}` }, s.label));
    }));

    const facts = headerFacts(email);
    const factBlock = facts.length
      ? el('div', { class: 'facts' },
        el('p', { class: 'muted' }, 'From the headers. Outlook search cannot match on these, but they help explain the message:'),
        el('ul', {}, ...facts.map((f) => el('li', {}, f))))
      : null;

    const apply = el('button', { type: 'button', class: 'primary', disabled: checked.size === 0 }, 'Build the query');
    apply.addEventListener('click', () => {
      onApply(combine(suggestions, checked));
      toast('Loaded into the builder. The email itself was not kept.');
      discard();
    });

    result.replaceChildren(
      el('div', { class: 'similar-head' },
        el('strong', {}, 'Find emails like this one'),
        el('button', { type: 'button', class: 'link', onclick: discard }, 'Discard')),
      el('p', { class: 'similar-summary' }, summary.join(' · ')),
      suggestions.length ? list : el('p', { class: 'muted' }, 'Nothing in this email can be searched on.'),
      factBlock,
      el('div', { class: 'actions' }, apply),
    );
    result.classList.remove('hidden');
    zone.classList.add('hidden');
  }

  root.replaceChildren(zone, result, fileInput);
  document.body.append(overlay);
}
