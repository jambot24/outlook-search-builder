// POST /api/report  { type, id }   signed-in + Turnstile
import { handle, json, readJson } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';
import { requireHuman } from '../_lib/turnstile.js';
import { validateTarget } from '../_lib/validate.js';
import { report } from '../_lib/community.js';

export const onRequestPost = handle(async ({ request, env }) => {
  const reporter = await requireUser(request, env);
  const body = await readJson(request);
  const { type, id } = validateTarget(body.type, body.id);
  await requireHuman(request, env);
  return json(await report(env.DB, { type, id, reporter }));
});
