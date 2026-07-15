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

/// Artwork and preview paths for a [`Release`] or, as a fallback, its [`Game`].
///
/// Every slot is an optional path resolved by the launcher's media protocol
/// against the owning Release's [`Vault`] (see [`crate::media`]). The MVP grew
/// from a single `image` + `video` to the artwork set established launchers use
/// (clear logo, marquee, screenshot, box art, fanart); each slot is independent,
/// and a slot left unset on a Release falls back to the same slot on its Game
/// ([`Media::slot`] + [`crate::media::resolved_slot`]).
///
/// `image` stays the generic cover / primary still it always was, kept first for
/// backward compatibility with pre-Phase-3 catalogs.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marquee: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boxart: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fanart: Option<String>,
}

/// The media slots in a stable order, used by the media protocol to validate a
/// requested slot name and by tests to iterate every field. Mirrors the frontend
/// `MEDIA_SLOTS` in `src/media.ts`.
pub const MEDIA_SLOTS: [&str; 7] = [
    "video",
    "image",
    "logo",
    "marquee",
    "screenshot",
    "boxart",
    "fanart",
];

impl Media {
    /// The path stored in `slot`, or `None` for an unset slot or an unknown slot
    /// name. The single place mapping a slot string to its field, shared by the
    /// media protocol's per-slot lookup.
    pub fn slot(&self, slot: &str) -> Option<&str> {
        match slot {
            "video" => self.video.as_deref(),
            "image" => self.image.as_deref(),
            "logo" => self.logo.as_deref(),
            "marquee" => self.marquee.as_deref(),
            "screenshot" => self.screenshot.as_deref(),
            "boxart" => self.boxart.as_deref(),
            "fanart" => self.fanart.as_deref(),
            _ => None,
        }
    }
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
    /// The [`Vault`] this Release was discovered in, if any. When set, `file_path`
    /// is resolved relative to that Vault's `path` at launch time; when absent the
    /// Release was added manually and `file_path` is used as-is (an absolute path
    /// or one relative to the process working directory).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vault_id: Option<String>,
    /// An optional per-Release [`Deck`] override, chosen by id. When set, this
    /// Release launches under that specific Deck instead of its platform's
    /// default — e.g. running one hack under a different core. When absent the
    /// launch engine falls back to the platform's default Deck.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deck_id: Option<String>,
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
    /// Game-level fallback artwork. A [`Release`] whose own [`Release::media`]
    /// leaves a slot unset inherits that slot from here, so shared box art or a
    /// logo can be set once on the Game instead of on every regional Release.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<Media>,
}

/// How a [`Deck`] turns a [`Release`] into a launchable process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeckKind {
    /// Run the Release file through a separate emulator or interpreter named by
    /// [`Deck::executable_path`]. The ROM path is supplied via a `{rom}` / `{file}`
    /// argument placeholder, or appended as the final argument when no placeholder
    /// is present. The default when a Deck omits `kind` (backward compatible).
    #[default]
    Emulator,
    /// Run the Release file *itself* — a PC game `.exe` or any self-contained
    /// executable. The resolved ROM path becomes the program and
    /// [`Deck::executable_path`] is unused.
    DirectLaunch,
}

impl DeckKind {
    /// Whether this is the default kind; used by `skip_serializing_if` so a plain
    /// emulator Deck omits `kind` from `catalog.json`.
    fn is_emulator(&self) -> bool {
        matches!(self, DeckKind::Emulator)
    }
}

/// `skip_serializing_if` predicate for `bool` fields that default to `false`.
fn is_false(value: &bool) -> bool {
    !*value
}

