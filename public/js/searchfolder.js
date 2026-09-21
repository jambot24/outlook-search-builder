// Step-by-step instructions for keeping a search as a Search Folder (or the nearest equivalent).
// No Outlook version accepts typed search text in a search folder, so each criterion is mapped
// to the dialog field that does the same job, and anything with no field is listed as left out.
// Sources: see docs/SYNTAX.md, "Search folders".

import { splitList, words, presetRange, formatDate, validDays, validSizeMb } from './query.js';
import { parseFileTypes } from './filetypes.js';

const CLASSIC_TIME = new Set(['today', 'yesterday', 'this week', 'last week', 'this month', 'last month']);
const KB_PER_MB = 1024;

function wordList(c) {
  return [...words(c.allWords), ...(c.phrase ? [`"${c.phrase}"`] : []), ...words(c.anyWords)];
}

function us(iso) {
  return formatDate(iso, 'mdy');
}

function isoDaysAgo(days, now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function folderStep(c) {
  const folder = String(c.folder ?? '').trim();
  if (!folder || folder.toLowerCase() === 'all folders') return 'Under "Search mail in", keep your mailbox selected so the folder covers all of it.';
  return `Select Browse, tick "${folder}" (and "Search subfolders" if you want them too), then OK.`;
}

function classicSteps(c, now) {
  const messages = [];
  const more = [];
  const advanced = [];
  const leftOut = [];
  const notes = [];

  const terms = wordList(c);
  if (c.subject || c.body || terms.length) {
    const text = [c.subject, c.body, ...terms].filter(Boolean).join(' ');
    messages.push(`Search for the word(s): ${text}`);
    const where = c.body || terms.length ? 'subject field and message body' : 'subject field only';
    messages.push(`In: ${where}`);
    if (words(c.anyWords).length > 1) notes.push('The words box may not treat "any of these words" as OR. If the folder comes up empty, keep one word.');
  }
  if (splitList(c.from).length) messages.push(`From…: ${splitList(c.from).join('; ')}`);
  if (splitList(c.to).length) messages.push(`Sent To…: ${splitList(c.to).join('; ')}`);

  const field = c.dateField === 'sent' ? 'sent' : 'received';
  const Field = field === 'sent' ? 'Sent' : 'Received';
  if (c.dateMode === 'preset' && CLASSIC_TIME.has(c.datePreset)) {
    messages.push(`Time: ${field} · ${c.datePreset}`);
  } else if (c.dateMode === 'within' && validDays(c.days) === 7) {
    messages.push(`Time: ${field} · in the last 7 days`);
  } else if (c.dateMode === 'preset') {
    const r = presetRange(c.datePreset, now);
    if (r) {
      advanced.push(`${Field} · between · ${us(r[0])} and ${us(r[1])}`);
      notes.push(`These dates are fixed. The folder will not move on to a new "${c.datePreset}" by itself.`);
    }
  } else if (c.dateMode === 'within' && validDays(c.days)) {
    advanced.push(`${Field} · on or after · ${us(isoDaysAgo(validDays(c.days), now))}`);
    notes.push('This date is fixed, so the folder will not keep a rolling window.');
  } else if (c.dateMode === 'older' && validDays(c.days)) {
    advanced.push(`${Field} · on or before · ${us(isoDaysAgo(validDays(c.days) + 1, now))}`);
    notes.push('This date is fixed. For a rolling "older than" folder, use the ready-made "Old mail" search folder instead.');
  } else if (c.dateMode === 'ago' && validDays(c.days, { min: 0 }) !== null && validDays(c.days2, { min: 0 }) !== null) {
    const [a, b] = [validDays(c.days, { min: 0 }), validDays(c.days2, { min: 0 })].sort((x, y) => x - y);
    advanced.push(`${Field} · between · ${us(isoDaysAgo(b, now))} and ${us(isoDaysAgo(a, now))}`);
    notes.push('These dates are fixed, so the folder will not keep a rolling window.');
  } else if (c.dateMode === 'on' && c.date1) {
    advanced.push(`${Field} · on · ${us(c.date1)}`);
  } else if (c.dateMode === 'after' && c.date1) {
    advanced.push(`${Field} · on or after · ${us(c.date1)}`);
  } else if (c.dateMode === 'before' && c.date1) {
    advanced.push(`${Field} · before · ${us(c.date1)}`);
  } else if (c.dateMode === 'between' && c.date1 && c.date2) {
    const [a, b] = c.date1 <= c.date2 ? [c.date1, c.date2] : [c.date2, c.date1];
    advanced.push(`${Field} · between · ${us(a)} and ${us(b)}`);
  }

  if (c.read === 'no') more.push('Only items that are: unread');
  if (c.read === 'yes') more.push('Only items that are: read');
  const types = parseFileTypes(c.fileTypes);
  if (c.hasAttachments === 'yes' || types.length) more.push('Only items with: one or more attachments');
  if (c.hasAttachments === 'no' && !types.length) more.push('Only items with: no attachments');
  if (c.importance) more.push(`Whose importance is: ${c.importance}`);
  if (c.flagged === 'yes') more.push('Only items which: are flagged by me');
  if (c.category) more.push(`Categories…: tick "${c.category}"`);
  const mb = validSizeMb(c);
  if (mb !== null) {
    more.push(`Size (kilobytes): ${c.sizeOp === '>' ? 'greater than' : 'less than'} ${Math.round(mb * KB_PER_MB)}`);
  }

  if (splitList(c.cc).length) advanced.push(`CC · contains · ${splitList(c.cc).join('; ')}`);
  if (words(c.noneWords).length) leftOut.push('none of these words');
  if (splitList(c.bcc).length) leftOut.push('Bcc');
  if (splitList(c.participants).length) leftOut.push('anywhere in From/To/Cc');
  if (c.attachmentName || types.length) leftOut.push('attachment name or file type');

  const steps = [
    'Folder tab > New Search Folder (Ctrl+Shift+P).',
    'Scroll to the bottom, pick "Create a custom Search Folder", then Choose.',
    'Name it, then select Criteria.',
  ];
  if (messages.length) steps.push(`Messages tab: ${messages.join('; ')}.`);
  if (more.length) steps.push(`More Choices tab: ${more.join('; ')}.`);
  if (advanced.length) steps.push(`Advanced tab: for each line, pick Field, Condition and Value, then Add to List: ${advanced.join('; ')}.`);
  steps.push('Select OK.', folderStep(c), 'Select OK. The folder appears under Search Folders in your mailbox.');
  return { supported: true, steps, leftOut, notes };
}

// New Outlook and the web offer ready-made types only. Pick the one closest to the search.
function modernPick(c) {
  const from = splitList(c.from);
  const text = [c.subject, ...wordList(c)].filter(Boolean);
  const candidates = [
    c.read === 'no' && c.flagged === 'yes' && { type: 'Mail either unread or flagged for follow-up', covers: ['read', 'flagged'] },
    c.read === 'no' && { type: 'Unread mail', covers: ['read'] },
    c.flagged === 'yes' && { type: 'Mail flagged for follow-up', covers: ['flagged'] },
    from.length && { type: 'Mail from specific people', param: `add ${from.join(', ')} (full email addresses; a whole domain is not accepted)`, covers: ['from'] },
    text.length && { type: 'Mail with specific words', param: `enter ${text.join(', ')}`, covers: ['words'] },
    c.importance === 'high' && { type: 'Important mail', covers: ['importance'] },
    c.category && { type: 'Categorized mail', param: `choose "${c.category}"`, covers: ['category'] },
    (c.hasAttachments === 'yes' || parseFileTypes(c.fileTypes).length) && { type: 'Mail with attachments', covers: ['attachments'] },
    c.sizeOp === '>' && validSizeMb(c) !== null && { type: 'Large mail', param: `set the size to ${Math.round(validSizeMb(c) * KB_PER_MB)} KB`, covers: ['size'] },
    c.dateMode === 'older' && validDays(c.days) && { type: 'Old mail', param: `set the age to ${validDays(c.days)} days`, covers: ['date'] },
  ].filter(Boolean);
  return candidates[0] || null;
}

function hasDate(c) {
  if (['older', 'within'].includes(c.dateMode)) return validDays(c.days) !== null;
  if (c.dateMode === 'ago') return validDays(c.days, { min: 0 }) !== null && validDays(c.days2, { min: 0 }) !== null;
  if (c.dateMode === 'preset') return true;
  if (c.dateMode === 'between') return Boolean(c.date1 && c.date2);
  return Boolean(c.date1);
}

function usedParts(c) {
  const parts = [];
  if (c.read) parts.push('read');
  if (c.flagged) parts.push('flagged');
  if (splitList(c.from).length) parts.push('from');
  if (c.subject || wordList(c).length) parts.push('words');
  if (c.importance) parts.push('importance');
  if (c.category) parts.push('category');
  if (c.hasAttachments || c.fileTypes) parts.push('attachments');
  if (validSizeMb(c) !== null) parts.push('size');
  if (c.dateMode && hasDate(c)) parts.push('date');
  if (splitList(c.to).length || splitList(c.cc).length || splitList(c.bcc).length || splitList(c.participants).length) parts.push('recipients');
  if (words(c.noneWords).length) parts.push('excluded words');
  return parts;
}

function modernSteps(c) {
  const pick = modernPick(c);
  if (!pick) {
    return {
      supported: false,
      steps: [],
      leftOut: [],
      notes: ['New Outlook and Outlook on the web only offer ready-made search folders, and none of them matches this search. Keep the query and paste it into the search box when you need it.'],
    };
  }
  const leftOut = usedParts(c).filter((p) => !pick.covers.includes(p));
  const steps = [
    'In the folder pane, find Search folders under your mailbox and select Create new search folder.',
    `Choose "${pick.type}"${pick.param ? `, then ${pick.param}` : ''}.`,
  ];
  const folder = String(c.folder ?? '').trim();
  if (folder && folder.toLowerCase() !== 'all folders') steps.push(`Turn on "Filter to specific folders" and pick "${folder}".`);
  steps.push('Select Create.');
  return {
    supported: true,
    steps,
    leftOut,
    notes: ['Custom search folders exist only in Outlook Classic. Ones made there do not show here.'],
  };
}

function macSteps() {
  return {
    supported: true,
    steps: [
      'Click in the search box and choose the scope (Current Folder, Current Mailbox or All Mailboxes).',
      'Select the filter icon, add the same criteria as this search, then choose Save Search.',
      'It appears under Saved Searches in the sidebar. Right-click it to edit or delete.',
    ],
    leftOut: [],
    notes: ['Saved searches stay on this Mac and do not appear in Outlook on other devices. We have not confirmed whether typed search text is kept, so use the filter fields.'],
  };
}

export function searchFolderSteps(clientKey, criteria, { now = new Date() } = {}) {
  const c = criteria || {};
  if (clientKey === 'classic') return classicSteps(c, now);
  if (clientKey === 'modern') return modernSteps(c);
  if (clientKey === 'mac') return macSteps(c);
  return { supported: false, steps: [], leftOut: [], notes: ['Outlook mobile cannot create or show search folders.'] };
}
