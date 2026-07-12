//! Catalog domain module.
//!
//! Defines the serde structs for the `catalog.json` schema described in
//! `docs/prd-mvp.md` ("Schema Definitions") and `CONTEXT.md` (domain glossary):
//! a [`Catalog`] aggregates [`Game`], [`Release`], and [`Deck`] definitions.
//!
//! Parsing is split from file IO ([`Catalog::from_json`] vs [`load_catalog_from_path`])
//! so the schema itself is unit-testable without touching the filesystem, matching
//! the PRD's "Catalog Serialization Tests" testing decision.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::Path;

/// How a [`Release`] relates to the official original release of its [`Game`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReleaseType {
    Retail,
    Beta,
    Hack,
    Translation,
    Homebrew,
}

/// Optional preview media paths for a [`Release`], shown on hover per the PRD.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

/// A specific playable version of a [`Game`] — a region, revision, hack, or port.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub id: String,
    pub game_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    pub platform: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    pub release_type: ReleaseType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    pub file_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<Media>,
}

/// The logical title grouping all of a game's [`Release`]s under one card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub developer: Option<String>,
    pub primary_release_id: String,
    #[serde(default)]
    pub relations: Vec<String>,
}

/// The execution environment configuration used to run a [`Release`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deck {
    pub id: String,
    pub platform: String,
    pub executable_path: String,
    #[serde(default)]
    pub arguments: Vec<String>,
}

/// A player-curated collection of specific [`Release`]s, browsable and launchable
/// from its own screen (e.g. a "ROM Hacks" list mixing hacks across games).
///
/// A Playlist owns only *references* to Releases by id — the Releases themselves
/// still live once in [`Catalog::releases`], so a Release can appear in several
/// playlists without being duplicated. Dangling ids (a `release_id` with no
/// matching Release) are tolerated by the schema and simply skipped when the
/// playlist is resolved for display.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub release_ids: Vec<String>,
}

/// The centralized master directory of all [`Game`], [`Release`], [`Deck`], and
/// [`Playlist`] definitions.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    #[serde(default)]
    pub games: Vec<Game>,
    #[serde(default)]
    pub releases: Vec<Release>,
    #[serde(default)]
    pub decks: Vec<Deck>,
    #[serde(default)]
    pub playlists: Vec<Playlist>,
}

/// Errors that can occur while loading a [`Catalog`] from disk.
#[derive(Debug)]
pub enum CatalogError {
    /// The catalog file could not be read from disk.
    Read {
        path: String,
        source: std::io::Error,
    },
    /// The catalog file's contents were not valid `catalog.json`.
    Parse {
        path: String,
        source: serde_json::Error,
    },
}

impl fmt::Display for CatalogError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CatalogError::Read { path, source } => {
                write!(f, "failed to read catalog '{path}': {source}")
            }
            CatalogError::Parse { path, source } => {
                write!(f, "failed to parse catalog '{path}': {source}")
            }
        }
    }
}

impl std::error::Error for CatalogError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            CatalogError::Read { source, .. } => Some(source),
            CatalogError::Parse { source, .. } => Some(source),
        }
    }
}

impl Catalog {
    /// Parse a `Catalog` from a `catalog.json` document's contents.
    pub fn from_json(json: &str) -> Result<Catalog, serde_json::Error> {
        serde_json::from_str(json)
    }
}

/// Read and parse the catalog at `path`, the only function in this module that
/// touches the filesystem.
pub fn load_catalog_from_path(path: &Path) -> Result<Catalog, CatalogError> {
    let contents = std::fs::read_to_string(path).map_err(|source| CatalogError::Read {
        path: path.display().to_string(),
        source,
    })?;
    Catalog::from_json(&contents).map_err(|source| CatalogError::Parse {
        path: path.display().to_string(),
        source,
    })
}

/// Filename of the bundled mock catalog, resolved relative to the app's
/// resource directory (see the `bundle.resources` mapping in `tauri.conf.json`).
const CATALOG_RESOURCE_FILE: &str = "catalog.json";

/// Load the catalog bundled with the app, resolving it from the resource
/// directory. Shared by the `load_catalog` command and the launch engine
/// (which re-reads the catalog to resolve a Release into a Deck command).
pub fn load_bundled_catalog(app: &tauri::AppHandle) -> Result<Catalog, String> {
    use tauri::path::BaseDirectory;
    use tauri::Manager;

    let path = app
        .path()
        .resolve(CATALOG_RESOURCE_FILE, BaseDirectory::Resource)
        .map_err(|e| format!("failed to resolve catalog resource path: {e}"))?;
    load_catalog_from_path(&path).map_err(|e| e.to_string())
}

