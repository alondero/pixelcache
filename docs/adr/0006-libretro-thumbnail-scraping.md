# 6. Artwork scraping via the libretro-thumbnails library

Date: 2026-07-17

## Status

Accepted

## Context

Frontier launchers (LaunchBox, EmulationStation, Skraper) populate box art
automatically; Pixelcache required typing Vault-relative paths by hand on the
Media screen. Most scraping APIs (ScreenScraper, IGDB, TheGamesDB) need API
keys or OAuth. `thumbnails.libretro.com` — the CDN RetroArch itself uses — is
keyless and organised by No-Intro naming, the same convention the Import
Scanner already parses, so a Release's ROM file stem is a near-perfect lookup
key with `Title (Region)` and the bare title as fallbacks.

## Decision

- Scrape box art (`Named_Boxarts` → `boxart` + empty `image`) and snaps
  (`Named_Snaps` → `screenshot`) from the libretro thumbnail library over
  plain HTTPS (`ureq`), one Tauri command per Release
  (`scrape_release_artwork`), driven sequentially by the frontend — the
  `save_media` idiom: each call persists atomically and returns the updated
  Catalog, so artwork pops into the grid live and Cancel is just "stop
  looping". No Tauri event plumbing.
- Downloads land in the Release's Vault at `media/<release-id>/<slot>.png`,
  the space the `pixelcache-media://` protocol already serves.
- The scraper only fills slots that resolve to nothing through the
  Release → Game fallback — curated media is never overwritten (the
  rescan-reconcile spirit applied to scraping).

## Consequences

- Platforms are scrapable only if mapped in `scrape::libretro_system`; a test
  keeps that map in lock-step with the scanner's platform vocabulary.
- Manual Releases without a Vault and unmapped platforms report honest
  `noVault` / `unsupported` outcomes instead of failing.
- Post-MVP metadata scraping (genre, description) will need a keyed API; this
  ADR deliberately covers artwork only.
