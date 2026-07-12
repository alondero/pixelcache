//! Import scanner module.
//!
//! Crawls a local Vault directory and synthesises a [`Catalog`] from ROM
//! filenames, using the common No-Intro / TOSEC naming conventions
//! (`Title (Region) (Revision) [flags].ext`). This is the inverse of
//! [`crate::catalog`], which *reads* an existing `catalog.json`; here we
//! *generate* one so the same serde schema — and therefore the same UI — can
//! consume it.
//!
//! Following the layering established in [`crate::launch`], the module is split
//! so the decision-making is unit-testable without ever touching the filesystem
//! (see the PRD's "Filename Parser Tests" testing decision):
//!
//! 1. [`platform_for_extension`] / [`parse_filename`] / [`build_catalog`] — pure.
//! 2. [`walk_vault`] / [`scan_vault_to_catalog`] — the only functions that read
//!    the filesystem.
//! 3. [`scan_vault`] — the thin Tauri command; it resolves the Vault directory,
//!    writes `catalog.json`, and stringifies the typed [`ScanError`] only at the
//!    IPC boundary.

use crate::catalog::{Catalog, Game, Release, ReleaseType};
use std::fmt;
use std::path::{Path, PathBuf};

/// Environment variable naming the Vault directory to scan when the frontend
/// invokes `scan_vault` without an explicit path. Mirrors the override pattern
/// used by [`crate::launch`] so a developer can point at a real ROM folder
/// without recompiling.
pub const VAULT_DIR_ENV: &str = "PIXELCACHE_VAULT_DIR";

/// Map a file extension (without the leading dot, any case) to the platform it
/// belongs to, or `None` if the extension is not a recognised ROM.
///
/// This doubles as the "valid ROM file extension" filter for the directory
/// walk: a file is a ROM if and only if this returns `Some`. Only extensions
/// that map unambiguously to a single platform are included — disc images like
/// `.iso`/`.chd` are deliberately omitted because the same extension spans many
/// platforms and would produce an unreliable `platform` field.
pub fn platform_for_extension(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "sfc" | "smc" => Some("snes"),
        "nes" | "fds" => Some("nes"),
        "n64" | "z64" | "v64" => Some("n64"),
        "gb" => Some("gb"),
        "gbc" => Some("gbc"),
        "gba" => Some("gba"),
        "md" | "smd" | "gen" => Some("genesis"),
        "sms" => Some("sms"),
        "gg" => Some("gamegear"),
        "pce" => Some("pcengine"),
        "a26" => Some("atari2600"),
        "ws" | "wsc" => Some("wonderswan"),
        "ngp" | "ngc" => Some("neogeopocket"),
        _ => None,
    }
}

/// The result of parsing a ROM filename stem (the filename without its
/// extension) into its constituent metadata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedName {
    pub title: String,
    pub region: Option<String>,
    pub revision: Option<String>,
    pub release_type: ReleaseType,
}

/// Parse a ROM filename stem using No-Intro / TOSEC conventions.
///
/// The title is everything before the first parenthesised or bracketed tag.
/// Parenthesised tags `(...)` are classified as region, revision, or a
/// release-type marker; bracketed tags `[...]` carry dump flags such as `[h]`
/// (hack) or `[T-En]` (translation). The most specific release type wins
/// (Translation > Hack > Homebrew > Beta > Retail).
pub fn parse_filename(stem: &str) -> ParsedName {
    let title = title_prefix(stem);
    let parens = top_level_groups(stem, '(', ')');
    let brackets = top_level_groups(stem, '[', ']');

    let region = parens.iter().find(|tag| is_region(tag)).cloned();
    let revision = parens.iter().find_map(|tag| revision_of(tag));
    let release_type = classify_release_type(&parens, &brackets);

    ParsedName {
        title,
        region,
        revision,
        release_type,
    }
}

/// A single ROM file discovered by the walk, resolved to what the catalog needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RomFile {
    /// Path relative to the Vault root, using `/` separators for portable JSON.
    pub relative_path: String,
    pub platform: String,
    pub parsed: ParsedName,
}