/// The execution environment configuration used to run a [`Release`].
///
/// A platform may have several Decks — a default emulator plus alternatives (a
/// different core, a direct launch). The Deck marked [`Deck::is_default`] is
/// chosen for a platform unless a [`Release::deck_id`] or an explicit launch-time
/// choice overrides it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deck {
    pub id: String,
    pub platform: String,
    /// The emulator/interpreter to run for a [`DeckKind::Emulator`] Deck. Unused
    /// (and typically empty) for a [`DeckKind::DirectLaunch`] Deck, so it defaults
    /// and is omitted from JSON when blank.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub executable_path: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    /// How this Deck launches: through an emulator (default) or by running the
    /// Release file directly.
    #[serde(default, skip_serializing_if = "DeckKind::is_emulator")]
    pub kind: DeckKind,
    /// Whether this is the platform's default Deck. Among several Decks for one
    /// platform, the default is chosen at launch unless overridden. Serialised as
    /// `default`; omitted when `false`.
    #[serde(default, rename = "default", skip_serializing_if = "is_false")]
    pub is_default: bool,
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

/// A platform-scoped storage location the Import Scanner crawls for Releases.
///
/// Unlike the pre-`0004` model — a single directory whose platform was guessed
/// per-file from the ROM extension — a Vault is bound to exactly one `platform`
/// and simply *is* the folder where that platform's games live (a local drive, a
/// network share, wherever). A collection therefore has one Vault per platform
/// (occasionally several), not one Vault for everything. Because the platform is
/// declared rather than inferred, ambiguous disc extensions (`.iso`, `.chd`)
/// become scannable. See [`docs/adr/0004-per-platform-vaults.md`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vault {
    pub id: String,
    pub platform: String,
    pub path: String,
    /// Optional override for which files count as ROMs in this Vault: a
    /// comma/space-separated list of extensions (e.g. `"iso, chd"`, dots
    /// optional). When absent, the platform's default extension set applies.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
}

/// The centralized master directory of all [`Game`], [`Release`], [`Deck`],
/// [`Playlist`], and [`Vault`] definitions.
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
    /// The platform-scoped scan locations. The Import Scanner reads these to know
    /// what to crawl; the launch engine reads them to resolve a Release's
    /// `file_path` against the Vault it came from.
    #[serde(default)]
    pub vaults: Vec<Vault>,
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

/// Filename of the catalog document, used both for the bundled mock (resolved
/// against the app's resource directory per the `bundle.resources` mapping in
/// `tauri.conf.json`) and for the generated copy the Import Scanner writes to
/// the app data directory.
pub const CATALOG_FILE_NAME: &str = "catalog.json";

/// Load the catalog, preferring a scanner-generated copy in the app data
/// directory (issue #4) and falling back to the bundled mock resource when no
/// generated catalog exists yet — e.g. on a fresh install before the first
/// Vault scan. Shared by the `load_catalog` command and the launch engine
/// (which re-reads the catalog to resolve a Release into a Deck command), so
/// both see the same catalog the user is actually viewing.
pub fn load_bundled_catalog(app: &tauri::AppHandle) -> Result<Catalog, String> {
    use tauri::path::BaseDirectory;
    use tauri::Manager;

    if let Ok(generated) = app.path().app_data_dir() {
        let generated = generated.join(CATALOG_FILE_NAME);
        if generated.is_file() {
            return load_catalog_from_path(&generated).map_err(|e| e.to_string());
        }
    }

    let path = app
        .path()
        .resolve(CATALOG_FILE_NAME, BaseDirectory::Resource)
        .map_err(|e| format!("failed to resolve catalog resource path: {e}"))?;
    load_catalog_from_path(&path).map_err(|e| e.to_string())
}

/// Tauri command invoked once on frontend startup to load the Catalog.
#[tauri::command]
pub async fn load_catalog(app: tauri::AppHandle) -> Result<Catalog, String> {
    load_bundled_catalog(&app)
}

