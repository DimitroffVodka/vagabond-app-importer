# URL Character Import — Design

**Date:** 2026-04-28
**Module:** vgbnd-importer (v2.5.1)
**Status:** Approved (pending spec review)

## Background

Older versions of `vgbnd-importer` (v1.0.3 and earlier) let users paste a Vagabond character URL (or bare UUID) and import the character without any account or sign-in. That entry point was removed in the v2.x rewrite, which replaced it with a Firebase-authenticated browser dialog (`VgbndBrowserDialog`). The browser dialog can only list and import characters owned by, or shared with, the signed-in user.

The user wants the URL-paste flow restored. They run Foundry in browser mode (not desktop/Electron), so the well-known CORS block on `vgbnd.app/api/characters/{uuid}?format=foundry` is real for their use case — the v1.0.3 paste-JSON fallback is not optional.

## Goals

- Restore the ability to import a character from a pasted vgbnd.app URL or bare UUID.
- Work without Firebase sign-in.
- Work in Foundry browser mode despite CORS.
- Integrate cleanly with the existing tabbed `VgbndBrowserDialog` UX rather than introducing a separate sidebar entry point.

## Non-goals

- Not restoring the v1.0.3 `VgbndSpellDialog` post-import spell picker. v2.5.1 has no spell dialog; spell handling stays whatever the current mapper does.
- Not restoring the abandoned "Refresh from Vagabond" actor-sheet button explored in the Apr 18 session. Different feature, separate request.
- Not changing Firebase auth, the mapper, the unresolved-items dialog, or the sync flow.
- No new sidebar button — the only new entry point is a third tab inside the existing browser dialog.

## Architecture

A single new tab (`#tab = "url"`) inside `VgbndBrowserDialog`, sitting to the right of *My Characters* and *Groups*, labelled **By URL**. The tab strip becomes visible in both the login and browser views so the new tab is reachable without sign-in. The other two tabs, when clicked while unauthenticated, render the existing sign-in form inline as their tab body. The **By URL** tab is sign-in-agnostic.

The tab body is the v1.0.3 import form, condensed: a UUID-or-URL input with an "open in new tab" arrow button, a status line, an Import button, and an initially-hidden paste-JSON section that becomes visible after a CORS / network failure.

Successful imports route through the existing `VgbndBrowserDialog.#createActor(raw)` (browser-dialog.mjs:479) — the same path the **My Characters** and **Groups** tabs use. No new mapper code, no new actor-creation code.

## Files touched

| File | Change |
|---|---|
| `scripts/browser-dialog.mjs` | Add `"url"` to `#tab` state. Add `urlImport` and `urlOpenTab` actions. Add static `extractUUID(input)` helper. Add `#urlState = { uuidInput, jsonText, fallbackVisible }` instance field and `#captureUrlState()` helper for re-render preservation. Add `#showJsonFallback()`. Extend `_prepareContext` to surface URL-tab state. |
| `templates/browser-dialog.hbs` | Add **By URL** tab button. Hoist tab strip to render in both `isLogin` and `isBrowser` views. Add `{{#if isUrl}}` content block: UUID input row + arrow button + hidden `.vgbnd-json-section` textarea + status line + Import button. Make *My Characters* and *Groups* tab bodies render the existing login form when unauthenticated. |
| `lang/en.json` | Add: `TabUrl`, `UUIDLabel`, `UUIDPlaceholder`, `OpenUrlTitle`, `JSONLabel`, `JSONPlaceholder`, `ImportButton`, `Fetching`, `Importing`, `CORSHint`, `ErrorNoInput`, `ErrorInvalidUUID`, `ErrorBadJSON`. Most port verbatim from v1.0.3 `lang/en.json`. |
| `styles/vgbnd-importer.css` | Styles for `.vgbnd-uuid-row` (input + button flexbox), `.vgbnd-json-section` (hidden by default, `.visible` reveals), `.vgbnd-cors-hint` (warning banner). Lifted from v1.0.3 patterns. |

No new files. No deletions.

## Components

### `extractUUID(input: string): string | null`

Static helper on `VgbndBrowserDialog`. Regex: `/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i`. Returns the matched UUID substring as-is (the case-insensitive flag affects matching, not casing). Accepts:
- Bare UUID
- `https://www.vgbnd.app/character/<uuid>`
- `https://www.vgbnd.app/api/characters/<uuid>?format=foundry`
- Any other string containing a UUID substring

Returns `null` if no UUID-shaped substring is present.

### `#urlState` (instance field) and `#captureUrlState()`

`#urlState = { uuidInput: string, jsonText: string, fallbackVisible: boolean }`. Source of truth for URL-tab input values across re-renders.

`#captureUrlState()` is a private instance method that reads the current values from the DOM (`#vgbnd-uuid-input`, `#vgbnd-json-input`, the `.visible` class on `.vgbnd-json-section`) and writes them into `#urlState`. It must be called immediately before any `this.render()` call that does not originate from a URL-tab action — sign-in, sign-out, refresh, switch-tab, etc. — so re-renders triggered by other state changes don't blank the user's typed input.

`_prepareContext` reads from `#urlState` to surface the values back to the template (`urlInput`, `jsonInput`, `jsonFallbackVisible`).

### Action: `urlOpenTab` (the arrow button)

1. Read `#vgbnd-uuid-input` value.
2. `extractUUID` it. If `null`, `ui.notifications.warn(localize("VGBND.ErrorInvalidUUID"))` and return.
3. `window.open(\`https://www.vgbnd.app/api/characters/${uuid}?format=foundry\`, "_blank")`.

### Action: `urlImport` (the Import button)