/// Build a [`Catalog`] from a set of scanned ROM files (pure).
///
/// Releases are grouped into a [`Game`] by the slug of their title, so regional
/// variations and revisions that share a title collapse under one Game card.
/// Cross-title relations (e.g. *Star Fox 64* / *Lylat Wars*) require a curated
/// database and are left for manual `relations` per the PRD.
pub fn build_catalog(files: &[RomFile]) -> Catalog {
    // Sort for deterministic output regardless of filesystem iteration order.
    let mut files = files.to_vec();
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    let mut games: Vec<Game> = Vec::new();
    let mut releases: Vec<Release> = Vec::new();
    let mut used_release_ids: Vec<String> = Vec::new();

    for file in &files {
        let game_id = slug(&file.parsed.title);
        // Skip files whose title slugs to nothing (e.g. a stem of only symbols).
        if game_id.is_empty() {
            continue;
        }

        let release_id = unique_id(&release_base_id(file), &mut used_release_ids);

        releases.push(Release {
            id: release_id.clone(),
            game_id: game_id.clone(),
            title: file.parsed.title.clone(),
            region: file.parsed.region.clone(),
            platform: file.platform.clone(),
            revision: file.parsed.revision.clone(),
            release_type: file.parsed.release_type,
            publisher: None,
            file_path: file.relative_path.clone(),
            media: None,
        });

        if let Some(game) = games.iter_mut().find(|g| g.id == game_id) {
            // A better candidate (more canonical release) may supersede the
            // primary chosen so far.
            let current = releases
                .iter()
                .find(|r| r.id == game.primary_release_id)
                .expect("primary release exists");
            let candidate = releases.last().expect("just pushed");
            if primary_rank(candidate) < primary_rank(current) {
                game.primary_release_id = release_id;
            }
        } else {
            games.push(Game {
                id: game_id,
                developer: None,
                primary_release_id: release_id,
                relations: Vec::new(),
            });
        }
    }

    Catalog {
        games,
        releases,
        decks: Vec::new(),
        // A Vault scan discovers Games/Releases from ROM files; Playlists are a
        // player-curated concept the scanner never generates.
        playlists: Vec::new(),
    }
}

/// Errors that can occur while scanning a Vault directory.
///
/// Per the project's error-handling convention (`CLAUDE.md`), the scanner keeps
/// a typed error and only stringifies it at the Tauri boundary.
#[derive(Debug)]
pub enum ScanError {
    /// No Vault directory was supplied, by argument or the environment.
    NoVaultDir,
    /// The Vault path does not exist or is not a directory.
    NotADirectory { path: String },
    /// A directory could not be read while walking the tree.
    ReadDir {
        path: String,
        source: std::io::Error,
    },
    /// The generated catalog could not be written to disk.
    Write {
        path: String,
        source: std::io::Error,
    },
    /// The generated catalog could not be serialised to JSON.
    Serialize { source: serde_json::Error },
}

impl fmt::Display for ScanError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ScanError::NoVaultDir => {
                write!(f, "no vault directory provided (set {VAULT_DIR_ENV})")
            }
            ScanError::NotADirectory { path } => {
                write!(f, "vault path '{path}' is not a directory")
            }
            ScanError::ReadDir { path, source } => {
                write!(f, "failed to read directory '{path}': {source}")
            }
            ScanError::Write { path, source } => {
                write!(f, "failed to write catalog '{path}': {source}")
            }
            ScanError::Serialize { source } => {
                write!(f, "failed to serialize catalog: {source}")
            }
        }
    }
}

impl std::error::Error for ScanError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ScanError::ReadDir { source, .. } | ScanError::Write { source, .. } => Some(source),
            ScanError::Serialize { source } => Some(source),
            ScanError::NoVaultDir | ScanError::NotADirectory { .. } => None,
        }
    }
}