/// Serialise `catalog` to the app data directory, where [`load_bundled_catalog`]
/// prefers it over the bundled resource on the next load. This is the same
/// destination the Import Scanner writes to, so a settings edit and a rescan both
/// persist to the one catalog the user is actually viewing.
fn persist_catalog(app: &tauri::AppHandle, catalog: &Catalog) -> Result<(), String> {
    use tauri::Manager;

    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join(CATALOG_FILE_NAME);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create data dir '{}': {e}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(catalog)
        .map_err(|e| format!("failed to serialize catalog: {e}"))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("failed to write catalog '{}': {e}", path.display()))
}

/// Tauri command backing the Decks settings screen: replace the catalog's Decks
/// with `decks`, persist the updated catalog, and return it so the whole app
/// refreshes. Everything else in the catalog (Games, Releases, Playlists, Vaults)
/// is preserved — only the Deck set changes.
#[tauri::command]
pub async fn save_decks(app: tauri::AppHandle, decks: Vec<Deck>) -> Result<Catalog, String> {
    let mut catalog = load_bundled_catalog(&app)?;
    catalog.decks = decks;
    persist_catalog(&app, &catalog)?;
    Ok(catalog)
}

/// Apply a manual media assignment (from the Media settings screen) to the
/// catalog: replace the media on one [`Release`] and/or one [`Game`], returning
/// the mutated catalog so the whole app refreshes. A `None` media clears that
/// target's assignment; a missing id is a no-op for that target rather than an
/// error, so the frontend never has to keep ids perfectly in sync. Pure over its
/// inputs so the update rule is unit-testable without touching disk.
pub fn apply_media(
    mut catalog: Catalog,
    release: Option<(String, Option<Media>)>,
    game: Option<(String, Option<Media>)>,
) -> Catalog {
    if let Some((release_id, media)) = release {
        if let Some(target) = catalog.releases.iter_mut().find(|r| r.id == release_id) {
            target.media = media;
        }
    }
    if let Some((game_id, media)) = game {
        if let Some(target) = catalog.games.iter_mut().find(|g| g.id == game_id) {
            target.media = media;
        }
    }
    catalog
}

