.PHONY: help \
	bruno-generate \
	bruno-check \
	documentation-setup \
	documentation-dev \
	documentation-dev-host \
	documentation-build \
	documentation-preview \
	documentation-clean \
	app-setup \
	app-build \
	app-test \
	app-api-test \
	app-e2e

help:
	@echo "Bruno Collection:"
	@echo "  bruno-generate"
	@echo "  bruno-check"
	@echo ""
	@echo "Documentation:"
	@echo "  documentation-setup"
	@echo "  documentation-dev"
	@echo "  documentation-dev-host"
	@echo "  documentation-build"
	@echo "  documentation-preview"
	@echo "  documentation-clean"
	@echo ""
	@echo "Full-stack example:"
	@echo "  app-setup"
	@echo "  app-build"
	@echo "  app-test"
	@echo "  app-api-test"
	@echo "  app-e2e"

########################
# Bruno Collection

bruno-generate:
	bun specs/api/hurl-to-bruno.js

bruno-check:
	bun specs/api/hurl-to-bruno.js --check

########################
# Documentation

documentation-setup:
	cd docs && bun install

documentation-dev:
	cd docs && bun run dev

documentation-dev-host:
	cd docs && bun run dev --host

documentation-build:
	cd docs && bun run build

documentation-preview:
	cd docs && bun run preview

documentation-clean:
	rm -rf docs/.astro docs/dist docs/node_modules

########################
# Full-stack example

app-setup:
	bun install

app-build:
	cd app && bun run build

app-test:
	cd app && bun run test

app-api-test:
	cd app && bun run test:api

app-e2e:
	cd app && bun run test:e2e
