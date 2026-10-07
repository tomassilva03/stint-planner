// Nightstint for drivers: runs the iRacing helper (helper/, bundled with its own Node)
// in the background with a tray icon. The planner itself stays in the browser.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, Url,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

/// The live site. `?live` connects the planner to the helper without a click.
/// A build can point somewhere else with NIGHTSTINT_URL at compile time,
/// and so can the NIGHTSTINT_URL environment variable when the app starts.
const PLANNER_URL: &str = match option_env!("NIGHTSTINT_URL") {
    Some(url) => url,
    None => "https://stint-planner-three.vercel.app",
};
const PRODUCTION_ORIGIN: &str = "https://stint-planner-three.vercel.app";
/// Passed when Windows starts the app at sign-in: stay in the tray
const HIDDEN_ARG: &str = "--hidden";
const HELPER_SCRIPT: &str = "helper/lib/esm/helper.mjs";

#[derive(Default)]
struct Helper {
    child: Mutex<Option<CommandChild>>,
    /// Bumped on every start, so a helper we replaced doesn't get restarted
    generation: Mutex<u64>,
    demo: Mutex<bool>,
    quitting: Mutex<bool>,
}

fn planner_url() -> Url {
    let raw = std::env::var("NIGHTSTINT_URL").unwrap_or_else(|_| PLANNER_URL.to_string());
    let mut url: Url = raw.parse().unwrap_or_else(|_| PLANNER_URL.parse().expect("valid planner URL"));
    url.query_pairs_mut().append_key_only("live");
    url
}

fn data_dir(app: &AppHandle, name: &str) -> PathBuf {
    let dir = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("Nightstint"))
        .join(name);
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Helper output goes to logs\helper.log, started fresh when it gets big
fn log(app: &AppHandle, line: &str) {
    let file = data_dir(app, "logs").join("helper.log");
    if fs::metadata(&file).map(|m| m.len() > 5_000_000).unwrap_or(false) {
        let _ = fs::remove_file(&file);
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&file) {
        let _ = writeln!(f, "{}", line.trim_end());
    }
}

/// Node doesn't always cope with Windows' \\?\ long-path prefix in a script path
fn plain_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

fn start_helper(app: &AppHandle) {
    let state = app.state::<Helper>();
    let generation = {
        let mut g = state.generation.lock().unwrap();
        *g += 1;
        *g
    };
    let old = state.child.lock().unwrap().take();
    if let Some(child) = old {
        let _ = child.kill();
    }
    let demo = *state.demo.lock().unwrap();

    let script = match app.path().resolve(HELPER_SCRIPT, BaseDirectory::Resource) {
        Ok(p) => p,
        Err(e) => return log(app, &format!("Can't find the helper: {e}")),
    };
    let mut args = vec![
        plain_path(&script),
        "--logs".to_string(),
        plain_path(&data_dir(app, "recordings")),
    ];
    let origin = planner_url().origin().ascii_serialization();
    if origin != PRODUCTION_ORIGIN {
        args.extend(["--origin".to_string(), origin]);
    }
    if demo {
        args.push("--demo".to_string());
    }

    let command = match app.shell().sidecar("nightstint-helper") {
        Ok(c) => c,
        Err(e) => return log(app, &format!("Can't find Node for the helper: {e}")),
    };
    let cwd = script.parent().map(Path::to_path_buf).unwrap_or_default();
    match command.args(args).current_dir(cwd).spawn() {
        Ok((mut rx, child)) => {
            log(app, &format!("--- helper started{}", if demo { " (demo race)" } else { "" }));
            *state.child.lock().unwrap() = Some(child);
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => log(&app, &String::from_utf8_lossy(&b)),
                        CommandEvent::Error(e) => log(&app, &e),
                        CommandEvent::Terminated(t) => {
                            log(&app, &format!("--- helper stopped (code {:?})", t.code));
                            break;
                        }
                        _ => {}
                    }
                }
                // Keep it running: start it again unless we're quitting or already replaced it
                tokio::time::sleep(Duration::from_secs(5)).await;
                let state = app.state::<Helper>();
                let current = *state.generation.lock().unwrap() == generation;
                if current && !*state.quitting.lock().unwrap() {
                    start_helper(&app);
                }
            });
        }
        Err(e) => log(app, &format!("Couldn't start the helper: {e}")),
    }
}