/// Recursively walk `vault`, returning every recognised ROM file (IO).
///
/// Paths are recorded relative to `vault` with `/` separators so the resulting
/// `filePath` values are portable across platforms in `catalog.json`.
pub fn walk_vault(vault: &Path) -> Result<Vec<RomFile>, ScanError> {
    if !vault.is_dir() {
        return Err(ScanError::NotADirectory {
            path: vault.display().to_string(),
        });
    }
    let mut roms = Vec::new();
    walk_into(vault, vault, &mut roms)?;
    Ok(roms)
}

fn walk_into(root: &Path, dir: &Path, roms: &mut Vec<RomFile>) -> Result<(), ScanError> {
    let entries = std::fs::read_dir(dir).map_err(|source| ScanError::ReadDir {
        path: dir.display().to_string(),
        source,
    })?;

    for entry in entries {
        let entry = entry.map_err(|source| ScanError::ReadDir {
            path: dir.display().to_string(),
            source,
        })?;
        let path = entry.path();
        if path.is_dir() {
            walk_into(root, &path, roms)?;
            continue;
        }
        if let Some(rom) = classify_path(root, &path) {
            roms.push(rom);
        }
    }
    Ok(())
}

/// Turn a single filesystem path into a [`RomFile`] if its extension is a
/// recognised ROM, otherwise `None` (pure given the two paths).
fn classify_path(root: &Path, path: &Path) -> Option<RomFile> {
    let ext = path.extension()?.to_str()?;
    let platform = platform_for_extension(ext)?;
    let stem = path.file_stem()?.to_str()?;
    let relative = path.strip_prefix(root).unwrap_or(path);

    Some(RomFile {
        relative_path: to_portable(relative),
        platform: platform.to_string(),
        parsed: parse_filename(stem),
    })
}

/// Walk a Vault directory and build a [`Catalog`] from it (IO).
pub fn scan_vault_to_catalog(vault: &Path) -> Result<Catalog, ScanError> {
    let roms = walk_vault(vault)?;
    Ok(build_catalog(&roms))
}

/// Serialise `catalog` to pretty JSON and write it to `path`, creating parent
/// directories as needed (IO).
pub fn write_catalog(catalog: &Catalog, path: &Path) -> Result<(), ScanError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|source| ScanError::Write {
            path: parent.display().to_string(),
            source,
        })?;
    }
    let json =
        serde_json::to_string_pretty(catalog).map_err(|source| ScanError::Serialize { source })?;
    std::fs::write(path, json).map_err(|source| ScanError::Write {
        path: path.display().to_string(),
        source,
    })
}

/// Tauri command: scan a Vault directory, persist a fresh `catalog.json`, and
/// return the generated [`Catalog`] so the frontend can refresh its grid.
///
/// `vault_path` overrides the [`VAULT_DIR_ENV`] environment variable. The
/// catalog is written to the app's data directory, which [`crate::catalog`]
/// then prefers over the bundled resource on subsequent loads.
#[tauri::command]
pub async fn scan_vault(
    app: tauri::AppHandle,
    vault_path: Option<String>,
) -> Result<Catalog, String> {
    use tauri::Manager;

    let vault = resolve_vault_dir(vault_path).ok_or_else(|| ScanError::NoVaultDir.to_string())?;

    let catalog = scan_vault_to_catalog(&vault).map_err(|e| e.to_string())?;

    let out_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join(crate::catalog::CATALOG_FILE_NAME);
    write_catalog(&catalog, &out_path).map_err(|e| e.to_string())?;

    Ok(catalog)
}

