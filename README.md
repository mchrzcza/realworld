<br/><br/>

![RealWorld Example Applications](assets/media/realworld-dual-mode.svg)

<p align="center">
  <img src="assets/media/frameworks.svg" alt="Frontend and Backend Frameworks" width="720"/>
</p>

<br/>

### See how [_the exact same_ Medium.com clone](https://demo.realworld.show) is built using different [frontends](https://codebase.show/projects/realworld?category=frontend) and [backends](https://codebase.show/projects/realworld?category=backend)

You can combine any frontend with any backend, because **they all adhere to the same [API spec](specs/api/)**

While most "todo" demos provide an excellent cursory glance at a framework's capabilities, they typically don't convey the knowledge required to actually build _real_ applications with it — nor the real-world constraints a minimal demo never has to face.

**RealWorld** solves this problem by providing the same demo app for each framework, at a sweet spot between simplicity and breadth.

Join us on [GitHub Discussions!](https://github.com/realworld-apps/realworld/discussions) 🎉

# Implementations

Over 100 implementations have been created using various languages, libraries, and frameworks.

Explore them on [**CodebaseShow**](https://codebase.show/projects/realworld).

## Spec-compliant backends

These backends pass the full [API spec test suite](https://docs.realworld.show/specifications/backend/introduction/):

- [**Nitro + Prisma + Zod**](https://github.com/realworld-apps/nitro-prisma-zod-realworld-example-app) — TypeScript
- [**Django Ninja**](https://github.com/c4ffein/realworld-django-ninja) — Python

## Runnable full-stack example

This repository also includes a runnable Bun, Hono, SQLite, and React
implementation in [`app/`](app/). The shared API contract and frontend tests in
[`specs/`](specs/) remain the source of truth; the app is an example
implementation that can be verified against them.

Install dependencies from the repository root:

```sh
make app-setup
```

Then start the API and frontend in separate terminals:

```sh
cd app && bun run api
```

```sh
cd app && bun run web
```

Open <http://localhost:5173/>. From the repository root, build and test the
app with:

```sh
make app-build
make app-test
make app-api-test
make app-e2e
```

`make app-api-test` expects the API server to be running on port 8000;
`make app-e2e` starts both servers automatically. See the
[app setup and verification guide](app/README.md) for database configuration
and test prerequisites.

# Create a new implementation

[**Create a new implementation >>>**](https://docs.realworld.show/implementation-creation/introduction/)

Or you can [view upcoming implementations (WIPs)](https://github.com/realworld-apps/realworld/discussions/categories/wip-implementations).

# Learn more

- [Documentation introduction](https://docs.realworld.show/introduction/)
- Every tutorial is built against the same [API spec](specs/api/) to ensure modularity of every frontend & backend
- A shared [CSS theme](assets/theme/styles.css) is provided to build frontend implementations with identical UI/UX
- A shared [E2E test suite](specs/e2e/) is available to validate frontend implementations
- There is a hosted version of the backend API available for public usage at [api.realworld.show](https://api.realworld.show), no API keys required — demo accounts are provided, and real accounts can't see each other
- There is an angular frontend plugged to this backend available at [demo.realworld.show](https://demo.realworld.show)
- Interested in creating a new RealWorld stack? View our [starter guide & spec](https://docs.realworld.show/implementation-creation/introduction/)

# Logo Attribution

See [LICENSES_LOGOS.md](docs/non-included/LICENSES_LOGOS.md) for framework logo licensing and attribution details.

# Active Maintainers

- **[c4ffein](https://github.com/c4ffein) - Maintainer** - maintains the spec, the test suites and the [demo website](https://demo.realworld.show)
- **[Manuel Vila](https://github.com/mvila) - Maintainer** - creator of the [Layr framework](https://layrjs.com) and the [CodebaseShow website](https://codebase.show/)
