---
name: verify-ui
description: Verify a UI change works in a real browser — start the dev server (browser-mocked), drive the change with playwright-cli, capture screenshots, **share them with the user via the `SendFiles` tool**, then close everything. Use after any change to src/*.tsx, App.css, index.css, grid/focus logic, or catalog-driven rendering — the static verify gate (npm run verify) renders no pixels. Skip purely for changes with no visual surface.
allowed-tools: Bash Read Edit Grep Glob Skill
---

# Verifying Pixelcache UI changes visually

## Mental model

`npm run verify` proves the code compiles, lints, types, and passes its units.
It cannot prove the feature *looks right or works when rendered*. This skill
closes that gap, and ends with screenshots **shared with the user** — for UI
features the image IS the deliverable evidence.

The loop: run → reach → observe (screenshot + console + network) → interact
→ diagnose → fix → re-check (Vite HMR; do not restart the server). **Stop
after two failed attempts on the same root cause** and surface the problem.

## Prerequisites

- `npm run dev` works in a plain browser because `src/dev/mockTauri.ts` is
  installed by `main.tsx` when `__TAURI_INTERNALS__` is absent (`import.meta.env.DEV`
  guard keeps it out of prod builds and the real desktop WebView). Verify it
  is reachable from `http://localhost:1420` before screenshotting.
- `playwright-cli` is the preferred driver — see
  `C:\Users\alond\.claude\skills\playwright-cli\SKILL.md` for the full
  command reference.

## Step 1 — Run the dev server

```bash
npm run dev       # background
```

- URL: **http://localhost:1420**. `strictPort: true` — if 1420 is busy the
  server FAILS rather than picking another port. A "port in use" failure
  almost always means a server from a previous session is still running;
  reuse it instead of double-starting.

Ready check: poll `http://localhost:1420` until it returns 200 (max 30s). If
it never comes up, read the backgrounded server's stdout for the actual
error (often `EADDRINUSE`).

## Step 2 — Reach and observe

Drive the page with playwright-cli:

```
playwright-cli open http://localhost:1420
playwright-cli resize 1280 800
playwright-cli snapshot --depth=6
```

Then capture baseline:

1. Screenshot the viewport (`playwright-cli screenshot --filename=.playwright-cli/ui-baseline.png`).
2. Scan console errors (`playwright-cli console error`) — anything at level
   `error` is a failure to diagnose.
3. Scan network (`playwright-cli network`) — first-party assets only; flag
   any non-2xx.

**Don't assert hardcoded game names here.** The bundled sample catalog
(`src-tauri/resources/catalog.json`) is a fixture and may be edited; assert
its structural integrity instead (every Game's `primaryReleaseId` resolves;
`games.length` is at least 1 — that's what `src/dev/mockTauri.test.ts`
proves at the unit level).

## Step 3 — Interact (exercise the actual change)

General-purpose primitives:

- **Keyboard**: `playwright-cli press ArrowDown` etc. Arrow keys mirror the
  gamepad D-pad in `useGridFocus`, so gamepad flows can be smoke-tested
  without a controller.
- **Click a card**: `playwright-cli click <ref>`. Look up the ref in the
  most recent snapshot (`[ref=e11]`).
- **Panic on multi-match**: `getByRole('button', { name: /play/i })` matches
  both release rows when a details panel is open. Disambiguate with
  `getByRole('button', { name: 'Play Star Fox 64' })` or use the snapshot
  ref.

For the specific change being verified:

- **Focus/gamepad**: send ArrowRight/ArrowDown/Enter, then assert focus
  *moved* (check `document.activeElement`, not just pixels).
- **Details panel**: open a card; assert the grid focus loop is suspended
  (`enabled: false` while `selectedGame !== null`). A regression here looks
  like "arrows still move the grid behind the panel".
- **Play**: clicking Play in the browser shows the launched state with a
  mock pid (`{ program: 'browser-mock:<releaseId>', pid: <n> }`). An error
  here means invoke wiring broke.

After each interaction, screenshot the new state under the same viewport
size — `.playwright-cli/ui-<descriptor>.png`.

## Step 4 — Share the evidence (mandatory)

Call the `SendFiles` tool with each screenshot and a one-line caption naming
*what the image proves* (e.g. "grid renders 4 cards with focus ring on
Star Fox 64 after ArrowDown×2"). **A UI feature is not finished until the
user can see it working.** Do not declare done without sharing.

## Step 5 — Teardown (mandatory)

```
playwright-cli close
TaskStop on any backgrounded `npm run dev` (record its task_id at Step 1)
```

`strictPort: true` means a leaked dev server will block the next session's
`npm run dev` from starting — *the very first "port in use" failure next
session is almost always a previous session's teardown skip*. Close the
browser BEFORE stopping the server so the browser doesn't log connection
errors on its way out.

## Output format (for the agent's final message to the user)

```
UI verified:
- states captured: <grid | details-open | play-success | ...>
- screenshots shared: <file names>
- console errors: <none | list with file/line>
- interactions exercised: <bullet list>
- verdict: PASS | FAIL (reason)
```

## Project quirks (append dated; this is institutional memory)

- 2026-07-17 — `strictPort: true` on Vite: "port in use" means a previous
  session leaked its dev server. Reuse the running one or TaskStop it.
- 2026-07-17 — The Tauri window-hide-on-launch behaviour is desktop-only;
  it cannot be observed in a plain browser. For that, use `npm run tauri dev`
  (see `run` skill).
- 2026-07-17 — Preview media plays from `public/media/`; the repo ships
  generated placeholders (test-pattern `.webm`, gradient `.webp`). Garish
  test-pattern previews are expected, not rendering bugs.
- 2026-07-17 — To screenshot a transient state (progress bar, spinner), a
  separate click-then-screenshot is too slow. Use
  `playwright-cli run-code "async (page) => { ...click(); await page.waitForTimeout(500); await page.screenshot({ path: '...' }); }"`
  — the argument must be an async arrow taking `page`.
- 2026-07-18 — `.search-input` carries `flex: 1 1 12rem` (tuned for the
  horizontal filter bar). Reused inside a *column* flex container it grows
  vertically into a giant pill balloon — override `flex: 0 0 auto` in the new
  context. Only visible in a rendered browser; jsdom tests pass regardless.
- 2026-07-18 — Step transitions in the onboarding wizard animate for 0.28s;
  screenshot immediately after a `waitFor` and you capture a half-faded
  frame. `waitForTimeout(600)` before the screenshot.
- 2026-07-17 — Pre-existing console errors in the browser mock: the nested
  favorite-badge `<button>` hydration warning (GameGrid), a
  `plugin:event|listen` "no browser mock" error (GamesView), and
  `pixelcache-media.localhost` ERR_CONNECTION_REFUSED (the media protocol
  only exists in the desktop WebView). Don't attribute these to new changes.

## Anti-patterns

- ❌ Calling UI work done from green unit tests alone — they mock the bridge
  and render in jsdom; they render no pixels.
- ❌ Skipping the console/network scan because the screenshot "looked fine".
- ❌ Restarting the dev server after each edit — Vite HMR is the point.
- ❌ Asserting hardcoded game names (`"Star Fox 64"`) as pass/fail — the
  sample catalog is a fixture, not part of the spec.
- ❌ Finishing without sharing the image.
- ❌ Skipping teardown — the next session pays for it.

## Self-improvement

When a run uncovers a project-specific gotcha (flaky selector, timing,
fixture change, leaked-port symptom), append it to *Project quirks* above
with today's date. The skill should accumulate how this app *actually*
behaves in a browser, not generic Playwright wisdom.