/// Resolve the Vault directory from an explicit argument, falling back to the
/// [`VAULT_DIR_ENV`] environment variable. Blank values are treated as absent.
fn resolve_vault_dir(vault_path: Option<String>) -> Option<PathBuf> {
    let raw = match vault_path {
        Some(p) if !p.trim().is_empty() => Some(p),
        _ => std::env::var(VAULT_DIR_ENV).ok(),
    }?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

// --- Pure filename-parsing helpers -----------------------------------------

/// The title portion: everything before the first `(` or `[`, trimmed.
fn title_prefix(stem: &str) -> String {
    let end = stem
        .char_indices()
        .find(|&(_, ch)| ch == '(' || ch == '[')
        .map(|(i, _)| i)
        .unwrap_or(stem.len());
    stem[..end].trim().to_string()
}

/// Collect the trimmed contents of every top-level `open`…`close` group.
fn top_level_groups(s: &str, open: char, close: char) -> Vec<String> {
    let mut groups = Vec::new();
    let mut depth = 0usize;
    let mut current = String::new();
    for ch in s.chars() {
        if ch == open {
            if depth > 0 {
                current.push(ch);
            }
            depth += 1;
        } else if ch == close && depth > 0 {
            depth -= 1;
            if depth == 0 {
                groups.push(current.trim().to_string());
                current.clear();
            } else {
                current.push(ch);
            }
        } else if depth > 0 {
            current.push(ch);
        }
    }
    groups
}

/// Known No-Intro region names (plus the PAL/NTSC broadcast standards). A tag
/// counts as a region if its first comma-separated component is one of these,
/// which handles multi-region tags like `USA, Europe`.
const REGIONS: &[&str] = &[
    "USA",
    "Europe",
    "Japan",
    "World",
    "Australia",
    "Germany",
    "France",
    "Spain",
    "Italy",
    "Netherlands",
    "Sweden",
    "Norway",
    "Denmark",
    "Finland",
    "Korea",
    "China",
    "Taiwan",
    "Asia",
    "Brazil",
    "Canada",
    "Mexico",
    "Russia",
    "Poland",
    "UK",
    "Portugal",
    "Greece",
    "Hong Kong",
    "PAL",
    "NTSC",
];

fn is_region(tag: &str) -> bool {
    let first = tag.split(',').next().unwrap_or("").trim();
    REGIONS.iter().any(|r| r.eq_ignore_ascii_case(first))
}

/// Return the normalised revision string if `tag` describes one.
///
/// Recognises No-Intro `Rev N` / `Rev A` and TOSEC-style `v1.1` version tags.
fn revision_of(tag: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    if lower.starts_with("rev ") {
        return Some(tag.trim().to_string());
    }
    // A version tag: `v` followed by a digit, e.g. `v1.0`, `v1.1`.
    let bytes = tag.as_bytes();
    if bytes.len() >= 2 && (bytes[0] == b'v' || bytes[0] == b'V') && bytes[1].is_ascii_digit() {
        return Some(tag.trim().to_string());
    }
    None
}

/// Classify the release type from the parenthesised and bracketed tags, most
/// specific first.
fn classify_release_type(parens: &[String], brackets: &[String]) -> ReleaseType {
    let has = |needle: &str| {
        parens.iter().any(|t| t.eq_ignore_ascii_case(needle))
            || brackets.iter().any(|t| t.eq_ignore_ascii_case(needle))
    };
    // Bracket dump flags start with a type letter, e.g. `[h1C]`, `[T-En]`.
    let bracket_starts = |ch: char| {
        brackets
            .iter()
            .any(|t| t.chars().next().map(|c| c.eq_ignore_ascii_case(&ch)) == Some(true))
    };

    if has("Translation") || bracket_starts('T') {
        ReleaseType::Translation
    } else if has("Hack") || bracket_starts('h') {
        ReleaseType::Hack
    } else if has("Homebrew") || has("Aftermarket") || has("PD") || has("Unl") {
        ReleaseType::Homebrew
    } else if has("Beta") || has("Proto") || has("Prototype") || has("Demo") || has("Sample") {
        ReleaseType::Beta
    } else {
        ReleaseType::Retail
    }
}

// --- Pure catalog-building helpers -----------------------------------------

/// A slug suitable for a stable, URL-ish id: lowercase ASCII alphanumerics with
/// runs of other characters collapsed to single dashes.
fn slug(input: &str) -> String {
    let mut out = String::new();
    let mut pending_dash = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
            pending_dash = false;
        } else {
            pending_dash = true;
        }
    }
    out
}

/// The unqualified release id derived from a file's parsed metadata.
fn release_base_id(file: &RomFile) -> String {
    let mut parts = vec![file.parsed.title.clone()];
    if let Some(region) = &file.parsed.region {
        parts.push(region.clone());
    }
    if let Some(revision) = &file.parsed.revision {
        parts.push(revision.clone());
    }
    let base = slug(&parts.join(" "));
    if base.is_empty() {
        slug(&file.platform)
    } else {
        base
    }
}

