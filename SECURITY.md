# Security

## Reporting a vulnerability

Report vulnerabilities privately through
[GitHub security advisories](https://github.com/jambot24/outlook-search-builder/security/advisories/new).
Please do not open a public issue. We aim to reply within five working days.

## What is in scope

- **The site at https://outlook-search-builder.pages.dev** and its source in this repository.
- **The community API under `/api/`:** token verification, rate limits and moderation.
- **Email parsing in the browser:** a crafted `.eml` or `.msg` file that runs script, leaks data,
  or makes the page unusable.

## How the site protects users

- **Content Security Policy.** `public/_headers` allows scripts only from this site, the Microsoft
  sign-in library on jsDelivr (pinned, with a Subresource Integrity hash) and Cloudflare Turnstile.
- **Text only.** Page text, including community submissions and parsed email fields, is inserted
  with `textContent`, never as HTML.
- **Verified sign-in.** The API checks each Microsoft ID token's signature, audience, issuer and
  expiry. It stores only a SHA-256 hash of the tenant and object IDs.
- **Bot and abuse checks.** Writes that create content also require a Cloudflare Turnstile check.
  Each account is limited per day.
