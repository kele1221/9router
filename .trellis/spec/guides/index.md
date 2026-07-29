# Spec Guides

Cross-package and cross-layer thinking guides for 9router.

## Available Guides

| Guide | Purpose |
|-------|---------|
| [Cross-Layer Thinking Guide](cross-layer-thinking-guide.md) | Request lifecycle, file conventions, import style, error handling, API pivot |
| [Code Reuse Thinking Guide](code-reuse-thinking-guide.md) | Where to add new code, reuse patterns, deduplication |

## When to Use

- **Cross-layer work**: Feature touches 3+ layers (API, SSE handler, engine, DB)
- **New provider/translator/executor**: Check code-reuse guide first
- **Bug prevention**: Read cross-layer guide for data flow understanding