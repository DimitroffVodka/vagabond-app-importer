# Changelog

All notable changes to the Vagabond App Importer fork are documented here.

## v2.6.1 — 2026-04-29

### Fixed
- **Homebrew classes/ancestries now import correctly.** vgbnd.app stores
  homebrew classes/ancestries on characters as the raw Firestore document
  UUID (e.g. `"5bb32641-2134-4bf8-a91f-e7468c1ed4e4"`) instead of a stable
  slug. The importer now detects UUID values, fetches `homebrew_content/<uuid>`
  via Firestore (auth or anonymous), and uses `data.name` as the item name
  for compendium lookup. Previously these surfaced as unresolved items.

### Added
- Mapper now searches `vagabond-character-enhancer.vce-classes`,
  `vce-ancestries`, and `vce-perks` as fallbacks after the official
  `vagabond.*` packs. So homebrew names that the user has populated in
  vce-* (Summoner, Dragoon, Jester, Monk, Psychic, Samurai for classes;
  the Spellbook 1 Preview ancestries) all resolve cleanly.

### Verified
- MrLawyerGuy (homebrew Summoner) imports with class "Summoner" attached
  from `vce-classes`, plus all perks, spells, and equipment.

## v2.6.0 — 2026-04-29

Two big additions: relic-forge integration and a much wider compendium
name-translation pass (the latter was originally going to ship as v2.5.6).

### Added — relic forge integration
- Items imported with `relic_powers` data from vgbnd.app are now auto-forged
  via `vagabond-crawler`'s `RelicForge.forgeItem` API (added in
  `vagabond-crawler` v1.16.1).
- Materials (silver, mythral, orichalum/orichalcum, etc.) are mapped to
  `system.metal` so the forged relic name picks up the metal suffix.
- Roman-numeral normalization for vgbnd.app's relic ids (`strike-i` →
  `strike-1` — vgbnd.app uses Roman, crawler uses Arabic).
- Fuzzy `display_name` lookup for vgbnd.app's `special` relic-power id
  (matches against the crawler's `RELIC_POWERS[].name`).
- If `vagabond-crawler` is not active, the importer leaves a `pendingRelic`
  flag on each affected item; install the crawler later to forge them.
- Verified end-to-end on Drako: 4 inventory items with relic_powers all
  forge correctly:
  - Heavy Armor + `bonus-armor-1` + orichalcum → "+1 Heavy Armor (Orichalcum)"
  - Longsword + `strike-i` + silver → "Minor Striking Longsword (Silver)"
  - Standard shield + `senses-nightvision` + mythral → "Standard shield of Darksight (Mythral)"
  - Katar + `special`/"Jumping I" → "Katar of Minor Jumping"

### Added — name translation
- `#STATIC_ALIASES` map in `mapper.mjs` for irregular cases that don't fit
  any general rule.
- Parenthetical-qualifier strip in `#nameVariants` (`Trinket (magic)` →
  `Trinket`).
- Generalized comma-prefix swap rule — any 2+ word "X Y" name now also tries
  "Y, x" against the compendium (covers ~140 previously-unresolved items
  beyond the original fixed pivot list).
- `scroll` added to comma-prefix pivot tokens.

### Fixed
- More inventory items now resolve to compendium entries:
  - `Trinket (magic)` → `Trinket`
  - `Blank Scroll` → `Scroll, blank`
  - `Materials` → `Materials (1g)` (default tier; swap to `(50s)` manually
    if your character has the higher tier)
  - `Ingredients` → `Ingredients (1g)`
  - `Tarot Cards` / `Deck Tarot Cards` → `Cards - deck, tarot`
  - `Playing Cards` / `Deck Playing Cards` → `Cards - deck, playing`
  - `Marked Cards` / `Deck Marked Cards` → `Cards - deck, marked`
- `mapper.mjs` now preserves incoming `flags` and `system.metal` from the
  apiItem onto the resolved compendium clone (previously dropped, which
  broke any post-create flag-based step including relic-forge).

### Verified
- Vhul Mordis: 11/11 inventory items resolve.
- MrLawyerGuy: 16/16 (was 14/16 in v2.5.5).
- Drako: 14/14 inventory items resolve, 4 of them get auto-forged into
  proper relics with metal suffixes and ActiveEffects.
- Predicted-natural-form regression test against full compendium: 95% pass
  (1431/1505), up from 85% before this release.

### Notes
- Spec/tracking note `name_translation_open_questions.md` (Materials +
  Tarot Cards) is now resolved.
- New module relationship: `vagabond-crawler` is now an optional
  dependency for full relic support.

## v2.5.5 — 2026-04-28

### Added
- **Portraits import via the URL tab.** vgbnd.app's public `?format=foundry`
  endpoint strips both portraits (`character_image_base64`) and spells from
  the response; the underlying Firestore document keeps both. The URL handler
  now anonymously signs up a Firebase user (no account required) and reads
  the Firestore document directly — same path the sign-in import already
  uses. URL imports now produce actors with portraits, spells, and Dynamic
  Token Ring textures (when enabled), reaching parity with sign-in imports.
- New `VgbndFirebase.signInAnonymously()` — transient token, never persisted,
  used only for the duration of one URL import.

### Changed
- URL-tab handler architecture: Firestore (auth or anonymous) is now the
  primary path; `?format=foundry` is the fallback for non-public characters
  or other Firestore failures. Path uses the existing `#fromFirestore`
  transform, so spells, portraits, stats, perks, inventory, and DTR support
  all come through the same code that signed-in imports use.

### Notes
- Performance: signed-in URL import ~480 ms, anonymous ~600 ms (one extra
  request to mint the anon token). Within typical character-fetch latency.
- Private characters (`is_public: false`) still hit the foundry-shape
  fallback and miss portraits — no anonymous read access on those, by design
  on vgbnd.app's side.

## v2.5.4 — 2026-04-28

### Fixed
- **Spells now import via the URL tab.** vgbnd.app's `?format=foundry` endpoint
  silently strips spells from the response (`items[]` has zero entries of
  `type:"spell"` even when the character has `known_spells` populated). The
  URL-import path now does a second fetch against the native (non-foundry)
  shape, pulls `known_spells` and `ancestry_bonus_spell`, and injects them as
  `{name, type:"spell"}` entries so the existing mapper can resolve them
  against the `vagabond.spells` compendium — same path the sign-in import
  already used.
- Same fix applied to the Firestore-fallback API path in `#importByUuid`.

### Notes
- Spell descriptions still come from the compendium, not vgbnd.app — vgbnd.app
  has never exported spell text. If a spell name is missing from your
  compendium, the importer's "Unresolved" dialog will surface it for manual
  search/create as usual.
- The manual JSON-paste fallback (used when CORS blocks direct fetch and the
  proxy is off) does not yet merge spells. Sign in or enable the CORS proxy
  for a full import.

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
