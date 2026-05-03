# Changelog

All notable changes to the Vagabond App Importer fork are documented here.

## v2.8.0 — 2026-05-03

### Added
- **Advancement perks now auto-pick the stat bonus.** vgbnd.app exposes
  `advancementStats` (separate from the even-level `levelStats` bumps) — a
  per-stat tally of how each Advancement perk choice was spent. The
  importer now distributes those points back across each Advancement perk
  on the way in, then pre-fills the system's stat-choice dialog and
  suppresses its duplicate Active Effect (the stat value already includes
  `advancementStats`, so letting the system add another +1 would
  double-count). The perk name is annotated with the chosen stat label,
  e.g. `Advancement (Strength)`, so it's clear in the sheet.

### Fixed
- **Stat sum now includes `advancementStats`.** Previously the formula was
  `assignedStats + levelStats + strongPotentialStat`, silently omitting
  `advancementStats`. Characters with Advancement perks imported with
  stats lower than the canonical vgbnd.app value. Final stat is now
  `assignedStats + levelStats + advancementStats + strongPotentialStat`.
  Cross-check against the API's `derived_stats_<stat>` keys to confirm.
- **Spell list deduped.** Some ancestries (e.g. Elf) include their bonus
  spell in `known_spells` AND in `ancestry_bonus_spell` — a duplicate
  spell item was being created. Spells are now deduped by normalized name
  in both the actor's spell list and the perk-derived spell collection.
- **Compendium name resolution: three new aliases** in `mapper.mjs#STATIC_ALIASES`:
  - `Tindertwig` → `Torch, Tindertwig` (single-word name; the generic
    last-word pivot rule needs whitespace and can't fire).
  - `Unarmed` → `Unarmed (Brawl)` (the compendium has only the
    parenthetical Brawl/Finesse variants — no bare entry exists).
  - `Basic Torch` → `Torch` (vgbnd.app's "basic" qualifier doesn't appear
    in the compendium entry).

## v2.7.1 — 2026-04-29

### Fixed
- The link/refresh header button from v2.7.0 didn't appear on Vagabond's
  character sheet. Vagabond v5+ uses an ApplicationV2-based sheet
  (`VagabondCharacterSheet → ActorSheetV2 → DocumentSheetV2 → ApplicationV2`),
  but v2.7.0 only listened to the legacy `renderActorSheet` hook which
  doesn't fire reliably for V2 sheets. The hook is now wired into all three
  render hooks (`renderActorSheet`, `renderActorSheetV2`,
  `renderApplicationV2` filtered to actor sheets), with a single dedupe
  guard so the button only inserts once per sheet.
- Added a console log on insertion (`vgbnd-importer | Header button
  inserted for actor "X"`) so you can verify it's working.

## v2.7.0 — 2026-04-29

### Added
- **Link & Refresh existing actors.** Each character actor sheet now has a
  link icon in its header. If the actor isn't yet linked to a vgbnd.app
  character, clicking it prompts for a URL or UUID — the actor is linked
  and refreshed in one motion. If already linked, clicking refreshes the
  actor with current vgbnd.app data.
- **Refresh = nuclear replacement** of all items + system fields (stats,
  currency, HP/mana/luck, level, xp). Portrait, prototype-token
  customizations, sheet position, and ownership are all preserved. Foundry-
  only items added by hand on the actor will be deleted on refresh —
  documented limitation; vgbnd.app is treated as the source of truth.
- New public method `VgbndBrowserDialog.syncFromVgbnd(actor, optionalUrl)`
  for macro / scripting use.

### Notes
- The link button shows a chain icon when not linked, a refresh arrow when
  linked. Tooltip explains the action.
- Verified end-to-end: relic-forge step runs after refresh, so re-imported
  Drako gets all relics re-forged to current state.

## v2.6.2 — 2026-04-29

### Fixed
- **`strongPotentialStat` now applied to imported stats.** vgbnd.app's
  Human ancestry has a "Strong Potential" trait that grants +1 to a chosen
  stat, stored on the character document as `strongPotentialStat: "<stat>"`.
  The importer was ignoring this field — Human characters imported with
  their chosen stat 1 lower than the canonical vgbnd.app value.
- Verified on MrLawyerGuy (Human, strongPotential = awareness):
  awareness imports as 7 (= 6 base + 1 strongPotential), matching the web
  sheet. Previously imported as 6.

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
