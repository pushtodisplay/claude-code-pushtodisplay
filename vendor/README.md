# Vendored pushtodisplay CLI

This directory contains the pinned `pushtodisplay` CLI release **0.1.19**,
copied from the published npm package:

- `dist/cli.js` — the CLI entry point
- `dist/chunk-QY53JUBO.js`, `dist/open-CQX2MEZ6.js` — CLI runtime helpers
- `package.json` — upstream package metadata
- `LICENSE` — upstream license
- `README.md` — upstream README
- `THIRD_PARTY_LICENSES.txt` — upstream third-party notices

The upstream MCP server bundles (`dist/mcp-server*.js`) are intentionally
omitted: this plugin never invokes `pushtodisplay mcp`, and those files are
larger than the Claude plugin directory's per-file size limit.

## Why vendored

The published `pushtodisplay@0.1.19` package includes an `npm-shrinkwrap.json`
whose dependency tree makes `npm ci` install hundreds of unrelated packages and
fail with `EBADPLATFORM` on some operating systems. Vendoring the exact release
keeps the plugin self-contained, makes `npm ci` reproducible, and avoids
depending on that shrinkwrap.

Resolution order is internal: an explicit `PUSHTODISPLAY_CLI` override for
testing, then the vendored copy (or an installed `node_modules/pushtodisplay`),
then a binary on `PATH`. If none exists the plugin reports a missing CLI and
stops; it never downloads a package at runtime.

## Updating

1. Download the new release:

   ```bash
   npm pack pushtodisplay@X.Y.Z
   tar -xzf pushtodisplay-X.Y.Z.tgz
   ```

2. Replace `dist/cli.js`, `dist/chunk-QY53JUBO.js`, `dist/open-CQX2MEZ6.js`,
   `package.json`, `LICENSE`, `README.md`, and `THIRD_PARTY_LICENSES.txt` with
   the files from the new package. Do **not** copy `npm-shrinkwrap.json` or the
   `dist/mcp-server*.js` bundles.

3. Update `PUSHTODISPLAY_CLI_VERSION` in `lib/cli-adapter.mjs` and the pinned
   version in this file.

4. Run `npm run check`, then `npm pack --dry-run`, and verify that
   `vendor/pushtodisplay/dist/cli.js` is included.
