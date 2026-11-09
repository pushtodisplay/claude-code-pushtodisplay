# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-11-09

### Added

- A per-Claude-Code setup marker (`~/.cache/pushtodisplay/claude-code/setup.json`)
  written only after auth is valid and a test entry succeeds.
- `/pushtodisplay:pushtodisplay-setup`, which logs in if needed, sends one test
  entry, then records setup for this integration.
- Tests for setup gating: valid auth without a marker sends nothing, setup writes
  the marker and sends the test, the marker plus valid auth sends, the marker
  plus invalid auth drops updates, and markers are isolated per integration.

### Changed

- Hooks and drainers now require both the setup marker and valid auth. A fresh
  install stays silent even when another integration on the same machine is
  already logged in.
- Re-authentication (`/pushtodisplay:pushtodisplay-login`) leaves an existing
  setup marker in place.
- The pinned `pushtodisplay` 0.1.19 CLI is vendored under `vendor/` instead of
  installed as an npm dependency, so `npm ci` is reproducible and does not pull
  in the CLI package's shrinkwrapped dependency tree.
- README, command docs, and troubleshooting now describe one marketplace install
  plus one setup action. Global CLI, `npx`, and direct-CLI instructions were
  removed from user-facing docs; developer details moved to
  [`docs/maintainers.md`](docs/maintainers.md).

## [0.1.1] - 2026-11-09

### Changed

- Removed the unpinned package-launcher fallback. The plugin now uses the
  bundled `pushtodisplay` dependency or a `pushtodisplay` binary on `PATH`, and
  reports a clear install error when neither is available. It never downloads a
  package at runtime.
- `npm run validate:plugin` now calls the installed Claude Code CLI instead of
  an unpinned package launcher.
- Regenerated `package-lock.json` with npm 11. The previous lockfile carried
  extraneous nested entries from the `pushtodisplay` package's own shrinkwrap;
  the trimmed lockfile is 41 KiB instead of 342 KiB. It still pins
  `pushtodisplay` 0.1.18 and installs cleanly with `npm ci`.
- Documented the network destinations, local and server-side retention, and the
  no-runtime-download behavior in the README.
- Added the directory submission packet in
  [`docs/directory-submission.md`](docs/directory-submission.md).

## [0.1.0] - 2026-11-08

### Added

- Initial Push To Display plugin for Claude Code: ten hooks, four slash
  commands, per-session state, OAuth auth gating, a bounded send queue, unit
  tests, and a hook integration test.