/// Ensure an id is unique within the catalog, appending `-2`, `-3`, … on clash.
fn unique_id(base: &str, used: &mut Vec<String>) -> String {
    let mut candidate = base.to_string();
    let mut n = 2;
    while used.iter().any(|u| u == &candidate) {
        candidate = format!("{base}-{n}");
        n += 1;
    }
    used.push(candidate.clone());
    candidate
}

/// Ranking used to pick a Game's primary (canonical) release — lower is better.
/// Prefers retail dumps, then the most canonical region, then no revision.
fn primary_rank(release: &Release) -> (u8, u8, u8) {
    let type_rank = match release.release_type {
        ReleaseType::Retail => 0,
        ReleaseType::Beta => 1,
        ReleaseType::Homebrew => 2,
        ReleaseType::Hack => 3,
        ReleaseType::Translation => 4,
    };
    let region_rank = match release.region.as_deref().map(first_region) {
        Some("USA") => 0,
        Some("World") => 1,
        Some("Europe") => 2,
        Some("Japan") => 3,
        Some(_) => 4,
        None => 5,
    };
    let revision_rank = release.revision.is_some() as u8;
    (type_rank, region_rank, revision_rank)
}

fn first_region(region: &str) -> &str {
    region.split(',').next().unwrap_or(region).trim()
}

