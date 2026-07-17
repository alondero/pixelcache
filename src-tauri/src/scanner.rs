//! Import scanner module.
//!
//! Crawls platform-scoped [`Vault`]s and synthesises a [`Catalog`] from ROM
//! filenames, using the common No-Intro / TOSEC naming conventions
//! (`Title (Region) (Revision) [flags].ext`). This is the inverse of
//! [`crate::catalog`], which *reads* an existing `catalog.json`; here we
//! *generate* one so the same serde schema — and therefore the same UI — can
//! consume it.
//!
//! ## The Vault model (ADR 0004)
//!
//! A [`Vault`] is bound to exactly one platform and simply *is* the folder where
//! that platform's games live. The platform is therefore *declared*, not guessed
//! from the file extension as it was in the single-directory model this replaces.
//! Two consequences fall out of that:
//!
//! * A scan iterates over *many* Vaults (one per platform, occasionally several)
//!   and merges their Releases into one Catalog.
//! * Ambiguous disc extensions (`.iso`, `.chd`, `.cue`) become scannable, because
//!   the Vault — not the extension — says which platform a file belongs to.
//!
//! ## Reconciliation
//!
//! A Vault is only *one* source of Releases: the player can also add a Release by
//! hand (for a console or a Playlist) from a location outside any Vault. So a
//! rescan does not overwrite the Catalog wholesale — [`apply_scan`] *reconciles*,
//! replacing only the Releases owned by the scanned Vaults and preserving manual
//! Releases, Decks, Playlists, the Vault config, and curated Game metadata.
//!
//! Following the layering established in [`crate::launch`], the module is split
//! so the decision-making is unit-testable without ever touching the filesystem
//! (see the PRD's "Filename Parser Tests" testing decision):
//!
//! 1. [`default_extensions_for_platform`] / [`parse_filename`] / [`apply_scan`]
//!    — pure.
//! 2. [`walk_vault`] / [`scan_vaults_to_files`] — the only functions that read
//!    the filesystem.
//! 3. [`scan_vault`] — the thin Tauri command; it resolves the Vaults to scan,
//!    reconciles against the existing catalog, writes `catalog.json`, and
//!    stringifies the typed [`ScanError`] only at the IPC boundary.

use crate::catalog::{Catalog, Deck, DeckKind, Game, Release, ReleaseType, Vault};
use std::fmt;
use std::path::Path;

/// Environment variable naming a single ad-hoc Vault directory to scan when no
/// Vaults are configured in the catalog and none are passed explicitly. A dev
/// convenience mirroring the override pattern used by [`crate::launch`]; it must
/// be paired with [`VAULT_PLATFORM_ENV`] so the scanner knows the platform.
pub const VAULT_DIR_ENV: &str = "PIXELCACHE_VAULT_DIR";

/// Environment variable naming the platform of the ad-hoc [`VAULT_DIR_ENV`]
/// Vault. Required for the env fallback because a Vault is platform-scoped.
pub const VAULT_PLATFORM_ENV: &str = "PIXELCACHE_VAULT_PLATFORM";

/// The default set of ROM file extensions (without the leading dot, lower-case)
/// for a platform, or an empty slice for a platform with no built-in mapping.
///
/// This is the inverse of the old extension→platform lookup: the platform is
/// known up-front from the [`Vault`], so a single mapping can list every
/// extension the platform uses — including the disc-image formats (`.iso`,
/// `.chd`, …) that were previously excluded for being ambiguous across
/// platforms. A Vault whose platform is not listed here must supply an explicit
/// [`Vault::pattern`].
pub fn default_extensions_for_platform(platform: &str) -> &'static [&'static str] {
    match platform {
        // Cartridge platforms — one extension family each.
        "snes" => &["sfc", "smc"],
        "nes" => &["nes", "fds"],
        "n64" => &["n64", "z64", "v64"],
        "gb" => &["gb"],
        "gbc" => &["gbc"],
        "gba" => &["gba"],
        "genesis" => &["md", "smd", "gen"],
        "sms" => &["sms"],
        "gamegear" => &["gg"],
        "pcengine" => &["pce"],
        "atari2600" => &["a26"],
        "wonderswan" => &["ws", "wsc"],
        "neogeopocket" => &["ngp", "ngc"],
        // Disc-based platforms — now unambiguous because the Vault declares the
        // platform, so the same `.iso`/`.chd` can mean different things per Vault.
        "ps1" => &["chd", "cue", "bin", "img", "pbp", "iso"],
        "ps2" => &["iso", "chd", "cue", "bin"],
        "psp" => &["iso", "cso", "chd"],
        "gamecube" => &["iso", "gcm", "rvz", "ciso"],
        "wii" => &["iso", "rvz", "wbfs"],
        "dreamcast" => &["chd", "gdi", "cdi"],
        "saturn" => &["chd", "cue", "bin", "iso"],
        "segacd" => &["chd", "cue", "bin", "iso"],
        "3do" => &["chd", "cue", "iso"],
        "pcenginecd" => &["chd", "cue", "bin"],
        _ => &[],
    }
}

