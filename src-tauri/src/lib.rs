mod catalog;
mod launch;
mod media;
mod playhistory;
mod scanner;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Serve Release/Game artwork from the Vault (falling back to bundled
        // resources) over a custom asset protocol — see `media::respond`.
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
            scanner::scan_vault
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
