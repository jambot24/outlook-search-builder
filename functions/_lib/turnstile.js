// Server-side Cloudflare Turnstile check. The site key is public; the secret key is a
// Pages secret (TURNSTILE_SECRET_KEY), set from the vault by deploy.sh, never in a file.

import { ValidationError } from './validate.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function requireHuman(request, env, fetchImpl = fetch) {
  if (!env.TURNSTILE_SECRET_KEY) throw new Error('TURNSTILE_SECRET_KEY is not configured.');
  const token = request.headers.get('CF-Turnstile-Token') || '';
  if (!token || token.length > 2048) throw new ValidationError('Complete the "verify you are human" check and try again.');
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) body.append('remoteip', ip);
  const res = await fetchImpl(VERIFY_URL, { method: 'POST', body });
  const outcome = await res.json().catch(() => ({}));
  if (!outcome.success) throw new ValidationError('The "verify you are human" check failed. Try again.');
}