/// Resolve the extension allow-list for a Vault: its explicit [`Vault::pattern`]
/// if set, otherwise the platform default. Returned lower-cased and de-duped.
pub fn vault_extensions(vault: &Vault) -> Vec<String> {
    match &vault.pattern {
        Some(pattern) => parse_pattern(pattern),
        None => default_extensions_for_platform(&vault.platform)
            .iter()
            .map(|s| s.to_string())
            .collect(),
    }
}

/// Parse a Vault pattern into a list of bare, lower-case extensions.
///
/// Accepts a comma / semicolon / whitespace separated list; each entry may be a
/// bare extension (`chd`), dotted (`.chd`), or a simple glob (`*.chd`).
fn parse_pattern(pattern: &str) -> Vec<String> {
    let mut exts: Vec<String> = Vec::new();
    for raw in pattern.split(|c: char| c == ',' || c == ';' || c.is_whitespace()) {
        let ext = raw
            .trim()
            .trim_start_matches("*.")
            .trim_start_matches('.')
            .to_ascii_lowercase();
        if !ext.is_empty() && !exts.contains(&ext) {
            exts.push(ext);
        }
    }
    exts
}

/// Whether `path`'s extension is in the allow-list (case-insensitive). This is
/// the "is this file a ROM for the Vault" filter for the directory walk.
fn extension_matches(exts: &[String], path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let ext = ext.to_ascii_lowercase();
            exts.iter().any(|e| e == &ext)
        }
        None => false,
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
    /// Path relative to the owning Vault root, using `/` separators for portable
    /// JSON. Resolved back to an absolute path against the Vault at launch time.
    pub relative_path: String,
    pub platform: String,
    /// The id of the [`Vault`] this file was found in, recorded on the generated
    /// Release so reconciliation and launch can tie it back to its source.
    pub vault_id: String,
    pub parsed: ParsedName,
}

/// Reconcile a set of freshly scanned ROM files into an existing [`Catalog`],
/// returning the merged result (pure).
///
/// A scan owns only the Releases that came from the Vaults it scanned
/// (`scanned_vault_ids`). Everything else is preserved verbatim:
///
/// * **Manual Releases** (no `vault_id`) and Releases from Vaults *not* in this
///   scan are kept — the player added or scanned those elsewhere.
/// * Releases from the scanned Vaults are dropped and rebuilt from `files`, so a
///   ROM deleted on disk disappears from the catalog on the next scan.
/// * **Playlists** and the **Vault** config carry over unchanged.
/// * Existing **Decks** carry over; additionally, a placeholder Deck is *seeded*
///   for any discovered platform that has none, so a freshly scanned library is
///   launchable (or one edit away from it) instead of erroring with "no deck
///   configured" — see [`seed_decks`].
/// * A [`Game`]'s curated `developer` / `relations` survive; only its
///   `primary_release_id` is recomputed from the reconciled Release set.
///
/// Releases are grouped into a [`Game`] by the slug of their title, so regional
/// variations and revisions — and straight ports across platforms — collapse
/// under one Game card.
pub fn apply_scan(existing: &Catalog, files: &[RomFile], scanned_vault_ids: &[String]) -> Catalog {
    let owned_by_scan = |vault_id: &Option<String>| match vault_id {
        Some(id) => scanned_vault_ids.iter().any(|s| s == id),
        None => false,
    };

    // Retain everything this scan does not own, preserving order.
    let mut releases: Vec<Release> = existing
        .releases
        .iter()
        .filter(|r| !owned_by_scan(&r.vault_id))
        .cloned()
        .collect();
    let mut used_release_ids: Vec<String> = releases.iter().map(|r| r.id.clone()).collect();

    // Sort for deterministic output regardless of filesystem iteration order.
    let mut files = files.to_vec();
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    for file in &files {
        let game_id = slug(&file.parsed.title);
        // Skip files whose title slugs to nothing (e.g. a stem of only symbols).
        if game_id.is_empty() {
            continue;
        }

        let release_id = unique_id(&release_base_id(file), &mut used_release_ids);
        releases.push(Release {
            id: release_id,
            game_id,
            title: file.parsed.title.clone(),
            region: file.parsed.region.clone(),
            platform: file.platform.clone(),
            revision: file.parsed.revision.clone(),
            release_type: file.parsed.release_type,
            publisher: None,
            vault_id: Some(file.vault_id.clone()),
            deck_id: None,
            file_path: file.relative_path.clone(),
            media: None,
        });
    }

    let decks = seed_decks(&existing.decks, &releases);

    Catalog {
        games: group_games(&releases, &existing.games),
        releases,
        decks,
        playlists: existing.playlists.clone(),
        vaults: existing.vaults.clone(),
    }
}

