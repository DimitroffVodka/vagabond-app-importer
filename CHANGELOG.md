# Changelog

All notable changes to the Vagabond App Importer fork are documented here.

## v2.5.3 — 2026-04-28

### Added
- **By URL** tab in the Character Browser: paste a vgbnd.app character URL or
  raw UUID and import without signing in.
- **Manual JSON paste fallback** that surfaces when the direct fetch is blocked
  by CORS (browser-mode Foundry, no proxy).
- New module settings: **Use CORS Proxy for URL Import** and **CORS Proxy URL
  Prefix** (defaults to `api.codetabs.com`).
- Localized strings for the new flow (TabUrl, UUIDLabel/Placeholder, JSONLabel,
  CORSHint, Fetching/Importing, ErrorNoInput/InvalidUUID/BadJSON, etc.).

### Changed
- Browser dialog now renders sign-in inline per tab instead of a separate Login
  view, so the URL tab is reachable without authenticating.
- Significant updates across `browser-dialog.mjs`, `firebase.mjs`, `sync.mjs`,
  `mapper.mjs`, `export.mjs`, and `unresolved-dialog.mjs` to support the new UI
  and import paths.
- Updated styles to cover the new URL panel and CORS hint.

### Fixed
- Restores work that existed in the local development copy but had not been
  pushed to `main` — v2.5.2 was missing all of it.

## v2.5.2 — 2026-04-28

### Changed
- Pointed `url`, `manifest`, and `download` in `module.json` at this fork
  (`DimitroffVodka/vagabond-app-importer`) instead of upstream
  (`mordachai/vagabond-app-importer`). This makes self-hosted/non-local Foundry
  installs check this fork for updates instead of being silently downgraded
  to whatever upstream publishes.

### Notes
- No script changes. URL imports continue to work the same way; remember to
  enable **Module Settings → Use CORS Proxy for URL Import** in browser-mode
  Foundry, since `vgbnd.app` does not send CORS headers.

## v2.5.1 — 2026-04-23

See [GitHub release](https://github.com/DimitroffVodka/vagabond-app-importer/releases/tag/v2.5.1).

## v2.5.0 — 2026-04-23

See [GitHub release](https://github.com/DimitroffVodka/vagabond-app-importer/releases/tag/v2.5.0).

## v2.4.0 — 2026-04-22

See [GitHub release](https://github.com/DimitroffVodka/vagabond-app-importer/releases/tag/v2.4.0).

## v2.3.1 — 2026-04-21

See [GitHub release](https://github.com/DimitroffVodka/vagabond-app-importer/releases/tag/v2.3.1).

## v2.3.0 — 2026-04-21

See [GitHub release](https://github.com/DimitroffVodka/vagabond-app-importer/releases/tag/v2.3.0).

## v2.1.1 — 2026-04-19

See [GitHub release](https://github.com/DimitroffVodka/vagabond-app-importer/releases/tag/v2.1.1).

## v2.0.1 — 2026-04-19

See [GitHub release](https://github.com/DimitroffVodka/vagabond-app-importer/releases/tag/v2.0.1).

## v1.0.3 — 2026-04-18

See [GitHub release](https://github.com/DimitroffVodka/vagabond-app-importer/releases/tag/v1.0.3).

## v1.0.2 — 2026-04-18

See [GitHub release](https://github.com/DimitroffVodka/vagabond-app-importer/releases/tag/v1.0.2).

## v1.0.0 — 2026-04-18

Initial fork release.
