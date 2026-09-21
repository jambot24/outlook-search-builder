// Data access for community searches. Every query is parameterised.

import { LimitError, NotFoundError, ConflictError } from './http.js';
import { criteriaKey } from './validate.js';

export const HIDE_AT_REPORTS = 3;
export const HIDE_AT_SCORE = -5;
const DAY_MS = 24 * 60 * 60 * 1000;
export const LIMITS = { submissions: 10, votes: 300, reports: 30 };
const PAGE_MAX = 50;
const OFFSET_MAX = 10000;
const DESCRIPTIONS_PER_SEARCH = 3;

const VISIBLE = `(moderation = 'approved' OR (moderation = 'auto' AND reports < ${HIDE_AT_REPORTS} AND score > ${HIDE_AT_SCORE}))`;

function since(now) {
  return new Date(now.getTime() - DAY_MS).toISOString();
}

const LIMIT_MESSAGES = {
  submission: `You can share ${LIMITS.submissions} searches or descriptions a day. Try again tomorrow.`,
  vote: 'You have reached the daily vote limit. Try again tomorrow.',
  report: 'You have reached the daily report limit.',
};
const LIMIT_FOR = { submission: LIMITS.submissions, vote: LIMITS.votes, report: LIMITS.reports };

// Limits count the append-only action log, so deleting or un-voting cannot reset them.
async function assertAllowance(db, actor, kind, now) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM action_log WHERE actor = ?1 AND kind = ?2 AND created_at > ?3')
    .bind(actor, kind, since(now)).first();
  if ((row?.n ?? 0) >= LIMIT_FOR[kind]) throw new LimitError(LIMIT_MESSAGES[kind]);
}

function logAction(db, actor, kind, now) {
  return db.prepare('INSERT INTO action_log (actor, kind, created_at) VALUES (?1, ?2, ?3)').bind(actor, kind, now.toISOString());
}