/// Group Releases into Games by title slug, preserving curated metadata from
/// `existing_games` and recomputing each Game's primary (canonical) Release.
fn group_games(releases: &[Release], existing_games: &[Game]) -> Vec<Game> {
    let mut games: Vec<Game> = Vec::new();
    for release in releases {
        if let Some(game) = games.iter_mut().find(|g| g.id == release.game_id) {
            // A more canonical Release supersedes the primary chosen so far.
            let current = releases
                .iter()
                .find(|r| r.id == game.primary_release_id)
                .expect("primary release exists in the reconciled set");
            if primary_rank(release) < primary_rank(current) {
                game.primary_release_id = release.id.clone();
            }
        } else {
            // Seed developer / relations / media / favorite from the curated
            // Game if we already had one under this id; a fresh Game starts
            // with none. Curated fields must survive a rescan — dropping any
            // of them here would silently wipe user edits.
            let (developer, relations, media, favorite) = existing_games
                .iter()
                .find(|g| g.id == release.game_id)
                .map(|g| {
                    (
                        g.developer.clone(),
                        g.relations.clone(),
                        g.media.clone(),
                        g.favorite,
                    )
                })
                .unwrap_or((None, Vec::new(), None, false));
            games.push(Game {
                id: release.game_id.clone(),
                developer,
                primary_release_id: release.id.clone(),
                relations,
                media,
                favorite,
            });
        }
    }
    games
}

/// A best-guess standalone emulator command for a platform, used as the
/// executable of a *seeded placeholder Deck* so a freshly scanned library has
/// something to launch. Mirrors [`default_extensions_for_platform`]: the platform
/// is known from the Vault, so a sensible default command can be suggested. The
/// user confirms or edits it on the Decks settings screen; an unknown platform
/// yields `None`, leaving the seeded Deck's executable blank for the user to fill
/// in.
pub fn default_emulator_for_platform(platform: &str) -> Option<&'static str> {
    let command = match platform {
        "snes" => "snes9x",
        "nes" => "fceux",
        "n64" => "mupen64plus",
        "gb" | "gbc" | "gba" => "mgba",
        "genesis" | "sms" | "gamegear" | "segacd" => "blastem",
        "pcengine" | "pcenginecd" => "mednafen",
        "atari2600" => "stella",
        "wonderswan" | "neogeopocket" => "mednafen",
        "ps1" => "duckstation",
        "ps2" => "pcsx2",
        "psp" => "ppsspp",
        "gamecube" | "wii" => "dolphin-emu",
        "dreamcast" | "saturn" => "flycast",
        "3do" => "retroarch",
        _ => return None,
    };
    Some(command)
}

/// Seed a placeholder [`Deck`] for every platform present in `releases` that has
/// no Deck yet, preserving all existing Decks.
///
/// Before Phase 2 a scanned library launched *nothing*: the launch engine errored
/// with "no deck configured for platform" until the user hand-edited a Deck into
/// `catalog.json`. Seeding gives each discovered platform a starting Deck — its
/// default flag set, a best-guess emulator command (see
/// [`default_emulator_for_platform`], blank when the platform is unknown) — that
/// the Decks settings screen can then confirm or correct. Existing Decks always
/// win: a platform the user has already configured is never given a second Deck.
fn seed_decks(existing_decks: &[Deck], releases: &[Release]) -> Vec<Deck> {
    let mut decks = existing_decks.to_vec();

    // Platforms already covered by a Deck, so we never double-seed.
    let mut covered: Vec<String> = decks.iter().map(|d| d.platform.clone()).collect();

    for release in releases {
        if covered.iter().any(|p| p == &release.platform) {
            continue;
        }
        covered.push(release.platform.clone());
        decks.push(Deck {
            id: format!("{}-default", release.platform),
            platform: release.platform.clone(),
            executable_path: default_emulator_for_platform(&release.platform)
                .unwrap_or("")
                .to_string(),
            arguments: Vec::new(),
            kind: DeckKind::Emulator,
            is_default: true,
        });
    }
    decks
}

