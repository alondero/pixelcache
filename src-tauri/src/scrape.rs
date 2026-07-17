//! Automatic artwork scraping from the libretro-thumbnails library.
//!
//! Established launchers (LaunchBox, EmulationStation, Skraper) populate box
//! art automatically; Pixelcache's Media screen previously required typing
//! Vault-relative paths by hand. This module closes that gap against
//! `thumbnails.libretro.com` — the keyless CDN RetroArch itself uses — whose
//! files are organised by No-Intro naming, the same convention
//! [`crate::scanner::parse_filename`] already understands. A Release's ROM
//! file stem is therefore the primary lookup key, with the parsed
//! `Title (Region)` and bare title as fallbacks.
//!
//! Following the crate's layering convention, decisions are split from IO:
//!
//! 1. **Decision (pure):** [`libretro_system`] maps a Pixelcache platform id to
//!    the thumbnail repository's system directory, [`thumbnail_name`] applies
//!    the repository's filename sanitisation, [`thumbnail_url`] frames the
//!    request, [`name_candidates`] orders the lookup keys, [`missing_kinds`]
//!    decides what a Release still needs, and [`apply_artwork`] patches the
//!    catalog (filling empty slots only, so curation is never clobbered).
//! 2. **IO:** [`ArtFetcher`] abstracts the HTTP GET (a fake in tests,
//!    [`HttpFetcher`] via `ureq` in production), and [`scrape_release`] writes
//!    the downloaded PNGs into the Release's Vault under
//!    `media/<release-id>/<slot>.png` — the same Vault-relative space the
//!    `pixelcache-media://` protocol serves from.
//!
//! The frontend drives one [`scrape_release_artwork`] command per Release (the
//! `save_media` idiom: each call persists atomically and returns the updated
//! [`Catalog`]), so artwork pops into the grid incrementally and cancelling is
//! just stopping the loop.

use crate::catalog::{Catalog, Media};
use serde::Serialize;
use std::fmt;
use std::path::PathBuf;

/// The libretro thumbnail server every request is built against.
pub const THUMBNAIL_HOST: &str = "https://thumbnails.libretro.com";

/// The artwork kinds the scraper fetches, in fetch order. Each maps to one
/// directory of the thumbnail repository and one [`Media`] slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThumbKind {
    /// `Named_Boxarts` → the `boxart` slot (and `image` when it was empty, so
    /// the grid's cover fallback shows the box).
    Boxart,
    /// `Named_Snaps` (an in-game screenshot) → the `screenshot` slot.
    Snap,
}

impl ThumbKind {
    /// The thumbnail repository directory for this kind.
    pub fn repo_dir(self) -> &'static str {
        match self {
            ThumbKind::Boxart => "Named_Boxarts",
            ThumbKind::Snap => "Named_Snaps",
        }
    }

    /// The [`Media`] slot this kind fills, which doubles as the on-disk file
    /// stem under `media/<release-id>/`.
    pub fn slot(self) -> &'static str {
        match self {
            ThumbKind::Boxart => "boxart",
            ThumbKind::Snap => "screenshot",
        }
    }
}

