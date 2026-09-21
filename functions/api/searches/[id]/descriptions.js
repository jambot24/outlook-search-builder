// POST /api/searches/:id/descriptions  { text }   signed-in + Turnstile
import { handle, json, readJson } from '../../../_lib/http.js';
import { requireUser } from '../../../_lib/auth.js';
import { requireHuman } from '../../../_lib/turnstile.js';
import { validateDescription, validateTarget } from '../../../_lib/validate.js';
import { addDescription } from '../../../_lib/community.js';

export const onRequestPost = handle(async ({ request, env, params }) => {
  const author = await requireUser(request, env);
  const { id } = validateTarget('search', params.id);
  const text = validateDescription((await readJson(request)).text);
  await requireHuman(request, env);
  return json(await addDescription(env.DB, { searchId: id, text, author }), 201);
});
