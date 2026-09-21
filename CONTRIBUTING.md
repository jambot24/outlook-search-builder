# Contributing

Thank you for helping. The project has one rule above the others: **a keyword only goes in if we
can show where it comes from.** Outlook silently ignores syntax it does not understand, so a guess
produces a query that finds nothing and looks as if it worked.

## Reporting what works

The most useful contribution is a report from a real copy of Outlook. Open a
[Query result report](https://github.com/jambot24/outlook-search-builder/issues/new?template=query-report.yml)
with the version, the query you pasted and what happened. Replace real names and addresses with
placeholders such as `jane@contoso.com`.

## Changing a keyword

1. **Update `docs/SYNTAX.md`.** Add a row, or change one, with a source: a Microsoft page, or a
   linked query result report.
2. **Change `public/js/query.js`.** A keyword that is not documented for a version should still
   emit, with a warning naming the filter to use instead.
3. **Add a test in `tests/query.test.js`** for each version the change affects.

## Adding a built-in search

1. **Add an entry to `BUILT_INS` in `public/js/library.js`** with a unique `id`, a `title`, a
   `category` key and `criteria`.
   - Add a `note` when the search has a limit worth knowing.
   - Add an `action` when the results have an obvious next step.
2. **Run `npm test`.** The library test fails if the search renders an empty query or has no
   explanation in any version.

Category keys and file type keys are stored in saved and shared searches. Change a label freely, but
never rename a key.

## Development

```bash
npm ci
npm test
npm run serve    # http://localhost:8788
```

- **Code style:** match the surrounding code. The front end is plain ES modules with no framework.
  Text reaches the page through `textContent`, never `innerHTML`.
- **Commits:** use conventional commit messages (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

## Privacy

Dropped emails, saved searches and queries must stay in the browser. A change that sends any of
them to a server will not be accepted.