/// Map a Pixelcache platform id (the vocabulary of
/// [`crate::scanner::default_extensions_for_platform`]) to the thumbnail
/// repository's system directory name, or `None` for a platform the library
/// does not cover.
pub fn libretro_system(platform: &str) -> Option<&'static str> {
    match platform {
        "snes" => Some("Nintendo - Super Nintendo Entertainment System"),
        "nes" => Some("Nintendo - Nintendo Entertainment System"),
        "n64" => Some("Nintendo - Nintendo 64"),
        "gb" => Some("Nintendo - Game Boy"),
        "gbc" => Some("Nintendo - Game Boy Color"),
        "gba" => Some("Nintendo - Game Boy Advance"),
        "genesis" => Some("Sega - Mega Drive - Genesis"),
        "sms" => Some("Sega - Master System - Mark III"),
        "gamegear" => Some("Sega - Game Gear"),
        "pcengine" => Some("NEC - PC Engine - TurboGrafx 16"),
        "pcenginecd" => Some("NEC - PC Engine CD - TurboGrafx-CD"),
        "atari2600" => Some("Atari - 2600"),
        "wonderswan" => Some("Bandai - WonderSwan"),
        "neogeopocket" => Some("SNK - Neo Geo Pocket"),
        "ps1" => Some("Sony - PlayStation"),
        "ps2" => Some("Sony - PlayStation 2"),
        "psp" => Some("Sony - PlayStation Portable"),
        "gamecube" => Some("Nintendo - GameCube"),
        "wii" => Some("Nintendo - Wii"),
        "dreamcast" => Some("Sega - Dreamcast"),
        "saturn" => Some("Sega - Saturn"),
        "segacd" => Some("Sega - Mega-CD - Sega CD"),
        "3do" => Some("The 3DO Company - 3DO"),
        _ => None,
    }
}

/// Apply the thumbnail repository's filename rule: the characters
/// ``&*/:`<>?\|"`` are stored as `_` in every thumbnail filename.
pub fn thumbnail_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '&' | '*' | '/' | ':' | '`' | '<' | '>' | '?' | '\\' | '|' | '"' => '_',
            other => other,
        })
        .collect()
}

/// Percent-encode one URL path segment, leaving RFC 3986 unreserved characters
/// (and parentheses, which the repository uses heavily and never encodes) as-is.
fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'(' | b')' => {
                out.push(byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// The full URL of one thumbnail: host / system / kind directory / `name`.png,
/// with the repository's filename sanitisation and percent-encoding applied.
pub fn thumbnail_url(system: &str, kind: ThumbKind, name: &str) -> String {
    format!(
        "{THUMBNAIL_HOST}/{}/{}/{}.png",
        encode_segment(system),
        kind.repo_dir(),
        encode_segment(&thumbnail_name(name)),
    )
}

/// The ordered lookup keys for a Release, most reliable first: the ROM file
/// stem (a scanned Vault file is usually already No-Intro named), then
/// `Title (Region)`, then the bare title. De-duplicated so a manual Release
/// whose stem *is* its title doesn't fetch the same URL twice.
pub fn name_candidates(file_path: &str, title: &str, region: Option<&str>) -> Vec<String> {
    let stem = file_path
        .rsplit(['/', '\\'])
        .next()
        .map(|file| match file.rsplit_once('.') {
            Some((stem, _ext)) if !stem.is_empty() => stem,
            _ => file,
        })
        .unwrap_or(file_path);

    let mut candidates = Vec::new();
    for candidate in [
        stem.to_string(),
        match region {
            Some(region) => format!("{title} ({region})"),
            None => String::new(),
        },
        title.to_string(),
    ] {
        if !candidate.trim().is_empty() && !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

/// The artwork kinds a Release still needs: a kind is missing when its slot
/// resolves to nothing through the Release → Game fallback
/// ([`crate::media::resolved_slot`]), so Game-level curation suppresses a
/// redundant fetch.
pub fn missing_kinds(catalog: &Catalog, release_id: &str) -> Vec<ThumbKind> {
    [ThumbKind::Boxart, ThumbKind::Snap]
        .into_iter()
        .filter(|kind| crate::media::resolved_slot(catalog, release_id, kind.slot()).is_none())
        .collect()
}

/// Record fetched artwork on a Release: each `(kind, vault-relative path)`
/// fills that kind's slot, and a fetched box art additionally fills the `image`
/// cover slot when it resolves to nothing — never overwriting an existing
/// value, so curated media always survives a scrape.
pub fn apply_artwork(
    mut catalog: Catalog,
    release_id: &str,
    found: &[(ThumbKind, String)],
) -> Catalog {
    let image_empty = crate::media::resolved_slot(&catalog, release_id, "image").is_none();
    let Some(release) = catalog.releases.iter_mut().find(|r| r.id == release_id) else {
        return catalog;
    };
    let media = release.media.get_or_insert_with(Media::default);
    for (kind, path) in found {
        let slot = match kind {
            ThumbKind::Boxart => &mut media.boxart,
            ThumbKind::Snap => &mut media.screenshot,
        };
        if slot.is_none() {
            *slot = Some(path.clone());
        }
        if matches!(kind, ThumbKind::Boxart) && image_empty && media.image.is_none() {
            media.image = Some(path.clone());
        }
    }
    catalog
}

/// How a single-Release scrape concluded, serialised camelCase for the
/// frontend's progress tally.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScrapeStatus {
    /// At least one thumbnail was downloaded and recorded.
    Found,
    /// The library has no thumbnail under any candidate name.
    Missing,
    /// Every slot the scraper fills was already set — nothing to do.
    Skipped,
    /// The Release has no Vault to store artwork into (added manually).
    NoVault,
    /// The thumbnail library does not cover this Release's platform.
    Unsupported,
}

/// What one [`scrape_release_artwork`] call returns to the frontend: the
/// conclusion, the slots that were filled, and the updated catalog (the
/// `save_media` idiom, so the whole app refreshes incrementally).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapeOutcome {
    pub status: ScrapeStatus,
    pub slots: Vec<String>,
    pub catalog: Catalog,
}

/// Errors from the scrape pipeline that are bugs or environment failures (an
/// unknown Release id, an unwritable Vault) — distinct from the *expected*
/// conclusions modelled by [`ScrapeStatus`].
#[derive(Debug)]
pub enum ScrapeError {
    UnknownRelease(String),
    Write {
        path: String,
        source: std::io::Error,
    },
    Fetch {
        url: String,
        message: String,
    },
}

impl fmt::Display for ScrapeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ScrapeError::UnknownRelease(id) => write!(f, "unknown release '{id}'"),
            ScrapeError::Write { path, source } => {
                write!(f, "failed to write artwork '{path}': {source}")
            }
            ScrapeError::Fetch { url, message } => {
                write!(f, "failed to fetch '{url}': {message}")
            }
        }
    }
}