/// Tauri command invoked once on frontend startup to load the Catalog.
#[tauri::command]
pub async fn load_catalog(app: tauri::AppHandle) -> Result<Catalog, String> {
    load_bundled_catalog(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_json() -> &'static str {
        r#"{
            "games": [
                {
                    "id": "star-fox-64",
                    "developer": "Nintendo EAD",
                    "primaryReleaseId": "star-fox-64-ntsc",
                    "relations": []
                }
            ],
            "releases": [
                {
                    "id": "star-fox-64-ntsc",
                    "gameId": "star-fox-64",
                    "title": "Star Fox 64",
                    "region": "NTSC",
                    "platform": "n64",
                    "releaseType": "retail",
                    "publisher": "Nintendo",
                    "filePath": "star-fox-64/star-fox-64-ntsc.z64",
                    "media": {
                        "image": "star-fox-64/cover.webp"
                    }
                },
                {
                    "id": "lylat-wars-pal",
                    "gameId": "star-fox-64",
                    "title": "Lylat Wars",
                    "region": "PAL",
                    "platform": "n64",
                    "releaseType": "retail",
                    "filePath": "star-fox-64/lylat-wars-pal.z64"
                }
            ],
            "decks": [
                {
                    "id": "n64-mupen",
                    "platform": "n64",
                    "executablePath": "mupen64plus",
                    "arguments": ["--fullscreen"]
                }
            ],
            "playlists": [
                {
                    "id": "favourites",
                    "name": "Favourites",
                    "releaseIds": ["lylat-wars-pal", "star-fox-64-ntsc"]
                }
            ]
        }"#
    }

    #[test]
    fn parses_games_releases_and_decks() {
        let catalog = Catalog::from_json(sample_json()).expect("valid catalog json");
        assert_eq!(catalog.games.len(), 1);
        assert_eq!(catalog.releases.len(), 2);
        assert_eq!(catalog.decks.len(), 1);
    }

    #[test]
    fn groups_releases_under_their_game_by_id() {
        let catalog = Catalog::from_json(sample_json()).expect("valid catalog json");
        let game = &catalog.games[0];
        let releases_for_game: Vec<_> = catalog
            .releases
            .iter()
            .filter(|r| r.game_id == game.id)
            .collect();
        assert_eq!(releases_for_game.len(), 2);
    }

    #[test]
    fn optional_fields_default_when_absent() {
        let catalog = Catalog::from_json(sample_json()).expect("valid catalog json");
        let lylat = catalog
            .releases
            .iter()
            .find(|r| r.id == "lylat-wars-pal")
            .expect("lylat wars release present");
        assert_eq!(lylat.publisher, None);
        assert_eq!(lylat.revision, None);
        assert_eq!(lylat.media, None);
    }

    #[test]
    fn release_type_round_trips_through_camel_case() {
        let catalog = Catalog::from_json(sample_json()).expect("valid catalog json");
        let sf64 = &catalog.releases[0];
        assert_eq!(sf64.release_type, ReleaseType::Retail);

        let serialized = serde_json::to_string(sf64).expect("serializable");
        assert!(serialized.contains("\"releaseType\":\"retail\""));
    }

    #[test]
    fn empty_catalog_parses_with_defaulted_collections() {
        let catalog = Catalog::from_json("{}").expect("empty object is a valid catalog");
        assert!(catalog.games.is_empty());
        assert!(catalog.releases.is_empty());
        assert!(catalog.decks.is_empty());
        assert!(catalog.playlists.is_empty());
    }

    #[test]
    fn parses_playlists_with_their_release_references() {
        let catalog = Catalog::from_json(sample_json()).expect("valid catalog json");
        assert_eq!(catalog.playlists.len(), 1);
        let playlist = &catalog.playlists[0];
        assert_eq!(playlist.id, "favourites");
        assert_eq!(playlist.name, "Favourites");
        assert_eq!(
            playlist.release_ids,
            vec!["lylat-wars-pal".to_string(), "star-fox-64-ntsc".to_string()]
        );
    }

    #[test]
    fn playlist_release_ids_default_to_empty_when_absent() {
        let catalog =
            Catalog::from_json(r#"{ "playlists": [{ "id": "empty", "name": "Empty" }] }"#)
                .expect("playlist without releaseIds is valid");
        assert!(catalog.playlists[0].release_ids.is_empty());
    }

    #[test]
    fn malformed_json_is_a_parse_error() {
        let result = Catalog::from_json("{ not valid json");
        assert!(result.is_err());
    }

    #[test]
    fn load_catalog_from_path_reads_and_parses_file() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!(
            "pixelcache-catalog-test-{}.json",
            std::process::id()
        ));
        std::fs::write(&path, sample_json()).expect("write temp catalog");

        let result = load_catalog_from_path(&path);
        std::fs::remove_file(&path).ok();

        let catalog = result.expect("catalog loads from disk");
        assert_eq!(catalog.games.len(), 1);
    }

    #[test]
    fn load_catalog_from_path_missing_file_is_a_read_error() {
        let path = Path::new("does-not-exist-pixelcache-catalog.json");
        let err = load_catalog_from_path(path).expect_err("missing file should error");
        assert!(matches!(err, CatalogError::Read { .. }));
    }

    #[test]
    fn load_catalog_from_path_bad_json_is_a_parse_error() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!(
            "pixelcache-catalog-badjson-{}.json",
            std::process::id()
        ));
        std::fs::write(&path, "not json").expect("write temp catalog");

        let result = load_catalog_from_path(&path);
        std::fs::remove_file(&path).ok();

        assert!(matches!(result, Err(CatalogError::Parse { .. })));
    }

    #[test]
    fn catalog_error_display_includes_path() {
        let err = CatalogError::Read {
            path: "catalog.json".to_string(),
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "no such file"),
        };
        let message = err.to_string();
        assert!(message.contains("catalog.json"), "message was: {message}");
    }
}