Priority order — the user's intent is whichever input is non-empty, with paste-JSON winning if both are provided:

1. **JSON path** — if the textarea is non-empty:
   - `JSON.parse(text)`. On failure, `ui.notifications.error(format("VGBND.ErrorBadJSON", { error: err.message }))` and return.
   - On success, set status to `localize("VGBND.Importing")`, disable button, call `await VgbndBrowserDialog.#createActor(raw)`, re-enable button, clear status.
2. **UUID path** — else if `extractUUID(uuidInput)` is non-null:
   - Set status to `localize("VGBND.Fetching")`, disable button.
   - `await fetch(\`https://www.vgbnd.app/api/characters/${uuid}?format=foundry\`)`.
   - On success (`res.ok` true): `await res.json()` → `#createActor(raw)` → clear status, re-enable button.
   - On any failure (network throws, `!res.ok`, JSON parse throws): call `#showJsonFallback()`, set status to `localize("VGBND.CORSHint")`, re-enable button. Do **not** show an error toast — the recovery path is built into the UI.
3. **Neither** — `ui.notifications.warn(localize("VGBND.ErrorNoInput"))` and return.

### `#showJsonFallback()`

Adds `.visible` class to `.vgbnd-json-section`, focuses the textarea, sets `#urlState.fallbackVisible = true` so re-renders keep it visible, calls `this.setPosition({ height: "auto" })` to grow the dialog.

## Data flow

```
[user pastes URL/UUID into input]            [user pastes JSON into textarea]
                |                                          |
                v                                          v
        click "Import"                              click "Import"
                |                                          |
                v                                          v
   extractUUID -> fetch ?format=foundry         JSON.parse(text)
                |                                          |
        +-- ok -+---- fail ------+                         |
        |                        |                         |
        v                        v                         v
   res.json()           reveal JSON section          raw object
        |                user pastes -> Import           |
        +----------+--------------------+----------------+
                   |
                   v
       VgbndBrowserDialog.#createActor(raw)
                   |
        VgbndMapper.toActor -> Actor.create
                   |
        unresolved-dialog (if any unresolved items)
```

## Error handling

| Failure | Behavior |
|---|---|
| Empty input + empty JSON | Toast warn `ErrorNoInput`. No state change. |
| Input contains no UUID-shaped substring (arrow button) | Toast warn `ErrorInvalidUUID`. No new tab opened. |
| Input contains no UUID-shaped substring (Import) | Same as above; do not attempt fetch. |
| `fetch` rejects (CORS, offline, DNS) | Reveal JSON section, status = `CORSHint`. No error toast. |
| `fetch` returns non-2xx | Same as above. The user's recovery is the same regardless. |
| `JSON.parse` throws on either path | Toast error `ErrorBadJSON` with the parser's message. Re-enable button. |
| Mapper throws | Toast error `ErrorCreate` (existing key, used by `#createActor`). Re-enable button. |
| `Actor.create` throws | Toast error `ErrorCreate` (existing key). Re-enable button. |
| Unresolved items returned by mapper | Existing `VgbndUnresolvedDialog` opens after actor creation — same as today's flow. |

## Tab visibility & re-render preservation

The browser dialog currently has two views: `login` (sign-in form) and `browser` (tabs + content). To keep **By URL** reachable without sign-in, the template restructures so the tabs row renders unconditionally. Each tab's content block decides what to show:

- **My Characters / Groups** while unauthenticated: render the existing sign-in form *inside the tab body*. (No new login UI; the existing form is moved into the tab content area.)
- **By URL** in either auth state: render the URL form.

`#urlState` is the source of truth for the URL tab's input values, refreshed from DOM on each render. This prevents typed input from being lost when, for example, the user signs in while on the URL tab and the dialog re-renders to switch view modes.

## Testing

Manual verification only — no automated tests in this module today. After implementation, in Foundry browser mode:

1. Open **Browse Vagabond Tag Along** without signing in. Confirm three tabs visible. Click **By URL**. Paste a known character URL. Click Import. Expect: status briefly says "Fetching…", then JSON section reveals with CORS hint.
2. Click the arrow button. Confirm a new tab opens with the API URL.
3. From the new tab, copy the JSON, paste into the textarea, click Import. Expect: actor created in the world, unresolved dialog appears if relevant.
4. Repeat the paste-JSON path with a bare UUID instead of a URL.
5. Try invalid inputs: empty, gibberish, malformed JSON. Confirm correct toasts; UI stays usable.
6. Sign in via **My Characters** tab, then click **By URL**. Confirm input/textarea state persists across the auth re-render.
7. Verify desktop/Electron path: in a Foundry desktop session (if available), step 1's fetch should succeed without revealing the JSON section. The actor is created directly from the fetched JSON.

## Risks

- **Template restructure regresses login flow.** The existing login view is being relocated into a tab body. Mitigation: keep the old form's HTML structure intact, just move its container. Verify sign-in still works.
- **CORS policy changes on vgbnd.app.** If they enable CORS, the fetch path becomes the happy path for browser users too — no code change needed; the fallback is harmless. If they tighten further (e.g., reject the API endpoint outright), only the JSON-paste path remains usable, which is still the v1.0.3-equivalent recovery.
- **`#urlState` sync timing.** Easy to forget calling `#captureUrlState()` before one of the existing `this.render()` call sites (`_onRender`, `#onSignIn`, `#onSignOut`, `#onRefresh`, `#onSwitchTab`, `#onSelectGroup`). Mitigation: audit each call site as part of implementation; consider wrapping `render` in a helper if the surface area grows.

## Open questions

None at design time. The two earlier decision points (entry point UX, sign-in requirement) were resolved with the user during brainstorming.
