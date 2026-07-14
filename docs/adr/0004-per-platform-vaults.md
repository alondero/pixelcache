# Per-Platform Vaults

## Status

Accepted. Refines the Vault model assumed by [0002-local-vault-only](./0002-local-vault-only.md) and [0003-direct-launch-no-cache](./0003-direct-launch-no-cache.md); those remain in force (Vaults are still local-only for the MVP, still launched directly without caching).

## Context

The first cut modelled a Vault as a **single directory for the entire collection**. The Import Scanner crawled that one tree and inferred each file's platform from its extension (`platform_for_extension`, e.g. `.sfc` → `snes`). Two problems followed:

1. **It doesn't match how collections are actually stored.** Games live in per-console folders, often spread across different drives or network shares (`\\nas\snes`, `D:\roms\ps1`, …). There is no single root that contains everything.
2. **Extension inference can't handle disc systems.** Disc images share extensions across platforms (`.iso`, `.chd`, `.cue`), so the scanner deliberately excluded them — which meant whole consoles (PS1/PS2/GameCube/Dreamcast/Saturn…) could not be scanned at all.

The domain glossary had no term for "where a console's games live": **Vault** was a generic storage location and **Deck** is the *execution environment*, not storage.

## Decision

A **Vault is bound to exactly one platform.** It is simply the folder where that platform's games live, on whatever drive or share. A collection has one Vault per platform (occasionally several).

- `Vault { id, platform, path, pattern? }` is a first-class entity, stored as `vaults: [...]` on the Catalog (the syncable configuration, loaded once on mount).
- The scanner takes the platform **from the Vault**, not the extension. The extension set becomes just an inclusion filter — defaulted per platform, overridable per Vault via `pattern`. Because the platform is now declared, disc formats are scannable.
- A scan iterates over **all** configured Vaults and merges their Releases into one Catalog.
- A Release records the `vaultId` it was found in. At launch, its `filePath` resolves against that Vault's `path`.

### Reconciliation, not replacement

A Vault is only *one* source of Releases — the player can also add a Release by hand (for a console or a Playlist) from outside any Vault. So a rescan **reconciles** rather than overwriting: it replaces only the Releases owned by the scanned Vaults and preserves manual Releases (those with no `vaultId`), Releases from Vaults not in this scan, Decks, Playlists, the Vault config, and curated Game metadata (`developer`, `relations`). Only a Game's `primaryReleaseId` is recomputed from the reconciled Release set.

## Consequences

- Disc-based consoles are supported; adding a new platform is a matter of a default extension set (or a per-Vault `pattern`) plus a Deck.
- Games still group across platforms by title slug (a straight port is one Game). With many platform Vaults this cross-platform merge is more common; it is usually correct but can occasionally over-merge unrelated same-named titles. Curated `relations` and a future disambiguation pass are the escape hatch; left as-is for now.
- The old single-directory environment override (`PIXELCACHE_VAULT_DIR`) is superseded. For local dev, `PIXELCACHE_VAULT_DIR` + `PIXELCACHE_VAULT_PLATFORM` still define a single ad-hoc Vault when no Vaults are configured.
- Remote Vaults (0002) slot in unchanged: a Vault's `path` becomes a remote locator post-MVP without touching the platform-scoping decision.
