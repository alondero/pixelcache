/**
 * TypeScript mirror of the Rust `catalog` module's serde structs
 * (`src-tauri/src/catalog.rs`), matching the `catalog.json` schema from
 * `docs/prd-mvp.md` and the domain glossary in `CONTEXT.md`.
 */

export type ReleaseType =
  "retail" | "beta" | "hack" | "translation" | "homebrew";

export interface Media {
  video?: string;
  image?: string;
}

/** A specific playable version of a Game — a region, revision, hack, or port. */
export interface Release {
  id: string;
  gameId: string;
  title: string;
  region?: string;
  platform: string;
  revision?: string;
  releaseType: ReleaseType;
  publisher?: string;
  /**
   * The Vault this Release was discovered in, if any. When set, `filePath`
   * resolves relative to that Vault's `path`; when absent the Release was added
   * manually and `filePath` is used as-is.
   */
  vaultId?: string;
  filePath: string;
  media?: Media;
}

/** The logical title grouping all of a game's Releases under one card. */
export interface Game {
  id: string;
  developer?: string;
  primaryReleaseId: string;
  relations: string[];
}

/** The execution environment configuration used to run a Release. */
export interface Deck {
  id: string;
  platform: string;
  executablePath: string;
  arguments: string[];
}

/**
 * A player-curated collection of specific Releases, browsable and launchable
 * from its own screen (e.g. a "ROM Hacks" list mixing hacks across games).
 * Holds only references to Releases by id; the Releases live once in
 * `Catalog.releases`.
 */
export interface Playlist {
  id: string;
  name: string;
  releaseIds: string[];
}

/**
 * A platform-scoped storage location the Import Scanner crawls for Releases.
 * A collection has one Vault per platform (occasionally several), not one Vault
 * for the whole library.
 */
export interface Vault {
  id: string;
  platform: string;
  path: string;
  /**
   * Optional override for which files count as ROMs: a comma/space-separated
   * list of extensions. When absent, the platform's default extensions apply.
   */
  pattern?: string;
}

/**
 * The centralized master directory of all Game, Release, Deck, Playlist, and
 * Vault definitions.
 */
export interface Catalog {
  games: Game[];
  releases: Release[];
  decks: Deck[];
  playlists: Playlist[];
  vaults?: Vault[];
}
