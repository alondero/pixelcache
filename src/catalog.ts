/**
 * TypeScript mirror of the Rust `catalog` module's serde structs
 * (`src-tauri/src/catalog.rs`), matching the `catalog.json` schema from
 * `docs/prd-mvp.md` and the domain glossary in `CONTEXT.md`.
 */

export type ReleaseType =
  "retail" | "beta" | "hack" | "translation" | "homebrew";

/**
 * Artwork and preview paths for a Release or, as a fallback, its Game. Each slot
 * is independent and resolved by the media protocol against the owning Release's
 * Vault (see `src/media.ts`). `image` stays the generic cover it always was.
 * Mirrors the Rust `Media` struct in `src-tauri/src/catalog.rs`.
 */
export interface Media {
  video?: string;
  image?: string;
  logo?: string;
  marquee?: string;
  screenshot?: string;
  boxart?: string;
  fanart?: string;
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
  /**
   * An optional per-Release Deck override, chosen by id. When set, this Release
   * launches under that specific Deck instead of its platform's default.
   */
  deckId?: string;
  filePath: string;
  media?: Media;
}

/** The logical title grouping all of a game's Releases under one card. */
export interface Game {
  id: string;
  developer?: string;
  primaryReleaseId: string;
  relations: string[];
  /**
   * Game-level fallback artwork. A Release whose own `media` leaves a slot unset
   * inherits that slot from here (see `resolveMedia` in `src/media.ts`).
   */
  media?: Media;
  /**
   * Whether the player marked this Game a favorite. Curation, so it lives in
   * the syncable Catalog — unlike play activity, which is device-local (see
   * `src/playHistory.ts`). Absent means `false`.
   */
  favorite?: boolean;
}

/**
 * How a Deck turns a Release into a launchable process: through a separate
 * emulator (`emulator`, the default) or by running the Release file directly
 * (`directLaunch`, for a PC game `.exe` or self-contained executable).
 */
export type DeckKind = "emulator" | "directLaunch";

/**
 * The execution environment configuration used to run a Release.
 *
 * A platform may have several Decks — a default emulator plus alternatives. The
 * Deck marked `default` is chosen for a platform unless a `Release.deckId` or an
 * explicit launch-time choice overrides it. `kind` and `default` are optional and
 * default to `"emulator"` / `false` (matching the Rust serde defaults).
 */
export interface Deck {
  id: string;
  platform: string;
  /** The emulator/interpreter to run; unused (and typically empty) for `directLaunch`. */
  executablePath: string;
  arguments: string[];
  kind?: DeckKind;
  default?: boolean;
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
  /**
   * Optional companion media root for this Vault — a folder of box art /
   * previews kept separately from the games. The media protocol resolves media
   * paths against it before the Vault `path`, and the Import Scanner
   * auto-assigns covers from it by filename match.
   */
  mediaPath?: string;
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