/// Render a relative path with `/` separators for portable JSON output.
fn to_portable(path: &Path) -> String {
    path.components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Extension / platform filter ---------------------------------------

    #[test]
    fn recognises_common_rom_extensions_per_platform() {
        assert_eq!(platform_for_extension("sfc"), Some("snes"));
        assert_eq!(platform_for_extension("SMC"), Some("snes")); // case-insensitive
        assert_eq!(platform_for_extension("z64"), Some("n64"));
        assert_eq!(platform_for_extension("gba"), Some("gba"));
        assert_eq!(platform_for_extension("md"), Some("genesis"));
    }

    #[test]
    fn rejects_non_rom_extensions() {
        assert_eq!(platform_for_extension("txt"), None);
        assert_eq!(platform_for_extension("png"), None);
        assert_eq!(platform_for_extension("iso"), None); // ambiguous, deliberately excluded
    }

    // --- Filename parser (No-Intro / TOSEC suite) --------------------------

    #[test]
    fn parses_plain_title_with_region() {
        let p = parse_filename("Super Mario World (USA)");
        assert_eq!(p.title, "Super Mario World");
        assert_eq!(p.region.as_deref(), Some("USA"));
        assert_eq!(p.revision, None);
        assert_eq!(p.release_type, ReleaseType::Retail);
    }

    #[test]
    fn parses_region_and_revision() {
        let p = parse_filename("Legend of Zelda, The (USA) (Rev 1)");
        assert_eq!(p.title, "Legend of Zelda, The");
        assert_eq!(p.region.as_deref(), Some("USA"));
        assert_eq!(p.revision.as_deref(), Some("Rev 1"));
    }

    #[test]
    fn parses_multi_region_tag() {
        let p = parse_filename("Sonic the Hedgehog (USA, Europe)");
        assert_eq!(p.region.as_deref(), Some("USA, Europe"));
    }

    #[test]
    fn parses_tosec_version_as_revision() {
        let p = parse_filename("Sonic The Hedgehog (World) (v1.1)");
        assert_eq!(p.region.as_deref(), Some("World"));
        assert_eq!(p.revision.as_deref(), Some("v1.1"));
    }

    #[test]
    fn detects_hack_from_bracket_flag() {
        let p = parse_filename("Super Mario Bros. 3 (USA) [h1C]");
        assert_eq!(p.title, "Super Mario Bros. 3");
        assert_eq!(p.release_type, ReleaseType::Hack);
    }

    #[test]
    fn detects_translation_from_bracket_flag() {
        let p = parse_filename("Final Fantasy III (Japan) [T-En]");
        assert_eq!(p.release_type, ReleaseType::Translation);
        assert_eq!(p.region.as_deref(), Some("Japan"));
    }

    #[test]
    fn detects_beta_from_paren_tag() {
        let p = parse_filename("Star Fox 2 (Japan) (Beta)");
        assert_eq!(p.release_type, ReleaseType::Beta);
    }

    #[test]
    fn detects_prototype_as_beta() {
        let p = parse_filename("Some Game (USA) (Proto)");
        assert_eq!(p.release_type, ReleaseType::Beta);
    }

    #[test]
    fn detects_homebrew_from_unlicensed_tag() {
        let p = parse_filename("Homebrew Game (World) (Unl)");
        assert_eq!(p.release_type, ReleaseType::Homebrew);
    }

    #[test]
    fn language_only_tag_is_not_treated_as_region() {
        let p = parse_filename("Chrono Trigger (En,Fr,De)");
        assert_eq!(p.region, None);
    }

    #[test]
    fn title_only_filename_has_no_tags() {
        let p = parse_filename("Tetris");
        assert_eq!(p.title, "Tetris");
        assert_eq!(p.region, None);
        assert_eq!(p.revision, None);
        assert_eq!(p.release_type, ReleaseType::Retail);
    }

    // --- Catalog building ---------------------------------------------------

    fn rom(relative_path: &str, platform: &str, parsed: ParsedName) -> RomFile {
        RomFile {
            relative_path: relative_path.to_string(),
            platform: platform.to_string(),
            parsed,
        }
    }

    #[test]
    fn groups_regional_variations_under_one_game() {
        let files = vec![
            rom(
                "smw/Super Mario World (USA).sfc",
                "snes",
                parse_filename("Super Mario World (USA)"),
            ),
            rom(
                "smw/Super Mario World (Europe).sfc",
                "snes",
                parse_filename("Super Mario World (Europe)"),
            ),
        ];
        let catalog = build_catalog(&files);
        assert_eq!(catalog.games.len(), 1);
        assert_eq!(catalog.releases.len(), 2);
        let game = &catalog.games[0];
        assert_eq!(game.id, "super-mario-world");
        let for_game = catalog
            .releases
            .iter()
            .filter(|r| r.game_id == game.id)
            .count();
        assert_eq!(for_game, 2);
    }

    #[test]
    fn hack_and_retail_of_same_title_share_a_game() {
        let files = vec![
            rom(
                "smb3/Super Mario Bros. 3 (USA).nes",
                "nes",
                parse_filename("Super Mario Bros. 3 (USA)"),
            ),
            rom(
                "smb3/Super Mario Bros. 3 (USA) [h1].nes",
                "nes",
                parse_filename("Super Mario Bros. 3 (USA) [h1]"),
            ),
        ];
        let catalog = build_catalog(&files);
        assert_eq!(catalog.games.len(), 1);
        // The retail dump is preferred as the primary release over the hack.
        let primary = catalog
            .releases
            .iter()
            .find(|r| r.id == catalog.games[0].primary_release_id)
            .unwrap();
        assert_eq!(primary.release_type, ReleaseType::Retail);
    }

    #[test]
    fn prefers_usa_retail_as_primary_release() {
        let files = vec![
            rom(
                "z/Zelda (Japan).sfc",
                "snes",
                parse_filename("Zelda (Japan)"),
            ),
            rom("z/Zelda (USA).sfc", "snes", parse_filename("Zelda (USA)")),
        ];
        let catalog = build_catalog(&files);
        let primary = catalog
            .releases
            .iter()
            .find(|r| r.id == catalog.games[0].primary_release_id)
            .unwrap();
        assert_eq!(primary.region.as_deref(), Some("USA"));
    }

    #[test]
    fn release_ids_are_unique_even_with_identical_metadata() {
        let files = vec![
            rom("a/Tetris (USA).nes", "nes", parse_filename("Tetris (USA)")),
            rom("b/Tetris (USA).nes", "nes", parse_filename("Tetris (USA)")),
        ];
        let catalog = build_catalog(&files);
        assert_eq!(catalog.releases.len(), 2);
        assert_ne!(catalog.releases[0].id, catalog.releases[1].id);
    }

    #[test]
    fn output_is_deterministic_regardless_of_input_order() {
        let a = rom("a/A (USA).nes", "nes", parse_filename("A (USA)"));
        let b = rom("b/B (USA).nes", "nes", parse_filename("B (USA)"));
        let one = build_catalog(&[a.clone(), b.clone()]);
        let two = build_catalog(&[b, a]);
        assert_eq!(one, two);
    }

    #[test]
    fn build_catalog_produces_no_decks() {
        let files = vec![rom("t/Tetris.nes", "nes", parse_filename("Tetris"))];
        let catalog = build_catalog(&files);
        assert!(catalog.decks.is_empty());
    }

    #[test]
    fn generated_catalog_round_trips_through_serde() {
        let files = vec![rom(
            "smw/Super Mario World (USA).sfc",
            "snes",
            parse_filename("Super Mario World (USA)"),
        )];
        let catalog = build_catalog(&files);
        let json = serde_json::to_string(&catalog).expect("serialisable");
        let reparsed = Catalog::from_json(&json).expect("valid catalog json");
        assert_eq!(catalog, reparsed);
    }

    // --- Directory walk (IO) ------------------------------------------------

    fn temp_dir(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("pixelcache-scan-{}-{}", label, std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp vault");
        dir
    }

    #[test]
    fn walk_vault_finds_roms_and_ignores_other_files() {
        let dir = temp_dir("walk");
        std::fs::write(dir.join("Super Mario World (USA).sfc"), b"rom").unwrap();
        std::fs::write(dir.join("readme.txt"), b"not a rom").unwrap();
        let sub = dir.join("n64");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("Star Fox 64 (USA).z64"), b"rom").unwrap();

        let mut roms = walk_vault(&dir).expect("walk succeeds");
        std::fs::remove_dir_all(&dir).ok();

        roms.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        assert_eq!(roms.len(), 2);
        assert!(roms.iter().any(|r| r.platform == "snes"));
        assert!(roms.iter().any(|r| r.platform == "n64"));
        // Nested paths are recorded portably with '/'.
        assert!(roms
            .iter()
            .any(|r| r.relative_path == "n64/Star Fox 64 (USA).z64"));
    }

    #[test]
    fn walk_vault_rejects_a_non_directory() {
        let path = Path::new("definitely-not-a-real-pixelcache-vault-dir");
        let err = walk_vault(path).expect_err("missing dir errors");
        assert!(matches!(err, ScanError::NotADirectory { .. }));
    }

    #[test]
    fn no_vault_dir_error_names_the_env_var() {
        let message = ScanError::NoVaultDir.to_string();
        assert!(message.contains(VAULT_DIR_ENV), "message was: {message}");
    }

    #[test]
    fn scan_vault_to_catalog_end_to_end() {
        let dir = temp_dir("e2e");
        std::fs::write(dir.join("Super Mario World (USA).sfc"), b"rom").unwrap();
        std::fs::write(dir.join("Super Mario World (Europe).sfc"), b"rom").unwrap();

        let catalog = scan_vault_to_catalog(&dir);
        std::fs::remove_dir_all(&dir).ok();

        let catalog = catalog.expect("scan succeeds");
        assert_eq!(catalog.games.len(), 1);
        assert_eq!(catalog.releases.len(), 2);
    }

    #[test]
    fn write_catalog_writes_valid_reloadable_json() {
        let dir = temp_dir("write");
        let files = vec![rom(
            "smw/Super Mario World (USA).sfc",
            "snes",
            parse_filename("Super Mario World (USA)"),
        )];
        let catalog = build_catalog(&files);
        let out = dir.join("nested").join("catalog.json");

        write_catalog(&catalog, &out).expect("write succeeds");
        let reloaded = crate::catalog::load_catalog_from_path(&out).expect("reloads");
        std::fs::remove_dir_all(&dir).ok();

        assert_eq!(reloaded, catalog);
    }
}
