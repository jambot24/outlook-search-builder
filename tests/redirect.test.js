// The root middleware sends the production pages.dev host to the custom domain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, CANONICAL_ORIGIN } from '../functions/_middleware.js';

const passThrough = new Response('site', { status: 200 });

function run(url) {
  let nextCalled = false;
  const next = async () => { nextCalled = true; return passThrough; };
  return onRequest({ request: new Request(url), next }).then((res) => ({ res, nextCalled }));
}

test('redirects the production pages.dev host to the custom domain, keeping path and query', async () => {
  const { res, nextCalled } = await run('https://outlook-search-builder.pages.dev/auth/redirect.html?code=abc#x');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), `${CANONICAL_ORIGIN}/auth/redirect.html?code=abc`);
  assert.equal(nextCalled, false);
});

test('host match ignores case', async () => {
  const { res } = await run('https://Outlook-Search-Builder.pages.dev/');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), `${CANONICAL_ORIGIN}/`);
});

test('leaves preview deployments alone', async () => {
  const { res, nextCalled } = await run('https://1a2b3c4d.outlook-search-builder.pages.dev/');
  assert.equal(res, passThrough);
  assert.equal(nextCalled, true);
});

test('leaves the custom domain and local dev alone', async () => {
  for (const url of [`${CANONICAL_ORIGIN}/api/searches`, 'http://localhost:8788/']) {
    const { res, nextCalled } = await run(url);
    assert.equal(res, passThrough);
    assert.equal(nextCalled, true);
  }
});
