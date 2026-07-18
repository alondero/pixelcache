mod catalog;
mod launch;
mod media;
mod playhistory;
mod scanner;
mod scrape;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Native folder/file pickers for the onboarding wizard and settings.
        .plugin(tauri_plugin_dialog::init())
        // Single-launch in-flight flag shared by every launch entry point
        // (`launch_test_game`, `launch_release`, `test_launch_deck`) — see
        // `launch::LaunchInFlight` and issue #9.
        .manage(launch::LaunchInFlight::default())
        // Serve Release/Game artwork from the Vault (or its companion media
        // directory) over a custom asset protocol — see `media::respond`.
        .register_uri_scheme_protocol(media::MEDIA_SCHEME, |ctx, request| {
            media::respond(ctx.app_handle(), &request)
        })
        .invoke_handler(tauri::generate_handler![
            launch::launch_test_game,
            launch::launch_release,
            launch::test_launch_deck,
            catalog::load_catalog,
            catalog::save_decks,
            catalog::save_media,
            catalog::set_favorite,
            playhistory::load_play_history,
            scanner::scan_vault,
            scrape::scrape_release_artwork
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
