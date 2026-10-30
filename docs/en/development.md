# Development

## How it works

```text
Rendered HTML → DOM capture → Scene IR → SVG emitter → SVG file
                                  ↑
                       Backend raster captures
```

The browser computes layout. The capture core reads DOM geometry and computed styles into a scene representation; the emitter translates that scene into SVG. Backends supply browser access, screenshots, and font resolution where available.

| Directory | Purpose |
| --- | --- |
| `src/core/` | DOM capture, scene types, SVG emission; no Node runtime dependency. |
| `src/backends/node/` | Playwright integration, font resolution, CLI, and diff patches. |
| `src/backends/browser/` | In-page API and raster adapter utilities. |
| `src/backends/extension/` | Manifest V3 popup, capture worker, content script, and viewer. |
| `test/` | Unit tests, HTML fixtures, and visual regression tests. |
| `examples/` | Ant Design and MUI example applications. |
| `homepage/` | Project website and sample assets. |

See [DESIGN.md](../../DESIGN.md) for implementation details and [fidelity research](../fidelity-research.md) for additional investigation. These documents are currently in Chinese.

## Development and validation

```bash
pnpm build
pnpm build:extension
pnpm test

# Compare your own HTML or URL with its SVG render
pnpm validate ./homepage/public/examples/card.html card 520 360 embed
pnpm validate https://example.com example 1280 720

# Build, serve, and compare the example applications
pnpm validate:example antd-app 1280
pnpm validate:example mui-app 1280
```

Validation writes `<name>.svg`, `<name>.expected.png`, `<name>.actual.png`, and `<name>.diff.png` to `test/visual/__out__/`. Example validation exits with a failure if the pixel-diff ratio exceeds `FH_THRESHOLD` (default `0.02`, or 2%); set `FH_THRESHOLD=0.01` for a 1% threshold. The standalone `pnpm validate` command reports the diff without applying that threshold.

Development and visual-test helpers use `@sparticuz/chromium` or `CHROMIUM_PATH`; the production Node API uses Playwright Chromium unless `executablePath` is supplied.

Optional suites:

```bash
# Requires a Chromium build capable of loading extensions
EXTENSION_E2E=1 pnpm exec vitest run test/visual/extension-e2e.test.ts

# Requires access to external sites
REALWORLD_TESTS=1 pnpm exec vitest run test/visual/realworld.test.ts
```

[CI](../../.github/workflows/ci.yml) builds TypeScript and the extension and runs the test suite for pull requests to `main` and configured push branches. The full extension E2E job runs on configured pushes.

## Contributing

[Issues](https://github.com/0x0079/fith/issues) and pull requests are welcome. For rendering bugs, include a minimal HTML reproduction, capture backend, viewport dimensions, font mode, and screenshots or validation artifacts.

For rendering changes, add a focused fixture or regression test. Run `pnpm build`, `pnpm build:extension`, and `pnpm test` before submitting. Use PR titles such as `docs(readme): improve bilingual setup instructions` or `bugfix(capture): preserve clipped text`.

## Releases

A `vX.Y.Z` tag publishes the package; see [.design/release.md](../../.design/release.md).
