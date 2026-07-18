//! Media serving.
//!
//! Phase 3 replaces the pre-Phase-3 scheme — media served from the frontend's
//! `media/` root — with a `pixelcache-media://` asset protocol that streams
//! artwork from the **Vault**, matching how [`crate::launch`] resolves a ROM
//! path. A frontend `<img>`/`<video>` requests
//! `pixelcache-media://localhost/<release-id>/<slot>`; the registered protocol
//! handler ([`respond`]) resolves that Release + slot to a file on disk and
//! returns its bytes.
//!
//! Following the layering used across the crate, the decision-making is split
//! from the IO so it is unit-testable without a Tauri runtime:
//!
//! 1. **Decision (pure):** [`resolved_slot`] applies the game-level fallback,
//!    [`media_candidates`] lists the ordered on-disk locations to try, and
//!    [`mime_for`] / [`parse_request_path`] handle the request framing.
//! 2. **IO:** [`first_existing`] and [`respond`] — the only functions that read
//!    the filesystem or touch the [`tauri::AppHandle`].
//!
//! A slot unset on a Release inherits the same slot from its [`crate::catalog::Game`]
//! (the fallback established launchers use so shared box art / a logo can be set
//! once), exactly mirroring the frontend `resolveMedia` in `src/media.ts`.

use crate::catalog::Catalog;
use std::path::{Path, PathBuf};

/// The URI scheme the media protocol is registered under. A frontend media URL
/// is `pixelcache-media://localhost/<release-id>/<slot>` (see the frontend
/// `mediaSrc` in `src/media.ts`).
pub const MEDIA_SCHEME: &str = "pixelcache-media";

/// Environment variable naming a media root that overrides every other location
/// (a dev convenience mirroring [`crate::launch::VAULT_DIR_ENV`]). When set, a
/// media path resolves against it first.
pub const MEDIA_DIR_ENV: &str = "PIXELCACHE_MEDIA_DIR";

/// Resolve a Release's media `slot` to a stored path, applying the game-level
/// fallback: the Release's own [`crate::catalog::Media`] wins, otherwise the same
/// slot on its [`crate::catalog::Game`]. Returns `None` when the Release is
/// unknown or neither level sets the slot. Pure — the single source of truth for
/// the fallback rule on the backend, mirroring the frontend `resolveMedia`.
pub fn resolved_slot(catalog: &Catalog, release_id: &str, slot: &str) -> Option<String> {
    let release = catalog.releases.iter().find(|r| r.id == release_id)?;
    if let Some(path) = release.media.as_ref().and_then(|m| m.slot(slot)) {
        return Some(path.to_string());
    }
    catalog
        .games
        .iter()
        .find(|g| g.id == release.game_id)
        .and_then(|g| g.media.as_ref())
        .and_then(|m| m.slot(slot))
        .map(str::to_string)
}

/// The ordered filesystem locations to try for a media `rel_path`, most specific
/// first: the [`MEDIA_DIR_ENV`] override, then the owning Vault's companion
/// media root ([`crate::catalog::Vault::media_path`]), then the Vault root
/// itself (where the artwork scraper writes). Blank roots are skipped. Pure —
/// [`first_existing`] picks the first that is actually a file.
pub fn media_candidates(
    media_env: Option<&str>,
    vault_media_path: Option<&str>,
    vault_path: Option<&str>,
    rel_path: &str,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for root in [media_env, vault_media_path, vault_path]
        .into_iter()
        .flatten()
    {
        if !root.trim().is_empty() {
            candidates.push(Path::new(root.trim()).join(rel_path));
        }
    }
    candidates
}

/// The first candidate that exists as a file (IO), or `None` when none do.
pub fn first_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.is_file()).cloned()
}

/// A best-effort MIME type for a media file from its extension, defaulting to
/// `application/octet-stream`. Covers the WebM / WebP preview formats the PRD
/// mandates plus the common still-image formats. Pure.
pub fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("webm") => "video/webm",
        Some("mp4") => "video/mp4",
        Some("webp") => "image/webp",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("avif") => "image/avif",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// Parse a media request URI path (`/<release-id>/<slot>`) into its Release id