/// The one HTTP operation the scraper needs, abstracted so tests never touch
/// the network: `Ok(Some(bytes))` for a hit, `Ok(None)` for a 404 (a normal
/// miss — try the next candidate), `Err` for transport failures.
pub trait ArtFetcher {
    fn fetch(&self, url: &str) -> Result<Option<Vec<u8>>, String>;
}

/// The production [`ArtFetcher`]: a blocking `ureq` GET with a request timeout,
/// treating HTTP 404 as a miss and any other error as a failure.
pub struct HttpFetcher;

impl ArtFetcher for HttpFetcher {
    fn fetch(&self, url: &str) -> Result<Option<Vec<u8>>, String> {
        match ureq::get(url)
            .timeout(std::time::Duration::from_secs(20))
            .call()
        {
            Ok(response) => {
                let mut bytes = Vec::new();
                use std::io::Read;
                response
                    .into_reader()
                    // Box art PNGs are well under this; the cap bounds memory
                    // if the CDN ever misbehaves.
                    .take(20 * 1024 * 1024)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                Ok(Some(bytes))
            }
            Err(ureq::Error::Status(404, _)) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Scrape one Release: decide what it needs, try each name candidate against
/// the thumbnail library, write hits into its Vault at
/// `media/<release-id>/<slot>.png`, and return the conclusion plus the
/// `(kind, vault-relative path)` pairs for [`apply_artwork`].
///
/// This is the module's IO orchestrator, parameterised by [`ArtFetcher`] so
/// tests drive it with a fake and a temp-dir Vault.
pub fn scrape_release(
    catalog: &Catalog,
    release_id: &str,
    fetcher: &dyn ArtFetcher,
) -> Result<(ScrapeStatus, Vec<(ThumbKind, String)>), ScrapeError> {
    let release = catalog
        .releases
        .iter()
        .find(|r| r.id == release_id)
        .ok_or_else(|| ScrapeError::UnknownRelease(release_id.to_string()))?;

    let kinds = missing_kinds(catalog, release_id);
    if kinds.is_empty() {
        return Ok((ScrapeStatus::Skipped, Vec::new()));
    }
    let Some(system) = libretro_system(&release.platform) else {
        return Ok((ScrapeStatus::Unsupported, Vec::new()));
    };
    let vault_path = release
        .vault_id
        .as_deref()
        .and_then(|id| catalog.vaults.iter().find(|v| v.id == id))
        .map(|v| v.path.clone());
    let Some(vault_path) = vault_path else {
        return Ok((ScrapeStatus::NoVault, Vec::new()));
    };

    let candidates = name_candidates(
        &release.file_path,
        &release.title,
        release.region.as_deref(),
    );
    let mut found = Vec::new();
    for kind in kinds {
        for candidate in &candidates {
            let url = thumbnail_url(system, kind, candidate);
            match fetcher.fetch(&url) {
                Ok(Some(bytes)) => {
                    let rel_path = format!("media/{}/{}.png", release.id, kind.slot());
                    write_artwork(&vault_path, &rel_path, &bytes)?;
                    found.push((kind, rel_path));
                    break;
                }
                Ok(None) => continue,
                Err(message) => return Err(ScrapeError::Fetch { url, message }),
            }
        }
    }

    let status = if found.is_empty() {
        ScrapeStatus::Missing
    } else {
        ScrapeStatus::Found
    };
    Ok((status, found))
}

/// Write one downloaded thumbnail under the Vault root (IO).
fn write_artwork(vault_path: &str, rel_path: &str, bytes: &[u8]) -> Result<(), ScrapeError> {
    let full: PathBuf = std::path::Path::new(vault_path).join(rel_path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|source| ScrapeError::Write {
            path: parent.display().to_string(),
            source,
        })?;
    }
    std::fs::write(&full, bytes).map_err(|source| ScrapeError::Write {
        path: full.display().to_string(),
        source,
    })
}

/// Tauri command backing the Media screen's "Fetch artwork" journey: scrape
/// one Release from the libretro thumbnail library, persist the updated
/// catalog atomically, and return the outcome (with the fresh catalog) so the
/// UI ticks its progress and the grid fills in live. The frontend calls this
/// once per Release, sequentially — see `src/scrape.ts`.
#[tauri::command]
pub async fn scrape_release_artwork(
    app: tauri::AppHandle,
    release_id: String,
) -> Result<ScrapeOutcome, String> {
    let catalog = crate::catalog::load_bundled_catalog(&app)?;
    let (status, found) =
        scrape_release(&catalog, &release_id, &HttpFetcher).map_err(|e| e.to_string())?;
    let slots: Vec<String> = found
        .iter()
        .map(|(kind, _)| kind.slot().to_string())
        .collect();
    let catalog = if found.is_empty() {
        catalog
    } else {
        let updated = apply_artwork(catalog, &release_id, &found);
        crate::catalog::persist_catalog(&app, &updated)?;
        updated
    };
    Ok(ScrapeOutcome {
        status,
        slots,
        catalog,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// A canned fetcher: answers from a URL → bytes map, records every request.
    struct FakeFetcher {
        hits: Vec<(String, Vec<u8>)>,
        requests: RefCell<Vec<String>>,
        error_on: Option<String>,
    }

    impl FakeFetcher {
        fn with_hits(hits: Vec<(String, Vec<u8>)>) -> Self {
            FakeFetcher {
                hits,
                requests: RefCell::new(Vec::new()),
                error_on: None,
            }
        }
    }

    impl ArtFetcher for FakeFetcher {
        fn fetch(&self, url: &str) -> Result<Option<Vec<u8>>, String> {
            self.requests.borrow_mut().push(url.to_string());
            if self.error_on.as_deref() == Some(url) {
                return Err("connection reset".to_string());
            }
            Ok(self
                .hits
                .iter()
                .find(|(hit, _)| hit == url)
                .map(|(_, bytes)| bytes.clone()))
        }
    }

    fn temp_vault(tag: &str) -> String {
        let dir =
            std::env::temp_dir().join(format!("pixelcache-scrape-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp vault dir");
        dir.to_string_lossy().into_owned()
    }

    fn catalog_with_vault(vault_path: &str) -> Catalog {
        Catalog::from_json(&format!(
            r#"{{
                "games": [
                    {{"id": "star-fox-64", "primaryReleaseId": "sf64-usa", "relations": []}}
                ],
                "releases": [
                    {{"id": "sf64-usa", "gameId": "star-fox-64",
                      "title": "Star Fox 64", "region": "USA", "platform": "n64",
                      "releaseType": "retail", "vaultId": "n64-vault",
                      "filePath": "Star Fox 64 (USA).z64"}}
                ],
                "vaults": [
                    {{"id": "n64-vault", "platform": "n64", "path": {}}}
                ]
            }}"#,
            serde_json::to_string(vault_path).unwrap()
        ))
        .expect("valid catalog json")
    }

    #[test]
    fn libretro_system_maps_known_platforms_and_rejects_unknown() {
        assert_eq!(
            libretro_system("snes"),
            Some("Nintendo - Super Nintendo Entertainment System")
        );
        assert_eq!(
            libretro_system("genesis"),
            Some("Sega - Mega Drive - Genesis")
        );
        assert_eq!(libretro_system("steam"), None);
    }

    #[test]
    fn every_scanner_platform_with_default_extensions_maps_to_a_system() {
        // The scanner's platform vocabulary and the scraper's must not drift:
        // any platform a Vault can scan by default should also be scrapable.
        for platform in [
            "snes",
            "nes",
            "n64",
            "gb",
            "gbc",
            "gba",
            "genesis",
            "sms",
            "gamegear",
            "pcengine",
            "pcenginecd",
            "atari2600",
            "wonderswan",
            "neogeopocket",
            "ps1",
            "ps2",
            "psp",
            "gamecube",
            "wii",
            "dreamcast",
            "saturn",
            "segacd",
            "3do",
        ] {
            assert!(
                !crate::scanner::default_extensions_for_platform(platform).is_empty(),
                "scanner dropped platform {platform}"
            );
            assert!(
                libretro_system(platform).is_some(),
                "no libretro system for {platform}"
            );
        }
    }

    #[test]
    fn thumbnail_name_replaces_forbidden_characters_with_underscores() {
        assert_eq!(
            thumbnail_name("Ratchet & Clank: Up Your Arsenal"),
            "Ratchet _ Clank_ Up Your Arsenal"
        );
        assert_eq!(thumbnail_name("Plain Title (USA)"), "Plain Title (USA)");
    }

    #[test]
    fn thumbnail_url_encodes_spaces_but_keeps_parentheses() {
        assert_eq!(
            thumbnail_url(
                "Nintendo - Nintendo 64",
                ThumbKind::Boxart,
                "Star Fox 64 (USA)"
            ),
            "https://thumbnails.libretro.com/Nintendo%20-%20Nintendo%2064/Named_Boxarts/Star%20Fox%2064%20(USA).png"
        );
    }

    #[test]
    fn thumbnail_url_sanitises_before_encoding() {
        let url = thumbnail_url("Sony - PlayStation", ThumbKind::Snap, "Ape Escape?");
        assert!(url.ends_with("/Named_Snaps/Ape%20Escape_.png"), "{url}");
    }

    #[test]
    fn name_candidates_order_stem_then_title_region_then_title() {
        assert_eq!(
            name_candidates(
                "roms/Star Fox 64 (USA) (Rev 1).z64",
                "Star Fox 64",
                Some("USA")
            ),
            vec![
                "Star Fox 64 (USA) (Rev 1)".to_string(),
                "Star Fox 64 (USA)".to_string(),
                "Star Fox 64".to_string(),
            ]
        );
    }

    #[test]
    fn name_candidates_dedupe_and_handle_missing_region() {
        assert_eq!(
            name_candidates("Chrono Trigger.sfc", "Chrono Trigger", None),
            vec!["Chrono Trigger".to_string()]
        );
    }

    #[test]
    fn missing_kinds_respects_release_and_game_level_media() {
        let vault = temp_vault("missing-kinds");
        let mut catalog = catalog_with_vault(&vault);
        assert_eq!(
            missing_kinds(&catalog, "sf64-usa"),
            vec![ThumbKind::Boxart, ThumbKind::Snap]
        );

        // Game-level box art suppresses the boxart fetch for its Releases.
        catalog.games[0].media = Some(Media {
            boxart: Some("shared/box.png".to_string()),
            ..Media::default()
        });
        assert_eq!(missing_kinds(&catalog, "sf64-usa"), vec![ThumbKind::Snap]);
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn apply_artwork_fills_slots_and_cover_without_clobbering() {
        let vault = temp_vault("apply");
        let catalog = catalog_with_vault(&vault);
        let updated = apply_artwork(
            catalog,
            "sf64-usa",
            &[
                (ThumbKind::Boxart, "media/sf64-usa/boxart.png".to_string()),
                (ThumbKind::Snap, "media/sf64-usa/screenshot.png".to_string()),
            ],
        );
        let media = updated.releases[0].media.as_ref().expect("media set");
        assert_eq!(media.boxart.as_deref(), Some("media/sf64-usa/boxart.png"));
        assert_eq!(
            media.screenshot.as_deref(),
            Some("media/sf64-usa/screenshot.png")
        );
        // The empty cover slot inherits the box art so the grid shows it.
        assert_eq!(media.image.as_deref(), Some("media/sf64-usa/boxart.png"));

        // A second application never overwrites what is already set.
        let clobbered = apply_artwork(
            updated,
            "sf64-usa",
            &[(ThumbKind::Boxart, "media/sf64-usa/other.png".to_string())],
        );
        let media = clobbered.releases[0].media.as_ref().expect("media kept");
        assert_eq!(media.boxart.as_deref(), Some("media/sf64-usa/boxart.png"));
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn apply_artwork_leaves_curated_cover_alone() {
        let vault = temp_vault("apply-cover");
        let mut catalog = catalog_with_vault(&vault);
        catalog.releases[0].media = Some(Media {
            image: Some("curated/cover.webp".to_string()),
            ..Media::default()
        });
        let updated = apply_artwork(
            catalog,
            "sf64-usa",
            &[(ThumbKind::Boxart, "media/sf64-usa/boxart.png".to_string())],
        );
        let media = updated.releases[0].media.as_ref().expect("media set");
        assert_eq!(media.image.as_deref(), Some("curated/cover.webp"));
        assert_eq!(media.boxart.as_deref(), Some("media/sf64-usa/boxart.png"));
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn scrape_release_downloads_both_kinds_by_file_stem() {
        let vault = temp_vault("hit");
        let catalog = catalog_with_vault(&vault);
        let boxart_url = thumbnail_url(
            "Nintendo - Nintendo 64",
            ThumbKind::Boxart,
            "Star Fox 64 (USA)",
        );
        let snap_url = thumbnail_url(
            "Nintendo - Nintendo 64",
            ThumbKind::Snap,
            "Star Fox 64 (USA)",
        );
        let fetcher = FakeFetcher::with_hits(vec![
            (boxart_url, b"box-bytes".to_vec()),
            (snap_url, b"snap-bytes".to_vec()),
        ]);

        let (status, found) = scrape_release(&catalog, "sf64-usa", &fetcher).expect("scrape ok");
        assert_eq!(status, ScrapeStatus::Found);
        assert_eq!(
            found,
            vec![
                (ThumbKind::Boxart, "media/sf64-usa/boxart.png".to_string()),
                (ThumbKind::Snap, "media/sf64-usa/screenshot.png".to_string()),
            ]
        );
        let on_disk = std::fs::read(std::path::Path::new(&vault).join("media/sf64-usa/boxart.png"))
            .expect("boxart written");
        assert_eq!(on_disk, b"box-bytes");
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn scrape_release_falls_back_through_candidates_on_404() {
        let vault = temp_vault("fallback");
        let catalog = catalog_with_vault(&vault);
        // Only the bare-title boxart exists; the stem and title+region 404.
        let title_url = thumbnail_url("Nintendo - Nintendo 64", ThumbKind::Boxart, "Star Fox 64");
        let fetcher = FakeFetcher::with_hits(vec![(title_url.clone(), b"box".to_vec())]);

        let (status, found) = scrape_release(&catalog, "sf64-usa", &fetcher).expect("scrape ok");
        assert_eq!(status, ScrapeStatus::Found);
        assert_eq!(found.len(), 1);
        // Candidate order preserved: the stem and "Title (Region)" dedupe to
        // one candidate here, so the bare-title hit is the second request.
        let requests = fetcher.requests.borrow();
        assert_eq!(requests[1], title_url);
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn scrape_release_reports_missing_when_nothing_matches() {
        let vault = temp_vault("miss");
        let catalog = catalog_with_vault(&vault);
        let fetcher = FakeFetcher::with_hits(Vec::new());
        let (status, found) = scrape_release(&catalog, "sf64-usa", &fetcher).expect("scrape ok");
        assert_eq!(status, ScrapeStatus::Missing);
        assert!(found.is_empty());
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn scrape_release_skips_when_slots_are_already_curated() {
        let vault = temp_vault("skip");
        let mut catalog = catalog_with_vault(&vault);
        catalog.releases[0].media = Some(Media {
            boxart: Some("curated/box.png".to_string()),
            screenshot: Some("curated/shot.png".to_string()),
            ..Media::default()
        });
        let fetcher = FakeFetcher::with_hits(Vec::new());
        let (status, _) = scrape_release(&catalog, "sf64-usa", &fetcher).expect("scrape ok");
        assert_eq!(status, ScrapeStatus::Skipped);
        assert!(
            fetcher.requests.borrow().is_empty(),
            "no network for a skip"
        );
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn scrape_release_flags_manual_releases_and_unsupported_platforms() {
        let vault = temp_vault("edge");
        let mut catalog = catalog_with_vault(&vault);
        catalog.releases[0].vault_id = None;
        let fetcher = FakeFetcher::with_hits(Vec::new());
        let (status, _) = scrape_release(&catalog, "sf64-usa", &fetcher).expect("scrape ok");
        assert_eq!(status, ScrapeStatus::NoVault);

        let mut catalog = catalog_with_vault(&vault);
        catalog.releases[0].platform = "steam".to_string();
        let (status, _) = scrape_release(&catalog, "sf64-usa", &fetcher).expect("scrape ok");
        assert_eq!(status, ScrapeStatus::Unsupported);
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn scrape_release_surfaces_transport_errors() {
        let vault = temp_vault("err");
        let catalog = catalog_with_vault(&vault);
        let first_url = thumbnail_url(
            "Nintendo - Nintendo 64",
            ThumbKind::Boxart,
            "Star Fox 64 (USA)",
        );
        let fetcher = FakeFetcher {
            hits: Vec::new(),
            requests: RefCell::new(Vec::new()),
            error_on: Some(first_url),
        };
        let err = scrape_release(&catalog, "sf64-usa", &fetcher).expect_err("transport error");
        assert!(matches!(err, ScrapeError::Fetch { .. }));
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn scrape_release_rejects_unknown_release() {
        let vault = temp_vault("unknown");
        let catalog = catalog_with_vault(&vault);
        let fetcher = FakeFetcher::with_hits(Vec::new());
        let err = scrape_release(&catalog, "ghost", &fetcher).expect_err("unknown release");
        assert!(matches!(err, ScrapeError::UnknownRelease(_)));
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn scrape_status_serialises_camel_case() {
        assert_eq!(
            serde_json::to_string(&ScrapeStatus::NoVault).unwrap(),
            "\"noVault\""
        );
        assert_eq!(
            serde_json::to_string(&ScrapeStatus::Found).unwrap(),
            "\"found\""
        );
    }
}