/// Errors that can occur while scanning Vaults.
///
/// Per the project's error-handling convention (`CLAUDE.md`), the scanner keeps
/// a typed error and only stringifies it at the Tauri boundary.
#[derive(Debug)]
pub enum ScanError {
    /// No Vaults were configured, passed, or resolvable from the environment.
    NoVaults,
    /// A Vault's path does not exist or is not a directory.
    NotADirectory { vault_id: String, path: String },
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
            ScanError::NoVaults => write!(
                f,
                "no vaults to scan (configure vaults in catalog.json, or set \
                 {VAULT_DIR_ENV} and {VAULT_PLATFORM_ENV})"
            ),
            ScanError::NotADirectory { vault_id, path } => {
                write!(f, "vault '{vault_id}' path '{path}' is not a directory")
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
            ScanError::NoVaults | ScanError::NotADirectory { .. } => None,
        }
    }
}

/// Recursively walk a single [`Vault`], returning every file that matches its
/// extension allow-list (IO).
///
/// Every discovered [`RomFile`] is tagged with `vault.platform` and `vault.id`;
/// paths are recorded relative to the Vault root with `/` separators so the
/// resulting `filePath` values are portable across platforms in `catalog.json`.
pub fn walk_vault(vault: &Vault) -> Result<Vec<RomFile>, ScanError> {
    let root = Path::new(&vault.path);
    if !root.is_dir() {
        return Err(ScanError::NotADirectory {
            vault_id: vault.id.clone(),
            path: vault.path.clone(),
        });
    }
    let exts = vault_extensions(vault);
    let mut roms = Vec::new();
    walk_into(vault, &exts, root, root, &mut roms)?;
    Ok(roms)
}

fn walk_into(
    vault: &Vault,
    exts: &[String],
    root: &Path,
    dir: &Path,
    roms: &mut Vec<RomFile>,
) -> Result<(), ScanError> {
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
            walk_into(vault, exts, root, &path, roms)?;
            continue;
        }
        if let Some(rom) = classify_path(vault, exts, root, &path) {
            roms.push(rom);
        }
    }
    Ok(())
}

