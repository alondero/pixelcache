mod catalog;
mod launch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            launch::launch_test_game,
            launch::launch_release,
            catalog::load_catalog
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
