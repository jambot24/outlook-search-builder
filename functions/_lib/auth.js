// Verifies Microsoft identity platform v2.0 ID tokens (work, school and personal accounts)
// and turns them into a pseudonymous user key. The raw account ID is never stored.

const JWKS_URL = 'https://login.microsoftonline.com/common/discovery/v2.0/keys';
const JWKS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_S = 300;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let jwksCache = { keys: null, fetchedAt: 0 };

export class AuthError extends Error {}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function decodeJson(segment) {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(segment)));
  } catch {
    throw new AuthError('Malformed token.');
  }
}

async function fetchJwks(fetchImpl, force) {
  const fresh = Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (jwksCache.keys && fresh && !force) return jwksCache.keys;
  const res = await fetchImpl(JWKS_URL);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = await res.json();
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

async function findKey(kid, fetchImpl) {
  let jwk = (await fetchJwks(fetchImpl, false)).find((k) => k.kid === kid);
  // Microsoft rotates keys; refetch once before rejecting an unknown kid.
  if (!jwk) jwk = (await fetchJwks(fetchImpl, true)).find((k) => k.kid === kid);
  if (!jwk) throw new AuthError('Unknown signing key.');
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

// Checks every claim that decides whether this token belongs to this app and is current.
// Exported separately so the claim rules can be tested without signatures.
export function checkClaims(claims, clientId, nowS = Math.floor(Date.now() / 1000)) {
  if (claims.aud !== clientId) throw new AuthError('Token was issued to a different application.');
  if (!GUID.test(claims.tid || '') || !GUID.test(claims.oid || '')) throw new AuthError('Token is missing the account identifiers.');
  if (claims.iss !== `https://login.microsoftonline.com/${claims.tid}/v2.0`) throw new AuthError('Unexpected token issuer.');
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) throw new AuthError('Token has expired. Sign in again.');
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > nowS) throw new AuthError('Token is not valid yet.');
  return claims;
}

export async function verifyIdToken(token, clientId, fetchImpl = fetch) {
  if (!clientId) throw new AuthError('Sign-in is not configured on this site.');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new AuthError('Malformed token.');
  const header = decodeJson(parts[0]);
  if (header.alg !== 'RS256' || !header.kid) throw new AuthError('Unsupported token algorithm.');
  const key = await findKey(header.kid, fetchImpl);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new AuthError('Token signature is invalid.');
  return checkClaims(decodeJson(parts[1]), clientId);
}

export async function userKey(claims) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${claims.tid}:${claims.oid}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Returns the user key, or null when no Authorization header is present.
// Throws AuthError when a header is present but the token is bad.
export async function optionalUser(request, env, fetchImpl = fetch) {
  const header = request.headers.get('Authorization') || '';
  if (!header) return null;
  const m = /^Bearer (\S+)$/.exec(header);
  if (!m) throw new AuthError('Malformed Authorization header.');
  return userKey(await verifyIdToken(m[1], env.MSAL_CLIENT_ID, fetchImpl));
}

export async function requireUser(request, env, fetchImpl = fetch) {
  const user = await optionalUser(request, env, fetchImpl);
  if (!user) throw new AuthError('Sign in with Microsoft to do this.');
  return user;
}

export function resetJwksCacheForTests() {
  jwksCache = { keys: null, fetchedAt: 0 };
}
