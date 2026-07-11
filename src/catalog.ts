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

/** The centralized master directory of all Game, Release, and Deck definitions. */
export interface Catalog {
  games: Game[];
  releases: Release[];
  decks: Deck[];
}
