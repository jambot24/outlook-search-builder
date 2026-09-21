# Outlook Search Builder

A one-page site that builds Outlook search queries. You fill in a form and it produces the
query text for each version of Outlook:

- Outlook Classic for Windows
- New Outlook for Windows and Outlook on the web
- Outlook for Mac
- Outlook mobile (iOS and Android)

The versions do not share one search syntax. Classic uses Instant Search keywords such as
`read:no` and `messagesize:>5 MB`. The newer clients use a different table, such as `isflagged:yes`
and `received:01/01/2026..03/31/2026`. Where a client does not document a keyword, the query
carries a warning that says so and names the filter to use instead.
`docs/SYNTAX.md` lists every keyword, its support level per client, and the source.

## Features

- **Queries for all four clients at once**, each with its own Copy button.
- **Chip inputs.** Press Enter after each name, word or phrase. Each chip is one term, so a phrase
  needs no quoting.
- **File-type picker:** PDF, Word, Excel, PowerPoint, CSV, images, archives, calendar files and
  attached emails.
- **Dates that stay correct.** Periods a client does not understand are written as a date range, and
  "in the last N days" and "more than N days ago" are available. Saved searches recalculate them.
- **Search folder steps** for each version: Classic dialog fields, the closest ready-made folder in
  new Outlook and on the web, Save Search on Mac.
- **Library** of built-in searches, including an Inbox zero set that says what to do with the
  results.
- **Find similar.** Drop an .eml or .msg to build a query from its sender, subject, attachments
  and dates. The file is read in the browser and never uploaded or stored.
- **Saved searches** in the browser's local storage. Nothing is sent to a server.
- **Export and import.** JSON is the backup format and imports back in. CSV holds one row per
  search with the query for every client, for spreadsheets and documentation.
- **Share links.** The search criteria are encoded in the URL fragment, which browsers do not
  send to the server.
- **Optional Microsoft sign-in** (work, school or personal account) that lists the user's mail
  folders to pick from. It requests `Mail.ReadBasic`, the smallest permission that can list
  folders. Outlook has no folder keyword, so the chosen folder becomes a scope instruction.

## Stack

Plain HTML, CSS and ES modules. There is no build step and no runtime dependency except MSAL,
which loads from jsDelivr, pinned with a Subresource Integrity hash, and only when someone clicks Sign in.

```
index.html          the page
styles.css
js/query.js         criteria -> query text per client (pure, tested)
js/storage.js       saved searches, export, import (pure, tested)
js/graph.js         optional sign-in and folder list (MSAL + Microsoft Graph)
js/app.js           DOM wiring
js/config.js        public config: the Entra app's client ID
auth/redirect.html  sign-in popup landing page
_headers            Cloudflare Pages security headers (CSP)
```

## Development

```bash
npm test            # unit tests with coverage (Node 20+)
npm run serve       # http://localhost:8788
```

## Enabling Microsoft sign-in

Sign-in stays hidden until `js/config.js` has a client ID. To enable it:

1. In Microsoft Entra ID, register an application with **Supported account types** set to
   "Accounts in any organizational directory and personal Microsoft accounts".
2. Add a **Single-page application** platform with the redirect URI
   `https://<site>/auth/redirect.html`, plus `http://localhost:8788/auth/redirect.html` for
   local development.
3. Under API permissions, add Microsoft Graph delegated **Mail.ReadBasic**.
4. Put the Application (client) ID in `js/config.js`. It is a public identifier, not a secret.

Work tenants that block user consent will ask a tenant admin to approve the app the first
time someone from that tenant signs in.

## Deployment

Cloudflare Pages serves the repository root. There is no build command and the output
directory is `/`. Pushes to `main` deploy to production.

## License

MIT
