# Conduit full-stack example

This runnable RealWorld implementation lives alongside the spec and docs. It
uses Bun, Hono, SQLite, React, and Vite, and serves the same API contract under
`/api` that is described in `../specs/api/openapi.yml`.

## Run locally

Install Bun, then from the repository root:

```sh
bun install
cd app && bun run api
```

In another terminal, run the frontend:

```sh
bun run web -- --port 5173
```

Open <http://localhost:5173/>. The Vite dev server proxies `/api` to the backend
on port 8000. SQLite data is stored in `app/data/conduit.sqlite`; set
`CONDUIT_DB_PATH` to select another database file.

## Verify

```sh
bun run build
bun run test
bun run test:api
bun run test:e2e
```

The E2E command runs three focused smoke tests for registration/session restore,
article/comment publishing, and profile updates; it starts both servers
automatically. The first Playwright run may need `bunx playwright install chromium`.
