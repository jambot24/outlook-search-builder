// GET  /api/searches?category=&sort=top|new&limit=&offset=   public list (auth optional, adds myVote)
// POST /api/searches  { title, category, criteria, description? }   signed-in + Turnstile
import { handle, json, readJson } from '../_lib/http.js';
import { optionalUser, requireUser } from '../_lib/auth.js';
import { requireHuman } from '../_lib/turnstile.js';
import { validateCategory, validateCriteria, validateDescription, validateTitle, ValidationError } from '../_lib/validate.js';
import { createSearch, listSearches } from '../_lib/community.js';
import { CATEGORY_KEYS } from '../../public/js/library.js';

export const onRequestGet = handle(async ({ request, env }) => {
  const url = new URL(request.url);
  const category = url.searchParams.get('category') || '';
  if (category && !CATEGORY_KEYS.has(category)) throw new ValidationError('Unknown category.');
  const viewer = await optionalUser(request, env);
  const data = await listSearches(env.DB, {
    category,
    sort: url.searchParams.get('sort') === 'new' ? 'new' : 'top',
    limit: url.searchParams.get('limit'),
    offset: url.searchParams.get('offset'),
    viewer,
  });
  return json(data);
});

export const onRequestPost = handle(async ({ request, env }) => {
  const author = await requireUser(request, env);
  const body = await readJson(request);
  const input = {
    title: validateTitle(body.title),
    category: validateCategory(body.category),
    criteria: validateCriteria(body.criteria),
    description: validateDescription(body.description, { optional: true }),
  };
  await requireHuman(request, env);
  return json(await createSearch(env.DB, { ...input, author }), 201);
});
