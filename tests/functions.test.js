// Backend tests: token verification, validation, the data layer against a real local D1
// (via wrangler's platform proxy), and the route handlers end to end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { checkClaims, verifyIdToken, userKey, AuthError, resetJwksCacheForTests } from '../functions/_lib/auth.js';
import { validateCriteria, validateTitle, validateDescription, validateCategory, validateTarget, criteriaKey, cleanText, ValidationError } from '../functions/_lib/validate.js';
import * as community from '../functions/_lib/community.js';
import * as searchesRoute from '../functions/api/searches.js';
import * as voteRoute from '../functions/api/vote.js';
import * as reportRoute from '../functions/api/report.js';
import * as deleteRoute from '../functions/api/delete.js';
import * as descriptionsRoute from '../functions/api/searches/[id]/descriptions.js';

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';
const TID = '9188040d-6c67-4c5b-b112-36a304b66dad';
const oid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const nowS = () => Math.floor(Date.now() / 1000);

// ---------- token helpers ----------

let signingKey;
let jwks;
const KID = 'test-key';

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

async function makeToken(claims, { kid = KID, key = signingKey?.privateKey } = {}) {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

function goodClaims(n = 1, extra = {}) {
  return { aud: CLIENT_ID, tid: TID, oid: oid(n), iss: `https://login.microsoftonline.com/${TID}/v2.0`, exp: nowS() + 3600, nbf: nowS() - 10, ...extra };
}

const jwksFetch = async () => new Response(JSON.stringify(jwks), { status: 200 });

// ---------- platform ----------

let proxy;
let db;
let realFetch;
let turnstileOk = true;

before(async () => {
  signingKey = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const pub = await crypto.subtle.exportKey('jwk', signingKey.publicKey);
  jwks = { keys: [{ kty: 'RSA', kid: KID, n: pub.n, e: pub.e, use: 'sig' }] };

  proxy = await getPlatformProxy({ configPath: new URL('./wrangler.test.toml', import.meta.url).pathname, persist: false });
  db = proxy.env.DB;
  const sql = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const stmt of sql.split(';').map((x) => x.trim()).filter(Boolean)) await db.prepare(stmt).run();

  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/discovery/v2.0/keys')) return jwksFetch();
    if (u.includes('turnstile/v0/siteverify')) return new Response(JSON.stringify({ success: turnstileOk }));
    return realFetch(url, init);
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await proxy?.dispose();
});

// ---------- auth ----------

test('checkClaims accepts a valid token and rejects each bad claim', () => {
  assert.ok(checkClaims(goodClaims(), CLIENT_ID));
  const bad = [
    { aud: 'other' },
    { tid: 'nope' },
    { oid: undefined },
    { iss: 'https://evil.example/v2.0' },
    { exp: nowS() - 1000 },
    { exp: undefined },
    { nbf: nowS() + 1000 },
  ];
  for (const b of bad) assert.throws(() => checkClaims(goodClaims(1, b), CLIENT_ID), AuthError, JSON.stringify(b));
});

test('verifyIdToken checks the signature against the JWKS', async () => {
  resetJwksCacheForTests();
  const claims = await verifyIdToken(await makeToken(goodClaims()), CLIENT_ID, jwksFetch);
  assert.equal(claims.oid, oid(1));

  const other = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  await assert.rejects(verifyIdToken(await makeToken(goodClaims(), { key: other.privateKey }), CLIENT_ID, jwksFetch), /signature/);
  await assert.rejects(verifyIdToken(await makeToken(goodClaims(), { kid: 'missing' }), CLIENT_ID, jwksFetch), /Unknown signing key/);
  await assert.rejects(verifyIdToken('a.b', CLIENT_ID, jwksFetch), /Malformed/);
  await assert.rejects(verifyIdToken('x', '', jwksFetch), /not configured/);
  const none = `${b64url(JSON.stringify({ alg: 'none', kid: KID }))}.${b64url('{}')}.`;
  await assert.rejects(verifyIdToken(none, CLIENT_ID, jwksFetch), /algorithm/);
});

test('userKey is a stable hash that does not contain the account id', async () => {
  const a = await userKey(goodClaims(1));
  assert.equal(a, await userKey(goodClaims(1)));
  assert.notEqual(a, await userKey(goodClaims(2)));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.ok(!a.includes('000000000001'));
});

// ---------- validation ----------

test('validateCriteria canonicalises and drops personal or orphaned fields', () => {
  const out = validateCriteria({
    from: '  jane  ', folder: 'Inbox', includeDeleted: 'yes', dateFormat: 'dmy', dateField: 'received',
    datePreset: 'today', date2: '2026-01-01', sizeOp: '>', unknown: 'x',
  });
  assert.deepEqual(out, { from: 'jane' });
  assert.deepEqual(
    validateCriteria({ dateMode: 'between', date1: '2026-01-01', date2: '2026-02-01', dateField: 'sent', datePreset: 'today' }),
    { dateMode: 'between', dateField: 'sent', date1: '2026-01-01', date2: '2026-02-01' },
  );
  assert.deepEqual(validateCriteria({ dateMode: 'preset', datePreset: 'today', date1: '2026-01-01' }), { dateMode: 'preset', datePreset: 'today' });
  assert.deepEqual(validateCriteria({ sizeOp: '>', sizeMb: '05' }), { sizeOp: '>', sizeMb: '5' });
});