/// Turn a single filesystem path into a [`RomFile`] for `vault` if its extension
/// is in the allow-list, otherwise `None` (pure given the paths).
fn classify_path(vault: &Vault, exts: &[String], root: &Path, path: &Path) -> Option<RomFile> {
    if !extension_matches(exts, path) {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    let relative = path.strip_prefix(root).unwrap_or(path);

    Some(RomFile {
        relative_path: to_portable(relative),
        platform: vault.platform.clone(),
        vault_id: vault.id.clone(),
        parsed: parse_filename(stem),
    })
}

/// Walk every Vault and collect their ROM files (IO).
pub fn scan_vaults_to_files(vaults: &[Vault]) -> Result<Vec<RomFile>, ScanError> {
    let mut roms = Vec::new();
    for vault in vaults {
        roms.extend(walk_vault(vault)?);
    }
    Ok(roms)
}

/// Serialise `catalog` to pretty JSON and write it to `path`, creating parent
/// directories as needed (IO). Delegates to the shared atomic writer in
/// [`crate::catalog`] so all callers of `catalog.json` (the scanner, the Decks
/// settings save, the Media save, the new favorite toggle) race-safely rename
/// over a single destination — a non-atomic write can otherwise truncate the
/// file mid-flight and drop the user's curated fields.
pub fn write_catalog(catalog: &Catalog, path: &Path) -> Result<(), ScanError> {
    let json =
        serde_json::to_string_pretty(catalog).map_err(|source| ScanError::Serialize { source })?;
    crate::catalog::write_catalog_string_atomic(&json, path).map_err(|e| match e {
        crate::catalog::CatalogError::Write { path, source } => ScanError::Write { path, source },
        // `write_catalog_string_atomic` only ever produces Write errors; the
        // other CatalogError variants exist for the catalog-loading path.
        other => ScanError::Write {
            path: path.display().to_string(),
            source: std::io::Error::other(other.to_string()),
        },
    })
}

/// Tauri command: scan the configured Vaults, reconcile against the existing
/// `catalog.json`, persist it, and return the merged [`Catalog`] so the frontend
/// can refresh its grid.
///
/// The Vaults to scan are resolved, in order of precedence, from: the `vaults`
/// argument (a UI-supplied set, also persisted into the catalog), the catalog's
/// own `vaults`, or the [`VAULT_DIR_ENV`] + [`VAULT_PLATFORM_ENV`] env pair for a
/// single ad-hoc dev Vault. The catalog is written to the app's data directory,
/// which [`crate::catalog`] then prefers over the bundled resource on subsequent
/// loads.
#[tauri::command]
pub async fn scan_vault(
    app: tauri::AppHandle,
    vaults: Option<Vec<Vault>>,
) -> Result<Catalog, String> {
    use tauri::Manager;

    // Load the current catalog so manual Releases, Decks, Playlists, and curated
    // Game metadata survive the rescan. A missing catalog is treated as empty.
    let existing = crate::catalog::load_bundled_catalog(&app).unwrap_or_default();

    let to_scan = resolve_vaults(vaults, &existing).map_err(|e| e.to_string())?;

    let files = scan_vaults_to_files(&to_scan).map_err(|e| e.to_string())?;
    let scanned_ids: Vec<String> = to_scan.iter().map(|v| v.id.clone()).collect();

    // Persist the scanned Vault definitions alongside any others already known.
    let mut base = existing;
    upsert_vaults(&mut base.vaults, &to_scan);

    let catalog = apply_scan(&base, &files, &scanned_ids);

    let out_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join(crate::catalog::CATALOG_FILE_NAME);
    write_catalog(&catalog, &out_path).map_err(|e| e.to_string())?;

    Ok(catalog)
}

/// Resolve which Vaults to scan: an explicit argument, else the catalog's
/// configured Vaults, else a single env-defined ad-hoc Vault for local dev.
fn resolve_vaults(arg: Option<Vec<Vault>>, existing: &Catalog) -> Result<Vec<Vault>, ScanError> {
    if let Some(vaults) = arg {
        if !vaults.is_empty() {
            return Ok(vaults);
        }
    }
    if !existing.vaults.is_empty() {
        return Ok(existing.vaults.clone());
    }
    if let Some(vault) = env_vault() {
        return Ok(vec![vault]);
    }
    Err(ScanError::NoVaults)
}

/// A single ad-hoc Vault built from [`VAULT_DIR_ENV`] + [`VAULT_PLATFORM_ENV`],
/// or `None` when either is unset/blank. Blank values are treated as absent.
fn env_vault() -> Option<Vault> {
    let non_blank = |var: &str| {
        std::env::var(var)
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };
    let path = non_blank(VAULT_DIR_ENV)?;
    let platform = non_blank(VAULT_PLATFORM_ENV)?;
    Some(Vault {
        id: format!("{platform}-vault"),
        platform,
        path,
        pattern: None,
    })
}

/// Insert or replace each incoming Vault into `vaults`, keyed by id, so a
/// rescan's Vault definitions are persisted without duplicating existing ones.
fn upsert_vaults(vaults: &mut Vec<Vault>, incoming: &[Vault]) {
    for vault in incoming {
        if let Some(existing) = vaults.iter_mut().find(|v| v.id == vault.id) {
            *existing = vault.clone();
        } else {
            vaults.push(vault.clone());
        }
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
    use std::path::PathBuf;

    /// Build a fresh [`Catalog`] from scanned files, treating every Vault they
    /// reference as scanned — the scan-from-nothing case, exercised on its own.
    fn build_catalog(files: &[RomFile]) -> Catalog {
        let mut vault_ids: Vec<String> = Vec::new();
        for file in files {
            if !vault_ids.contains(&file.vault_id) {
                vault_ids.push(file.vault_id.clone());
            }
        }
        apply_scan(&Catalog::default(), files, &vault_ids)
    }

    // --- Extension / platform filter ---------------------------------------

    #[test]
    fn platform_defaults_cover_cartridge_and_disc_systems() {
        assert!(default_extensions_for_platform("snes").contains(&"sfc"));
        assert!(default_extensions_for_platform("n64").contains(&"z64"));
        // Disc formats are now first-class because the Vault names the platform.
        assert!(default_extensions_for_platform("ps1").contains(&"chd"));
        assert!(default_extensions_for_platform("gamecube").contains(&"iso"));
    }

    #[test]
    fn unknown_platform_has_no_default_extensions() {
        assert!(default_extensions_for_platform("dridgeland").is_empty());
    }

    #[test]
    fn pattern_overrides_platform_defaults() {
        let vault = vault("v", "snes", "/x", Some("iso, chd"));
        let exts = vault_extensions(&vault);
        assert_eq!(exts, vec!["iso".to_string(), "chd".to_string()]);
    }

    #[test]
    fn pattern_accepts_dotted_and_glob_forms() {
        assert_eq!(parse_pattern("*.chd .cue bin"), vec!["chd", "cue", "bin"]);
        // Case-insensitive and de-duplicated.
        assert_eq!(parse_pattern("ISO, iso; ISO"), vec!["iso"]);
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

    fn vault(id: &str, platform: &str, path: &str, pattern: Option<&str>) -> Vault {
        Vault {
            id: id.to_string(),
            platform: platform.to_string(),
            path: path.to_string(),
            pattern: pattern.map(|p| p.to_string()),
        }
    }

    fn rom(relative_path: &str, platform: &str, parsed: ParsedName) -> RomFile {
        rom_in(relative_path, platform, "vault", parsed)
    }

    fn rom_in(relative_path: &str, platform: &str, vault_id: &str, parsed: ParsedName) -> RomFile {
        RomFile {
            relative_path: relative_path.to_string(),
            platform: platform.to_string(),
            vault_id: vault_id.to_string(),
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
    fn scanned_releases_carry_their_vault_id() {
        let files = vec![rom_in(
            "Super Mario World (USA).sfc",
            "snes",
            "snes-vault",
            parse_filename("Super Mario World (USA)"),
        )];
        let catalog = build_catalog(&files);
        assert_eq!(catalog.releases[0].vault_id.as_deref(), Some("snes-vault"));
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
    fn build_catalog_seeds_a_default_deck_per_platform() {
        let files = vec![
            rom("t/Tetris.nes", "nes", parse_filename("Tetris")),
            rom(
                "s/Super Metroid.sfc",
                "snes",
                parse_filename("Super Metroid"),
            ),
        ];
        let catalog = build_catalog(&files);
        // One placeholder deck per discovered platform, each marked default.
        assert_eq!(catalog.decks.len(), 2);
        assert!(catalog.decks.iter().all(|d| d.is_default));
        let nes = catalog
            .decks
            .iter()
            .find(|d| d.platform == "nes")
            .expect("nes deck seeded");
        assert_eq!(nes.id, "nes-default");
        assert_eq!(nes.executable_path, "fceux");
        assert_eq!(nes.kind, crate::catalog::DeckKind::Emulator);
    }

    #[test]
    fn unknown_platform_seeds_a_deck_with_a_blank_executable() {
        let files = vec![rom("x/Game.rom", "dridgeland", parse_filename("Game"))];
        let catalog = build_catalog(&files);
        let deck = &catalog.decks[0];
        assert_eq!(deck.platform, "dridgeland");
        assert_eq!(deck.executable_path, "");
        assert!(deck.is_default);
    }

    #[test]
    fn seed_decks_never_overrides_an_existing_platform_deck() {
        // The user has already configured a custom snes deck; a rescan must not
        // add a second one for snes, but should still seed the new nes platform.
        let existing = Catalog::from_json(
            r#"{
                "decks": [{"id": "my-snes", "platform": "snes",
                           "executablePath": "/opt/bsnes"}]
            }"#,
        )
        .expect("valid catalog");
        let files = vec![
            rom_in(
                "Super Mario World (USA).sfc",
                "snes",
                "snes-vault",
                parse_filename("Super Mario World (USA)"),
            ),
            rom_in(
                "Metroid (USA).nes",
                "nes",
                "nes-vault",
                parse_filename("Metroid (USA)"),
            ),
        ];
        let catalog = apply_scan(
            &existing,
            &files,
            &["snes-vault".to_string(), "nes-vault".to_string()],
        );

        let snes_decks: Vec<_> = catalog
            .decks
            .iter()
            .filter(|d| d.platform == "snes")
            .collect();
        assert_eq!(
            snes_decks.len(),
            1,
            "existing snes deck preserved, not doubled"
        );
        assert_eq!(snes_decks[0].id, "my-snes");
        // The newly discovered nes platform got its placeholder deck.
        assert!(catalog
            .decks
            .iter()
            .any(|d| d.platform == "nes" && d.id == "nes-default"));
    }

    #[test]
    fn default_emulator_covers_cartridge_and_disc_platforms() {
        assert_eq!(default_emulator_for_platform("n64"), Some("mupen64plus"));
        assert_eq!(default_emulator_for_platform("ps2"), Some("pcsx2"));
        assert_eq!(
            default_emulator_for_platform("gamecube"),
            Some("dolphin-emu")
        );
        assert_eq!(default_emulator_for_platform("dridgeland"), None);
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

    // --- Reconciliation (apply_scan) ---------------------------------------

    #[test]
    fn rescan_preserves_manual_releases_decks_and_playlists() {
        let existing = Catalog::from_json(
            r#"{
                "games": [{"id": "manual", "primaryReleaseId": "manual-rel", "relations": []}],
                "releases": [{
                    "id": "manual-rel", "gameId": "manual", "title": "Manual",
                    "platform": "snes", "releaseType": "retail", "filePath": "/elsewhere/manual.sfc"
                }],
                "decks": [{"id": "d", "platform": "snes", "executablePath": "snes9x", "arguments": []}],
                "playlists": [{"id": "p", "name": "P", "releaseIds": ["manual-rel"]}]
            }"#,
        )
        .expect("valid catalog");

        let files = vec![rom_in(
            "Super Mario World (USA).sfc",
            "snes",
            "snes-vault",
            parse_filename("Super Mario World (USA)"),
        )];
        let catalog = apply_scan(&existing, &files, &["snes-vault".to_string()]);

        // Manual release survives untouched (still no vault, still absolute path).
        let manual = catalog
            .releases
            .iter()
            .find(|r| r.id == "manual-rel")
            .expect("manual release preserved");
        assert_eq!(manual.vault_id, None);
        assert_eq!(manual.file_path, "/elsewhere/manual.sfc");
        // Scanned release was added.
        assert!(catalog
            .releases
            .iter()
            .any(|r| r.title == "Super Mario World"));
        // Decks and playlists carried over.
        assert_eq!(catalog.decks.len(), 1);
        assert_eq!(catalog.playlists.len(), 1);
    }

    #[test]
    fn rescan_replaces_only_the_scanned_vaults_releases() {
        let existing = Catalog::from_json(
            r#"{
                "releases": [
                    {"id": "old-snes", "gameId": "g", "title": "Old", "platform": "snes",
                     "releaseType": "retail", "vaultId": "snes-vault", "filePath": "Old.sfc"},
                    {"id": "keep-nes", "gameId": "h", "title": "Keep", "platform": "nes",
                     "releaseType": "retail", "vaultId": "nes-vault", "filePath": "Keep.nes"}
                ]
            }"#,
        )
        .expect("valid catalog");

        // Rescanning only the snes vault drops its stale release but keeps the
        // nes vault's release (a different, un-scanned vault this pass).
        let files = vec![rom_in(
            "New (USA).sfc",
            "snes",
            "snes-vault",
            parse_filename("New (USA)"),
        )];
        let catalog = apply_scan(&existing, &files, &["snes-vault".to_string()]);

        assert!(catalog.releases.iter().all(|r| r.id != "old-snes"));
        assert!(catalog.releases.iter().any(|r| r.id == "keep-nes"));
        assert!(catalog.releases.iter().any(|r| r.title == "New"));
    }

    #[test]
    fn rescan_preserves_curated_game_metadata() {
        let existing = Catalog::from_json(
            r#"{
                "games": [{"id": "super-mario-world", "developer": "Nintendo EAD",
                           "primaryReleaseId": "gone", "relations": ["sequel"]}]
            }"#,
        )
        .expect("valid catalog");

        let files = vec![rom_in(
            "Super Mario World (USA).sfc",
            "snes",
            "snes-vault",
            parse_filename("Super Mario World (USA)"),
        )];
        let catalog = apply_scan(&existing, &files, &["snes-vault".to_string()]);

        let game = catalog
            .games
            .iter()
            .find(|g| g.id == "super-mario-world")
            .expect("game present");
        assert_eq!(game.developer.as_deref(), Some("Nintendo EAD"));
        assert_eq!(game.relations, vec!["sequel".to_string()]);
        // Primary was recomputed to point at a real, current release.
        assert!(catalog
            .releases
            .iter()
            .any(|r| r.id == game.primary_release_id));
    }

    // --- Directory walk (IO) ------------------------------------------------

    fn temp_dir(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("pixelcache-scan-{}-{}", label, std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp vault");
        dir
    }

    #[test]
    fn walk_vault_finds_matching_roms_and_ignores_the_rest() {
        let dir = temp_dir("walk");
        // A matching snes ROM, plus files the snes Vault must ignore: a non-ROM
        // and a ROM for a different platform's extension.
        std::fs::write(dir.join("Super Mario World (USA).sfc"), b"rom").unwrap();
        std::fs::write(dir.join("readme.txt"), b"not a rom").unwrap();
        std::fs::write(dir.join("Star Fox 64 (USA).z64"), b"wrong platform").unwrap();
        let sub = dir.join("hacks");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("Mario Hack (USA) [h1].smc"), b"rom").unwrap();

        let vault = vault("snes-vault", "snes", dir.to_str().unwrap(), None);
        let mut roms = walk_vault(&vault).expect("walk succeeds");
        std::fs::remove_dir_all(&dir).ok();

        roms.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        assert_eq!(roms.len(), 2, "only .sfc/.smc match the snes vault");
        assert!(roms.iter().all(|r| r.platform == "snes"));
        assert!(roms.iter().all(|r| r.vault_id == "snes-vault"));
        // Nested paths are recorded portably with '/'.
        assert!(roms
            .iter()
            .any(|r| r.relative_path == "hacks/Mario Hack (USA) [h1].smc"));
    }

    #[test]
    fn walk_vault_scans_disc_images_by_declared_platform() {
        let dir = temp_dir("disc");
        // An .iso — ambiguous by extension, but unambiguous here because the
        // Vault declares the platform. The old scanner rejected these outright.
        std::fs::write(dir.join("Final Fantasy VII (USA).chd"), b"disc").unwrap();
        std::fs::write(dir.join("Metal Gear Solid (USA).iso"), b"disc").unwrap();

        let vault = vault("ps1-vault", "ps1", dir.to_str().unwrap(), None);
        let roms = walk_vault(&vault).expect("walk succeeds");
        std::fs::remove_dir_all(&dir).ok();

        assert_eq!(roms.len(), 2);
        assert!(roms.iter().all(|r| r.platform == "ps1"));
    }

    #[test]
    fn walk_vault_rejects_a_non_directory() {
        let vault = vault(
            "v",
            "snes",
            "definitely-not-a-real-pixelcache-vault-dir",
            None,
        );
        let err = walk_vault(&vault).expect_err("missing dir errors");
        assert!(matches!(err, ScanError::NotADirectory { .. }));
    }

    #[test]
    fn no_vaults_error_names_the_env_vars() {
        let message = ScanError::NoVaults.to_string();
        assert!(message.contains(VAULT_DIR_ENV), "message was: {message}");
        assert!(
            message.contains(VAULT_PLATFORM_ENV),
            "message was: {message}"
        );
    }

    #[test]
    fn resolve_vaults_prefers_argument_then_catalog() {
        let arg = vec![vault("a", "snes", "/a", None)];
        let existing = Catalog {
            vaults: vec![vault("b", "nes", "/b", None)],
            ..Catalog::default()
        };
        // Argument wins when present.
        assert_eq!(
            resolve_vaults(Some(arg.clone()), &existing).unwrap()[0].id,
            "a"
        );
        // Falls back to the catalog's configured vaults.
        assert_eq!(resolve_vaults(None, &existing).unwrap()[0].id, "b");
        // Empty everywhere (and no env) is an error.
        assert!(matches!(
            resolve_vaults(Some(vec![]), &Catalog::default()),
            Err(ScanError::NoVaults)
        ));
    }

    #[test]
    fn upsert_vaults_replaces_by_id_and_appends_new() {
        let mut vaults = vec![vault("a", "snes", "/old", None)];
        upsert_vaults(
            &mut vaults,
            &[
                vault("a", "snes", "/new", None),
                vault("b", "nes", "/b", None),
            ],
        );
        assert_eq!(vaults.len(), 2);
        assert_eq!(vaults.iter().find(|v| v.id == "a").unwrap().path, "/new");
        assert!(vaults.iter().any(|v| v.id == "b"));
    }

    #[test]
    fn scan_vaults_to_files_end_to_end() {
        let dir = temp_dir("e2e");
        std::fs::write(dir.join("Super Mario World (USA).sfc"), b"rom").unwrap();
        std::fs::write(dir.join("Super Mario World (Europe).sfc"), b"rom").unwrap();

        let vault = vault("snes-vault", "snes", dir.to_str().unwrap(), None);
        let files = scan_vaults_to_files(&[vault]);
        std::fs::remove_dir_all(&dir).ok();

        let files = files.expect("scan succeeds");
        assert_eq!(files.len(), 2);
        assert!(files.iter().all(|f| f.vault_id == "snes-vault"));

        // Both regional dumps collapse under one Game once reconciled.
        let catalog = build_catalog(&files);
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
