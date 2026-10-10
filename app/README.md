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

For automated Bugs Are Gone Runs, the default-branch
`.bugs-are-gone/policy.yaml` selects locked dependency preparation and these
repository-root verification commands:

```sh
bun install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org
bun --no-install --no-env-file run app:build
bun --no-install --no-env-file run app:verify
```

`app:verify` runs the unit and browser suites together, so frontend regressions
are covered. Install Playwright Chromium and its system libraries during host
preparation, before starting a Run. Verification disables Bun automatic package
installation and `.env` loading in the nested Bun entry points, including the
browser-test API server. The normal development `api` command remains unchanged.
This is trusted-script preparation, not OS-level network isolation.
