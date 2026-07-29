# Provider Registry

## How Providers are Registered

`open-sse/providers/registry/` — one file per provider (101 files). Each exports a provider definition object with capabilities, auth types, default models, and quirks.

The `index.js` is **auto-generated** — a static import list built by `scripts/migrate-registry.mjs` / `injectDisplayToRegistry.mjs`.

**Rule**: Never hand-edit `open-sse/providers/registry/index.js`.

## Adding a Provider

1. Copy `open-sse/providers/REGISTRY_TEMPLATE.js` as a new file in `registry/`
2. Fill in capabilities, auth types, model list, quirks
3. Run the registry migration script to regenerate `index.js`
4. Add models to `open-sse/config/providerModels.js`

## Provider Capabilities

Derived from the registry definitions. Reference: `open-sse/providers/capabilities.js`

## Anti-patterns

- Don't skip the REGISTRY_TEMPLATE — the structure is validated by consumers
- Don't forget `providerModels.js` — the model list is used throughout the system for pricing, capabilities, and UI