test('validateCriteria rejects bad values and empty searches', () => {
  assert.throws(() => validateCriteria(null), ValidationError);
  assert.throws(() => validateCriteria([]), ValidationError);
  assert.throws(() => validateCriteria({ read: 'maybe' }), /read/);
  assert.throws(() => validateCriteria({ date1: '1/1/2026', dateMode: 'on' }), /date1/);
  assert.throws(() => validateCriteria({ sizeOp: '>', sizeMb: '-1' }), /size/);
  assert.throws(() => validateCriteria({ from: 'x'.repeat(201) }), /too long/);
  assert.throws(() => validateCriteria({ folder: 'Inbox' }), /empty/);
});

test('criteriaKey ignores key order and case', () => {
  assert.equal(criteriaKey({ from: 'Jane', read: 'no' }), criteriaKey({ read: 'no', from: 'jane' }));
});

test('text validators enforce lengths and strip control characters', () => {
  assert.equal(cleanText('a\u0000b\u202e c\n\nd'), 'a b c d');
  assert.equal(validateTitle('  Big   files '), 'Big files');
  assert.throws(() => validateTitle('ab'), ValidationError);
  assert.throws(() => validateTitle('x'.repeat(81)), ValidationError);
  assert.equal(validateDescription('', { optional: true }), '');
  assert.throws(() => validateDescription(''), ValidationError);
  assert.throws(() => validateDescription('x'.repeat(141)), ValidationError);
  assert.equal(validateDescription('Finds the big stuff'), 'Finds the big stuff');
  assert.equal(validateCategory('finance'), 'finance');
  assert.throws(() => validateCategory('nope'), ValidationError);
  assert.throws(() => validateTarget('user', oid(1)), ValidationError);
  assert.throws(() => validateTarget('search', 'x; DROP TABLE'), ValidationError);
});

// ---------- data layer ----------

const author = (n) => `author-${n}`;

test('community: create, list, duplicate, description, vote, report, delete', async () => {
  const { id } = await community.createSearch(db, {
    title: 'Big files', category: 'cleanup', criteria: { sizeOp: '>', sizeMb: '10' }, description: 'Finds very large mail', author: author(1),
  });
  let list = await community.listSearches(db, { viewer: author(1) });
  assert.equal(list.searches.length, 1);
  assert.equal(list.searches[0].score, 1);
  assert.equal(list.searches[0].myVote, 1);
  assert.equal(list.searches[0].mine, true);
  assert.equal(list.searches[0].descriptions[0].text, 'Finds very large mail');

  await assert.rejects(
    community.createSearch(db, { title: 'Dup', category: 'cleanup', criteria: { sizeMb: '10', sizeOp: '>' }, author: author(2) }),
    (err) => err.data?.id === id,
  );

  await community.addDescription(db, { searchId: id, text: 'Good for freeing up space', author: author(2) });
  await assert.rejects(community.addDescription(db, { searchId: id, text: 'Second try from me', author: author(2) }), /already described/);

  assert.deepEqual(await community.vote(db, { type: 'search', id, value: 1, voter: author(2) }), { score: 2, myVote: 1 });
  assert.deepEqual(await community.vote(db, { type: 'search', id, value: -1, voter: author(2) }), { score: 0, myVote: -1 });
  assert.deepEqual(await community.vote(db, { type: 'search', id, value: 0, voter: author(2) }), { score: 1, myVote: 0 });

  list = await community.listSearches(db, { viewer: '', category: 'cleanup' });
  assert.equal(list.searches[0].descriptions.length, 2);
  assert.equal(list.searches[0].myVote, 0);
  assert.equal((await community.listSearches(db, { category: 'finance' })).searches.length, 0);

  for (const n of [3, 4]) await community.report(db, { type: 'search', id, reporter: author(n) });
  await community.report(db, { type: 'search', id, reporter: author(3) }); // repeat report does not count twice
  assert.equal((await community.listSearches(db, {})).searches.length, 1);
  await community.report(db, { type: 'search', id, reporter: author(5) });
  assert.equal((await community.listSearches(db, {})).searches.length, 0, 'hidden at 3 reports');

  await db.prepare("UPDATE searches SET moderation = 'approved' WHERE id = ?1").bind(id).run();
  assert.equal((await community.listSearches(db, {})).searches.length, 1, 'approved overrides reports');

  await assert.rejects(community.removeOwn(db, { type: 'search', id, author: author(2) }), /Nothing of yours/);
  await community.removeOwn(db, { type: 'search', id, author: author(1) });
  assert.equal((await community.listSearches(db, {})).searches.length, 0);
  await assert.rejects(community.vote(db, { type: 'search', id, value: 1, voter: author(2) }), /no longer exists/);
});

