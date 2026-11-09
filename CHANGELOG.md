# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
