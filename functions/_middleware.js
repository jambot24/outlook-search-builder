// Sends the production pages.dev host to the custom domain. DNS filters block
// outlook-search-builder.pages.dev; preview hosts (<hash>.outlook-search-builder.pages.dev)
// and local dev pass through untouched.
export const CANONICAL_ORIGIN = 'https://outlooksearchbuilder.kevinspellman.xyz';
const LEGACY_HOST = 'outlook-search-builder.pages.dev';

export const onRequest = async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.hostname.toLowerCase() !== LEGACY_HOST) return next();
  return Response.redirect(`${CANONICAL_ORIGIN}${url.pathname}${url.search}`, 301);
};
