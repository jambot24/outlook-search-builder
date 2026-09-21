// POST /api/vote  { type: 'search'|'description', id, value: 1|-1|0 }   signed-in
// Votes skip Turnstile: they need a signed-in account, count once per account and are rate limited.
import { handle, json, readJson } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';
import { validateTarget, ValidationError } from '../_lib/validate.js';
import { vote } from '../_lib/community.js';

export const onRequestPost = handle(async ({ request, env }) => {
  const voter = await requireUser(request, env);
  const body = await readJson(request);
  const { type, id } = validateTarget(body.type, body.id);
  if (![1, -1, 0].includes(body.value)) throw new ValidationError('Vote must be 1, -1 or 0.');
  return json(await vote(env.DB, { type, id, value: body.value, voter }));
});