// Whole numbers only: "Infinity", "1e21" or "0.5" would otherwise reach SQL as-is.
function pageNumber(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isSafeInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function listSearches(db, { category, sort, limit, offset, viewer }) {
  const size = pageNumber(limit, 20, 1, PAGE_MAX);
  const skip = pageNumber(offset, 0, 0, OFFSET_MAX);
  const order = sort === 'new' ? 's.created_at DESC' : 's.score DESC, s.created_at DESC';
  const where = [VISIBLE.replace(/\b(moderation|reports|score)\b/g, 's.$1')];
  const params = [viewer || ''];
  if (category) { where.push(`s.category = ?${params.length + 1}`); params.push(category); }

  const { results: searches } = await db.prepare(
    `SELECT s.id, s.title, s.category, s.criteria, s.created_at, s.score,
            COALESCE(v.value, 0) AS my_vote, (s.author = ?1) AS mine
       FROM searches s
       LEFT JOIN votes v ON v.target_type = 'search' AND v.target_id = s.id AND v.voter = ?1
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}
      LIMIT ${size + 1} OFFSET ${skip}`,
  ).bind(...params).all();

  const page = searches.slice(0, size);
  const ids = page.map((s) => s.id);
  const byId = new Map();
  if (ids.length) {
    const placeholders = ids.map((_, i) => `?${i + 2}`).join(',');
    const { results } = await db.prepare(
      `SELECT d.id, d.search_id, d.text, d.score, COALESCE(v.value, 0) AS my_vote, (d.author = ?1) AS mine
         FROM descriptions d
         LEFT JOIN votes v ON v.target_type = 'description' AND v.target_id = d.id AND v.voter = ?1
        WHERE d.search_id IN (${placeholders}) AND ${VISIBLE.replace(/\b(moderation|reports|score)\b/g, 'd.$1')}
        ORDER BY d.score DESC, d.created_at ASC`,
    ).bind(viewer || '', ...ids).all();
    for (const d of results) {
      const list = byId.get(d.search_id) || [];
      if (list.length < DESCRIPTIONS_PER_SEARCH) list.push(d);
      byId.set(d.search_id, list);
    }
  }

  return {
    searches: page.map((s) => ({
      id: s.id,
      title: s.title,
      category: s.category,
      criteria: JSON.parse(s.criteria),
      createdAt: s.created_at,
      score: s.score,
      myVote: s.my_vote,
      mine: Boolean(s.mine),
      descriptions: (byId.get(s.id) || []).map((d) => ({
        id: d.id, text: d.text, score: d.score, myVote: d.my_vote, mine: Boolean(d.mine),
      })),
    })),
    hasMore: searches.length > size,
  };
}

export async function createSearch(db, { title, category, criteria, description, author, now = new Date(), newId = () => crypto.randomUUID() }) {
  await assertAllowance(db, author, 'submission', now);
  const key = criteriaKey(criteria);
  const existing = await db.prepare(`SELECT id, title, ${VISIBLE} AS visible FROM searches WHERE criteria_key = ?1`).bind(key).first();
  if (existing?.visible) {
    throw new ConflictError('This search has already been shared. You can vote on it or add a description.', { id: existing.id, title: existing.title });
  }
  if (existing) {
    // Never reveal a hidden item's title: it may be the reason it was hidden.
    throw new ConflictError('This search was shared before and has been hidden by moderation.');
  }
  const id = newId();
  const at = now.toISOString();
  const statements = [
    db.prepare(
      `INSERT INTO searches (id, title, category, criteria, criteria_key, author, created_at, score)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)`,
    ).bind(id, title, category, JSON.stringify(criteria), key, author, at),
    // The author's own upvote, so a new search starts at 1 like most voting sites.
    db.prepare(`INSERT INTO votes (target_type, target_id, voter, value, created_at) VALUES ('search', ?1, ?2, 1, ?3)`).bind(id, author, at),
    logAction(db, author, 'submission', now),
  ];
  if (description) {
    statements.push(db.prepare(
      'INSERT INTO descriptions (id, search_id, text, author, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    ).bind(newId(), id, description, author, at));
  }
  await db.batch(statements);
  return { id };
}

export async function addDescription(db, { searchId, text, author, now = new Date(), newId = () => crypto.randomUUID() }) {
  const search = await db.prepare(`SELECT id FROM searches WHERE id = ?1 AND ${VISIBLE}`).bind(searchId).first();
  if (!search) throw new NotFoundError('That search no longer exists.');
  await assertAllowance(db, author, 'submission', now);
  const mine = await db.prepare('SELECT id FROM descriptions WHERE search_id = ?1 AND author = ?2').bind(searchId, author).first();
  if (mine) throw new ConflictError('You have already described this search.', { id: mine.id });
  const id = newId();
  await db.batch([
    db.prepare('INSERT INTO descriptions (id, search_id, text, author, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(id, searchId, text, author, now.toISOString()),
    logAction(db, author, 'submission', now),
  ]);
  return { id };
}

function tableFor(type) {
  return type === 'search' ? 'searches' : 'descriptions';
}

// value: 1, -1, or 0 to clear. Returns the new score.
export async function vote(db, { type, id, value, voter, now = new Date() }) {
  const table = tableFor(type);
  const target = await db.prepare(`SELECT id FROM ${table} WHERE id = ?1`).bind(id).first();
  if (!target) throw new NotFoundError('That item no longer exists.');
  // Clearing a vote is always allowed, so nobody gets stuck with a vote they want to undo.
  if (value !== 0) await assertAllowance(db, voter, 'vote', now);

  const change = value === 0
    ? db.prepare('DELETE FROM votes WHERE target_type = ?1 AND target_id = ?2 AND voter = ?3').bind(type, id, voter)
    : db.prepare(
      `INSERT INTO votes (target_type, target_id, voter, value, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (target_type, target_id, voter) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
    ).bind(type, id, voter, value, now.toISOString());
  const recount = db.prepare(
    `UPDATE ${table} SET score = (SELECT COALESCE(SUM(value), 0) FROM votes WHERE target_type = ?1 AND target_id = ?2) WHERE id = ?2`,
  ).bind(type, id);
  await db.batch(value === 0 ? [change, recount] : [change, recount, logAction(db, voter, 'vote', now)]);
  const row = await db.prepare(`SELECT score FROM ${table} WHERE id = ?1`).bind(id).first();
  return { score: row.score, myVote: value };
}

export async function report(db, { type, id, reporter, now = new Date() }) {
  const table = tableFor(type);
  const target = await db.prepare(`SELECT id FROM ${table} WHERE id = ?1`).bind(id).first();
  if (!target) throw new NotFoundError('That item no longer exists.');
  await assertAllowance(db, reporter, 'report', now);
  await db.batch([
    logAction(db, reporter, 'report', now),
    db.prepare('INSERT OR IGNORE INTO reports (target_type, target_id, reporter, created_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(type, id, reporter, now.toISOString()),
    db.prepare(`UPDATE ${table} SET reports = (SELECT COUNT(*) FROM reports WHERE target_type = ?1 AND target_id = ?2) WHERE id = ?2`)
      .bind(type, id),
  ]);
  return { reported: true };
}

// Authors can delete their own search or description. Everything attached to it goes in the
// same transaction: a search's descriptions, and the votes and reports on all of them.
export async function removeOwn(db, { type, id, author }) {
  const table = tableFor(type);
  const owned = await db.prepare(`SELECT id FROM ${table} WHERE id = ?1 AND author = ?2`).bind(id, author).first();
  if (!owned) throw new NotFoundError('Nothing of yours to delete there.');
  const statements = [];
  if (type === 'search') {
    const childIds = 'SELECT id FROM descriptions WHERE search_id = ?1';
    statements.push(
      db.prepare(`DELETE FROM votes WHERE target_type = 'description' AND target_id IN (${childIds})`).bind(id),
      db.prepare(`DELETE FROM reports WHERE target_type = 'description' AND target_id IN (${childIds})`).bind(id),
      db.prepare('DELETE FROM descriptions WHERE search_id = ?1').bind(id),
    );
  }
  statements.push(
    db.prepare('DELETE FROM votes WHERE target_type = ?1 AND target_id = ?2').bind(type, id),
    db.prepare('DELETE FROM reports WHERE target_type = ?1 AND target_id = ?2').bind(type, id),
    db.prepare(`DELETE FROM ${table} WHERE id = ?1 AND author = ?2`).bind(id, author),
  );
  await db.batch(statements);
  return { deleted: true };
}