/// and slot. Returns `None` for a malformed path (missing part, empty segment,
/// or an unknown slot name), so the handler answers a bad request with a 404
/// instead of touching the filesystem. Pure.
pub fn parse_request_path(path: &str) -> Option<(String, String)> {
    let trimmed = path.trim_start_matches('/');
    let (release_id, slot) = trimmed.split_once('/')?;
    if release_id.is_empty() || !crate::catalog::MEDIA_SLOTS.contains(&slot) {
        return None;
    }
    Some((decode_component(release_id), slot.to_string()))
}

/// Minimal percent-decoding for a single path component. Release ids are URL-safe
/// slugs, so this only needs to reverse the frontend's `encodeURIComponent`
/// (chiefly `%20` → space) without pulling in a dependency.
fn decode_component(component: &str) -> String {
    let bytes = component.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The `pixelcache-media://` protocol handler: resolve the requested Release +
/// slot to a file (media dir first, Vault root last) and return its bytes, or
/// a 404 when the request is malformed or the file is missing. Registered on the
/// Tauri builder in `lib.rs`.
///
/// This is the module's IO boundary; the resolution rules it composes
/// ([`parse_request_path`], [`resolved_slot`], [`media_candidates`],
/// [`mime_for`]) are each pure and unit-tested.
pub fn respond(
    app: &tauri::AppHandle,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<std::borrow::Cow<'static, [u8]>> {
    use std::borrow::Cow;
    use tauri::http::{header::CONTENT_TYPE, StatusCode};

    let not_found = || {
        tauri::http::Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Cow::Borrowed(&b""[..]))
            .expect("static 404 response is valid")
    };

    let Some((release_id, slot)) = parse_request_path(request.uri().path()) else {
        return not_found();
    };

    let Ok(catalog) = crate::catalog::load_current_catalog(app) else {
        return not_found();
    };
    let Some(rel_path) = resolved_slot(&catalog, &release_id, &slot) else {
        return not_found();
    };

    let vault = catalog
        .releases
        .iter()
        .find(|r| r.id == release_id)
        .and_then(|r| r.vault_id.as_deref())
        .and_then(|id| catalog.vaults.iter().find(|v| v.id == id));
    let vault_path = vault.map(|v| v.path.clone());
    let vault_media_path = vault.and_then(|v| v.media_path.clone());
    let media_env = std::env::var(MEDIA_DIR_ENV).ok();

    let candidates = media_candidates(
        media_env.as_deref(),
        vault_media_path.as_deref(),
        vault_path.as_deref(),
        &rel_path,
    );

    let Some(file) = first_existing(&candidates) else {
        return not_found();
    };
    let Ok(bytes) = std::fs::read(&file) else {
        return not_found();
    };

    tauri::http::Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, mime_for(&file))
        .body(Cow::Owned(bytes))
        .unwrap_or_else(|_| not_found())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{Catalog, Media};

    fn catalog() -> Catalog {
        Catalog::from_json(
            r#"{
                "games": [
                    {"id": "star-fox-64", "primaryReleaseId": "sf64-ntsc", "relations": [],
                     "media": {"boxart": "star-fox-64/box.png", "logo": "star-fox-64/logo.png"}}
                ],
                "releases": [
                    {"id": "sf64-ntsc", "gameId": "star-fox-64", "title": "Star Fox 64",
                     "platform": "n64", "releaseType": "retail", "vaultId": "n64-vault",
                     "filePath": "sf64.z64",
                     "media": {"image": "star-fox-64/cover.webp"}}
                ],
                "vaults": [
                    {"id": "n64-vault", "platform": "n64", "path": "/mnt/roms/n64"}
                ]
            }"#,
        )
        .expect("valid catalog json")
    }

    #[test]
    fn resolved_slot_prefers_release_media() {
        assert_eq!(
            resolved_slot(&catalog(), "sf64-ntsc", "image").as_deref(),
            Some("star-fox-64/cover.webp")
        );
    }

    #[test]
    fn resolved_slot_falls_back_to_game_media() {
        // The Release sets no boxart/logo, so both come from its Game.
        assert_eq!(
            resolved_slot(&catalog(), "sf64-ntsc", "boxart").as_deref(),
            Some("star-fox-64/box.png")
        );
        assert_eq!(
            resolved_slot(&catalog(), "sf64-ntsc", "logo").as_deref(),
            Some("star-fox-64/logo.png")
        );
    }

    #[test]
    fn resolved_slot_is_none_for_unset_slot_and_unknown_release() {
        assert_eq!(resolved_slot(&catalog(), "sf64-ntsc", "fanart"), None);
        assert_eq!(resolved_slot(&catalog(), "ghost", "image"), None);
    }

    #[test]
    fn release_media_wins_over_game_media_for_the_same_slot() {
        let catalog = Catalog::from_json(
            r#"{
                "games": [{"id": "g", "primaryReleaseId": "r", "relations": [],
                           "media": {"image": "game/cover.webp"}}],
                "releases": [{"id": "r", "gameId": "g", "title": "T", "platform": "snes",
                              "releaseType": "retail", "filePath": "t.sfc",
                              "media": {"image": "release/cover.webp"}}]
            }"#,
        )
        .expect("valid catalog json");
        assert_eq!(
            resolved_slot(&catalog, "r", "image").as_deref(),
            Some("release/cover.webp")
        );
    }

    #[test]
    fn media_candidates_are_ordered_env_then_media_vault_then_vault() {
        let candidates = media_candidates(
            Some("/env/media"),
            Some("/mnt/art/n64"),
            Some("/mnt/roms/n64"),
            "star-fox-64/cover.webp",
        );
        assert_eq!(
            candidates,
            vec![
                PathBuf::from("/env/media/star-fox-64/cover.webp"),
                PathBuf::from("/mnt/art/n64/star-fox-64/cover.webp"),
                PathBuf::from("/mnt/roms/n64/star-fox-64/cover.webp"),
            ]
        );
    }

    #[test]
    fn media_candidates_skip_absent_and_blank_roots() {
        let candidates = media_candidates(None, None, Some("   "), "cover.webp");
        assert!(candidates.is_empty());
    }

    #[test]
    fn mime_for_covers_preview_and_image_formats() {
        assert_eq!(mime_for(Path::new("a/preview.webm")), "video/webm");
        assert_eq!(mime_for(Path::new("a/cover.WEBP")), "image/webp");
        assert_eq!(mime_for(Path::new("a/box.png")), "image/png");
        assert_eq!(mime_for(Path::new("a/fan.jpg")), "image/jpeg");
        assert_eq!(
            mime_for(Path::new("a/mystery.dat")),
            "application/octet-stream"
        );
        assert_eq!(
            mime_for(Path::new("no-extension")),
            "application/octet-stream"
        );
    }

    #[test]
    fn parse_request_path_splits_release_and_slot() {
        assert_eq!(
            parse_request_path("/sf64-ntsc/image"),
            Some(("sf64-ntsc".to_string(), "image".to_string()))
        );
        // The leading slash is optional (defensive).
        assert_eq!(
            parse_request_path("sf64-ntsc/video"),
            Some(("sf64-ntsc".to_string(), "video".to_string()))
        );
    }

    #[test]
    fn parse_request_path_rejects_malformed_and_unknown_slots() {
        assert_eq!(parse_request_path("/only-release-id"), None);
        assert_eq!(parse_request_path("//image"), None);
        assert_eq!(parse_request_path("/r/not-a-slot"), None);
    }

    #[test]
    fn parse_request_path_decodes_the_release_component() {
        assert_eq!(
            parse_request_path("/my%20game/boxart"),
            Some(("my game".to_string(), "boxart".to_string()))
        );
    }

    #[test]
    fn first_existing_finds_a_real_file_and_skips_missing_ones() {
        let dir = std::env::temp_dir().join(format!("pixelcache-media-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let real = dir.join("cover.webp");
        std::fs::write(&real, b"img").expect("write");

        let picked = first_existing(&[dir.join("missing.png"), real.clone()]);
        std::fs::remove_dir_all(&dir).ok();

        assert_eq!(picked, Some(real));
    }

    #[test]
    fn media_slot_accessor_matches_declared_slots() {
        let media = Media {
            screenshot: Some("shot.png".to_string()),
            ..Media::default()
        };
        assert_eq!(media.slot("screenshot"), Some("shot.png"));
        assert_eq!(media.slot("boxart"), None);
    }
}