fn stop_helper(app: &AppHandle) {
    let state = app.state::<Helper>();
    *state.quitting.lock().unwrap() = true;
    let old = state.child.lock().unwrap().take();
    if let Some(child) = old {
        let _ = child.kill();
    }
}

/// Installs a newer version from GitHub if there is one: the installer closes the app,
/// updates it and opens it again. Offline or no release yet just gets logged.
async fn update(app: AppHandle) {
    let result = async {
        let Some(update) = app.updater()?.check().await? else {
            return Ok::<_, tauri_plugin_updater::Error>(false);
        };
        let bytes = update.download(|_, _| {}, || {}).await?;
        log(&app, &format!("--- updating to {}", update.version));
        // The installer replaces the helper's files, so it can't be running
        stop_helper(&app);
        update.install(bytes)?;
        Ok(true)
    }
    .await;
    match result {
        Ok(true) => app.restart(),
        Ok(false) => log(&app, "--- no update available"),
        Err(e) => {
            log(&app, &format!("--- update failed: {e}"));
            let state = app.state::<Helper>();
            let stopped = std::mem::replace(&mut *state.quitting.lock().unwrap(), false);
            if stopped {
                start_helper(&app);
            }
        }
    }
}

/// Opens the planner in the default browser; `?live` connects it to the helper
fn open_planner(app: &AppHandle) {
    if let Err(e) = app.opener().open_url(planner_url().as_str(), None::<&str>) {
        log(app, &format!("Couldn't open the browser: {e}"));
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Nightstint", true, None::<&str>)?;
    let demo = CheckMenuItem::with_id(app, "demo", "Demo race (no iRacing)", true, false, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "Restart iRacing helper", true, None::<&str>)?;
    let recordings = MenuItem::with_id(app, "recordings", "Open recordings folder", true, None::<&str>)?;
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, autostart_on, None::<&str>)?;
    let updates = MenuItem::with_id(app, "update", "Check for updates", true, None::<&str>)?;
    let version = format!("Nightstint {}", app.package_info().version);
    let about = MenuItem::with_id(app, "version", version, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Nightstint", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &demo,
            &restart,
            &recordings,
            &PredefinedMenuItem::separator(app)?,
            &autostart,
            &updates,
            &PredefinedMenuItem::separator(app)?,
            &about,
            &quit,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Nightstint: iRacing helper running")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => open_planner(app),
            "demo" => {
                *app.state::<Helper>().demo.lock().unwrap() = demo.is_checked().unwrap_or(false);
                start_helper(app);
            }
            "restart" => start_helper(app),
            "update" => {
                tauri::async_runtime::spawn(update(app.clone()));
            }
            "recordings" => {
                let _ = app.opener().open_path(plain_path(&data_dir(app, "recordings")), None::<&str>);
            }
            "autostart" => {
                let launcher = app.autolaunch();
                let _ = if autostart.is_checked().unwrap_or(false) { launcher.enable() } else { launcher.disable() };
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                open_planner(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // A second launch just opens the planner (only one helper can use the port)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| open_planner(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN_ARG])))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Helper::default())
        .setup(|app| {
            let handle = app.handle();
            // Start with Windows by default, once; the tray menu turns it off
            let marker = data_dir(handle, "").join("first-run-done");
            if !marker.exists() {
                let _ = handle.autolaunch().enable();
                let _ = fs::write(&marker, "");
            }
            build_tray(handle)?;
            start_helper(handle);
            tauri::async_runtime::spawn(update(handle.clone()));
            // Started by hand rather than by Windows at sign-in: show the planner
            if !std::env::args().any(|a| a == HIDDEN_ARG) {
                open_planner(handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while starting Nightstint")
        .run(|app, event| match event {
            // There are no windows; only Quit in the tray (an explicit exit code) ends the app
            RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
            RunEvent::Exit => stop_helper(app),
            _ => {}
        });
}
