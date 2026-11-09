# Maintainer notes

User-facing installation is the Claude Code marketplace path in the
[README](../README.md): install the plugin, restart, then run
`/pushtodisplay:pushtodisplay-setup`. Everything below is for development and
release work.

## Local checkout

```bash
git clone https://github.com/pushtodisplay/claude-code-pushtodisplay.git
cd claude-code-pushtodisplay
npm ci
claude --plugin-dir .
```

`--plugin-dir` loads the checkout for that session only. Run
`/pushtodisplay:pushtodisplay-setup` before expecting board updates; a checkout
with no setup marker stays silent.

## CLI resolution (internal)

The plugin never asks the user to install a CLI and never downloads a package at
runtime. `lib/cli-adapter.mjs` resolves, in order:

1. `PUSHTODISPLAY_CLI` — explicit executable path for tests and troubleshooting.
2. `vendor/pushtodisplay` — the pinned CLI shipped with the plugin.
3. `node_modules/pushtodisplay` — an npm dependency in a development checkout.
4. `pushtodisplay` on `PATH` — fallback for unusual installs.
5. Nothing — callers report a missing CLI and stop.

Only the first and last cases are ever needed in normal use: marketplace installs
use the vendored copy.

## Vendored CLI

`vendor/pushtodisplay` contains the pinned `pushtodisplay` release. The npm
package's own `npm-shrinkwrap.json` pulls in a large dependency tree and can fail
`npm ci` with `EBADPLATFORM` on some platforms, so the release is copied instead
of installed as a dependency. See [`vendor/README.md`](../vendor/README.md) for
the update procedure.

Keep `PUSHTODISPLAY_CLI_VERSION` in `lib/cli-adapter.mjs` equal to
`vendor/pushtodisplay/package.json`'s version; the manifest test enforces it.

## Checks

```bash
npm ci
npm run check
npm run validate:plugin
claude plugin validate . --profile directory --strict
```

## Release

The version lives in `package.json`, `package-lock.json`, and
`.claude-plugin/plugin.json`. Bump all three together (the manifest test enforces
that the plugin and package versions match), update `CHANGELOG.md`, then commit.

Distribution is the public GitHub marketplace; this repository has no npm
publish workflow. Pushing `main` is the release action. Directory submission
steps live in [`directory-submission.md`](directory-submission.md).
