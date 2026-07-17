---
name: catalog-domain
description: Pixelcache's data model and data-flow invariants — catalog.json schema, catalog load precedence, Vault scanner reconciliation, play-activity vs favorites split. Use before changing catalog.rs, scanner.rs, catalog.ts, or anything reading/writing catalog.json.
---

# Catalog & data-flow invariants

## Schema (camelCase JSON)

`src/catalog.ts` is a hand-maintained mirror of the serde structs in
`src-tauri/src/catalog.rs` — every schema change touches both files.

- `Catalog { games, releases, decks }`
- `Game` — the logical title grouping all its Releases (`primaryReleaseId`,
  `relations`); cross-release metadata (e.g. `developer`) lives here.
- `Release` — one playable variant (region/revision/hack/port): `platform`,
  `releaseType` (`retail | beta | hack | translation | homebrew`), `filePath`,
  optional `media` (`video`/`image`, catalog-relative paths).
- `Deck` — maps a platform to an executable + argument prefix. A launch is
  `deck.executablePath + deck.arguments + release.filePath`, with `filePath`
  resolved against `PIXELCACHE_VAULT_DIR` when set.

## Load precedence

`catalog::load_catalog` prefers `<app-data>/catalog.json` (written by
`scan_vault`) over the catalog bundled as a Tauri resource. After the first
scan, the bundled sample is permanently shadowed — the answer to "why isn't my
catalog edit showing" is almost always this.

## Scanner

`scanner.rs`: `walk_vault` → `parse_filename` (title/region/revision from ROM
naming conventions) → `build_catalog` → written to app-data.

**Invariant: rescans reconcile, never clobber.** Curated fields (favorites,
manual metadata edits) must survive a rescan and be seeded for newly
discovered entries.

## Play activity vs. curation (decided architecture; check code for current state)

- `play_history.json` in app-data — device-local, never synced via the Catalog.
- Favorites — Catalog curation, part of `catalog.json` and therefore synced.