/// Tauri command backing the Media settings screen: assign the media for one
/// Release and/or its Game in a single persist, then return the updated catalog.
/// Either target is optional so the screen can save a Release, a Game fallback,
/// or both together; passing `null` media clears that target.
#[tauri::command]
pub async fn save_media(
    app: tauri::AppHandle,
    release_id: Option<String>,
    release_media: Option<Media>,
    game_id: Option<String>,
    game_media: Option<Media>,
) -> Result<Catalog, String> {
    let catalog = load_bundled_catalog(&app)?;
    let updated = apply_media(
        catalog,
        release_id.map(|id| (id, release_media)),
        game_id.map(|id| (id, game_media)),
    );
    persist_catalog(&app, &updated)?;
    Ok(updated)
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
    fn parses_vaults_with_platform_and_path() {
        let catalog = Catalog::from_json(
            r#"{
                "vaults": [
                    {"id": "snes", "platform": "snes", "path": "/mnt/roms/snes"},
                    {"id": "ps1", "platform": "ps1", "path": "//nas/games/ps1", "pattern": "chd, cue"}
                ]
            }"#,
        )
        .expect("valid catalog json");
        assert_eq!(catalog.vaults.len(), 2);
        assert_eq!(catalog.vaults[0].platform, "snes");
        assert_eq!(catalog.vaults[0].pattern, None);
        assert_eq!(catalog.vaults[1].pattern.as_deref(), Some("chd, cue"));
    }

    #[test]
    fn vaults_default_to_empty_when_absent() {
        let catalog = Catalog::from_json("{}").expect("empty object is a valid catalog");
        assert!(catalog.vaults.is_empty());
    }

    #[test]
    fn release_vault_id_round_trips_and_defaults() {
        let catalog = Catalog::from_json(
            r#"{
                "releases": [
                    {"id": "a", "gameId": "g", "title": "A", "platform": "snes",
                     "releaseType": "retail", "vaultId": "snes", "filePath": "A.sfc"},
                    {"id": "b", "gameId": "g", "title": "B", "platform": "snes",
                     "releaseType": "retail", "filePath": "/abs/B.sfc"}
                ]
            }"#,
        )
        .expect("valid catalog json");
        assert_eq!(catalog.releases[0].vault_id.as_deref(), Some("snes"));
        assert_eq!(catalog.releases[1].vault_id, None);

        // A manual Release (no vault) omits the field when re-serialised.
        let json = serde_json::to_string(&catalog.releases[1]).expect("serialisable");
        assert!(!json.contains("vaultId"), "json was: {json}");
    }

    #[test]
    fn deck_kind_and_default_flag_default_when_absent() {
        // A pre-Phase-2 Deck omits `kind` and `default`: it reads as an emulator
        // deck that is not the platform default.
        let catalog = Catalog::from_json(
            r#"{
                "decks": [
                    {"id": "d", "platform": "snes", "executablePath": "snes9x"}
                ]
            }"#,
        )
        .expect("valid catalog json");
        let deck = &catalog.decks[0];
        assert_eq!(deck.kind, DeckKind::Emulator);
        assert!(!deck.is_default);
    }

    #[test]
    fn parses_deck_kind_default_flag_and_omitted_executable() {
        // A direct-launch deck names no executable; `default` marks it primary.
        let catalog = Catalog::from_json(
            r#"{
                "decks": [
                    {"id": "pc", "platform": "pc", "kind": "directLaunch", "default": true}
                ]
            }"#,
        )
        .expect("valid catalog json");
        let deck = &catalog.decks[0];
        assert_eq!(deck.kind, DeckKind::DirectLaunch);
        assert!(deck.is_default);
        assert_eq!(deck.executable_path, "");
    }

    #[test]
    fn deck_omits_default_and_kind_when_serialising_a_plain_emulator() {
        // A plain emulator deck round-trips without noise: no `kind`, no `default`.
        let deck = Deck {
            id: "d".to_string(),
            platform: "snes".to_string(),
            executable_path: "snes9x".to_string(),
            arguments: vec![],
            kind: DeckKind::Emulator,
            is_default: false,
        };
        let json = serde_json::to_string(&deck).expect("serialisable");
        assert!(!json.contains("kind"), "json was: {json}");
        assert!(!json.contains("default"), "json was: {json}");
        assert!(json.contains("snes9x"), "json was: {json}");
    }

    #[test]
    fn direct_launch_deck_omits_empty_executable_but_keeps_kind() {
        let deck = Deck {
            id: "pc".to_string(),
            platform: "pc".to_string(),
            executable_path: String::new(),
            arguments: vec![],
            kind: DeckKind::DirectLaunch,
            is_default: true,
        };
        let json = serde_json::to_string(&deck).expect("serialisable");
        assert!(!json.contains("executablePath"), "json was: {json}");
        assert!(
            json.contains("\"kind\":\"directLaunch\""),
            "json was: {json}"
        );
        assert!(json.contains("\"default\":true"), "json was: {json}");
    }

    #[test]
    fn release_deck_id_round_trips_and_defaults() {
        let catalog = Catalog::from_json(
            r#"{
                "releases": [
                    {"id": "a", "gameId": "g", "title": "A", "platform": "snes",
                     "releaseType": "hack", "deckId": "snes-alt", "filePath": "A.sfc"},
                    {"id": "b", "gameId": "g", "title": "B", "platform": "snes",
                     "releaseType": "retail", "filePath": "B.sfc"}
                ]
            }"#,
        )
        .expect("valid catalog json");
        assert_eq!(catalog.releases[0].deck_id.as_deref(), Some("snes-alt"));
        assert_eq!(catalog.releases[1].deck_id, None);

        // A Release with no override omits the field when re-serialised.
        let json = serde_json::to_string(&catalog.releases[1]).expect("serialisable");
        assert!(!json.contains("deckId"), "json was: {json}");
    }

    #[test]
    fn parses_the_expanded_media_slots() {
        let catalog = Catalog::from_json(
            r#"{
                "releases": [
                    {"id": "r", "gameId": "g", "title": "T", "platform": "snes",
                     "releaseType": "retail", "filePath": "t.sfc",
                     "media": {
                        "video": "t/preview.webm", "image": "t/cover.webp",
                        "logo": "t/logo.png", "marquee": "t/marquee.png",
                        "screenshot": "t/shot.png", "boxart": "t/box.png",
                        "fanart": "t/fan.jpg"
                     }}
                ]
            }"#,
        )
        .expect("valid catalog json");
        let media = catalog.releases[0].media.as_ref().expect("media present");
        assert_eq!(media.slot("logo"), Some("t/logo.png"));
        assert_eq!(media.slot("fanart"), Some("t/fan.jpg"));
        assert_eq!(media.slot("boxart"), Some("t/box.png"));
        // Every declared slot resolves; an unknown slot name is None.
        assert!(MEDIA_SLOTS.iter().all(|s| media.slot(s).is_some()));
        assert_eq!(media.slot("nope"), None);
    }

    #[test]
    fn media_slot_returns_none_for_unset_slots() {
        let media = Media {
            image: Some("cover.webp".to_string()),
            ..Media::default()
        };
        assert_eq!(media.slot("image"), Some("cover.webp"));
        assert_eq!(media.slot("video"), None);
        assert_eq!(media.slot("logo"), None);
    }

    #[test]
    fn game_media_round_trips_and_defaults() {
        let catalog = Catalog::from_json(
            r#"{
                "games": [
                    {"id": "with", "primaryReleaseId": "r", "relations": [],
                     "media": {"boxart": "with/box.png"}},
                    {"id": "without", "primaryReleaseId": "r2", "relations": []}
                ]
            }"#,
        )
        .expect("valid catalog json");
        assert_eq!(
            catalog.games[0]
                .media
                .as_ref()
                .and_then(|m| m.boxart.as_deref()),
            Some("with/box.png")
        );
        assert_eq!(catalog.games[1].media, None);

        // A game without media omits the field entirely when re-serialised.
        let json = serde_json::to_string(&catalog.games[1]).expect("serialisable");
        assert!(!json.contains("media"), "json was: {json}");
    }

    #[test]
    fn apply_media_sets_release_and_game_targets() {
        let catalog = Catalog::from_json(
            r#"{
                "games": [{"id": "g", "primaryReleaseId": "r", "relations": []}],
                "releases": [{"id": "r", "gameId": "g", "title": "T",
                              "platform": "snes", "releaseType": "retail", "filePath": "t.sfc"}]
            }"#,
        )
        .expect("valid catalog json");

        let release_media = Media {
            image: Some("r/cover.webp".to_string()),
            ..Media::default()
        };
        let game_media = Media {
            boxart: Some("g/box.png".to_string()),
            ..Media::default()
        };
        let updated = apply_media(
            catalog,
            Some(("r".to_string(), Some(release_media.clone()))),
            Some(("g".to_string(), Some(game_media.clone()))),
        );
        assert_eq!(updated.releases[0].media.as_ref(), Some(&release_media));
        assert_eq!(updated.games[0].media.as_ref(), Some(&game_media));
    }

    #[test]
    fn apply_media_clears_with_none_and_ignores_unknown_ids() {
        let catalog = Catalog::from_json(
            r#"{
                "releases": [{"id": "r", "gameId": "g", "title": "T", "platform": "snes",
                              "releaseType": "retail", "filePath": "t.sfc",
                              "media": {"image": "old.webp"}}]
            }"#,
        )
        .expect("valid catalog json");

        // Clearing a known release drops its media; an unknown game id is a no-op.
        let updated = apply_media(
            catalog,
            Some(("r".to_string(), None)),
            Some(("ghost".to_string(), Some(Media::default()))),
        );
        assert_eq!(updated.releases[0].media, None);
        assert!(updated.games.is_empty());
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