test('community: a score of -5 hides a search', async () => {
  const { id } = await community.createSearch(db, { title: 'Downvoted', category: 'other', criteria: { allWords: 'zzz' }, author: author(10) });
  for (let n = 11; n <= 16; n += 1) await community.vote(db, { type: 'search', id, value: -1, voter: author(n) });
  const all = await community.listSearches(db, { category: 'other' });
  assert.equal(all.searches.find((s) => s.id === id), undefined);
});

test('community: daily submission limit', async () => {
  const who = author(99);
  for (let i = 0; i < community.LIMITS.submissions; i += 1) {
    await community.createSearch(db, { title: `Limit ${i}`, category: 'other', criteria: { allWords: `limit${i}` }, author: who });
  }
  await assert.rejects(
    community.createSearch(db, { title: 'One too many', category: 'other', criteria: { allWords: 'overlimit' }, author: who }),
    /a day/,
  );
});

test('community: paging reports hasMore', async () => {
  const page = await community.listSearches(db, { category: 'other', limit: 3, sort: 'new' });
  assert.equal(page.searches.length, 3);
  assert.equal(page.hasMore, true);
});

// ---------- routes ----------

const env = () => ({ DB: db, MSAL_CLIENT_ID: CLIENT_ID, TURNSTILE_SECRET_KEY: 'test-secret' });

async function call(route, method, { path = '/api/x', body, token, human = true, params = {} } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (human) headers['CF-Turnstile-Token'] = 'tok';
  const request = new Request(`https://example.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await route(({ request, env: env(), params }));
  return { status: res.status, json: await res.json() };
}

test('routes: POST /api/searches requires sign-in, Turnstile and valid input', async () => {
  resetJwksCacheForTests();
  const token = await makeToken(goodClaims(50));
  const body = { title: 'Route search', category: 'finance', criteria: { allWords: 'routeword' } };

  assert.equal((await call(searchesRoute.onRequestPost, 'POST', { body })).status, 401);
  assert.equal((await call(searchesRoute.onRequestPost, 'POST', { body, token: 'garbage' })).status, 401);
  assert.equal((await call(searchesRoute.onRequestPost, 'POST', { body: { ...body, category: 'x' }, token })).status, 400);
  assert.equal((await call(searchesRoute.onRequestPost, 'POST', { body, token, human: false })).status, 400);
  turnstileOk = false;
  assert.equal((await call(searchesRoute.onRequestPost, 'POST', { body, token })).status, 400);
  turnstileOk = true;

  const created = await call(searchesRoute.onRequestPost, 'POST', { body, token });
  assert.equal(created.status, 201);
  assert.equal(created.json.success, true);
  assert.equal((await call(searchesRoute.onRequestPost, 'POST', { body, token })).status, 409);

  const listed = await call(searchesRoute.onRequestGet, 'GET', { path: '/api/searches?category=finance', token });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.data.searches[0].mine, true);
  assert.equal((await call(searchesRoute.onRequestGet, 'GET', { path: '/api/searches?category=bogus' })).status, 400);

  const id = created.json.data.id;
  const voter = await makeToken(goodClaims(51));
  const voted = await call(voteRoute.onRequestPost, 'POST', { body: { type: 'search', id, value: 1 }, token: voter });
  assert.deepEqual(voted.json.data, { score: 2, myVote: 1 });
  assert.equal((await call(voteRoute.onRequestPost, 'POST', { body: { type: 'search', id, value: 5 }, token: voter })).status, 400);

  const desc = await call(descriptionsRoute.onRequestPost, 'POST', { body: { text: 'Finds finance route mail' }, token: voter, params: { id } });
  assert.equal(desc.status, 201);
  assert.equal((await call(reportRoute.onRequestPost, 'POST', { body: { type: 'description', id: desc.json.data.id }, token })).status, 200);
  assert.equal((await call(deleteRoute.onRequestPost, 'POST', { body: { type: 'search', id }, token: voter })).status, 404);
  assert.equal((await call(deleteRoute.onRequestPost, 'POST', { body: { type: 'search', id }, token })).status, 200);
});

test('routes: bad JSON and wrong content type are 400, not 500', async () => {
  const token = await makeToken(goodClaims(60));
  const request = new Request('https://example.test/api/vote', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal((await voteRoute.onRequestPost({ request, env: env() })).status, 400);
  const plain = new Request('https://example.test/api/vote', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: 'x' });
  assert.equal((await voteRoute.onRequestPost({ request: plain, env: env() })).status, 400);
});

test('routes: 503 with a clear message when the database is not bound', async () => {
  const request = new Request('https://example.test/api/searches');
  const res = await searchesRoute.onRequestGet({ request, env: {} });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not switched on/);
});
