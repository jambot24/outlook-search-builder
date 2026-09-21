// POST /api/delete  { type, id }   signed-in; authors delete their own items
import { handle, json, readJson } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';
import { validateTarget } from '../_lib/validate.js';
import { removeOwn } from '../_lib/community.js';

export const onRequestPost = handle(async ({ request, env }) => {
  const author = await requireUser(request, env);
  const body = await readJson(request);
  const { type, id } = validateTarget(body.type, body.id);
  return json(await removeOwn(env.DB, { type, id, author }));
});
