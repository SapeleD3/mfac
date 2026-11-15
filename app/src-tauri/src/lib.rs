//! The factory's Mac app. Three ways to run (Settings → How it runs): the widget pill (default), the
//! full window, or headless (no UI; the engine runs on its own from login). All of them are views of
//! the same engine; closing a window never stops the factory.

mod engine;

use serde_json::Value;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewWindow, WindowEvent};

const WIDGET_W: f64 = 420.0;
const WIDGET_OPEN_H: f64 = 640.0;
const WIDGET_CLOSED_H: f64 = 52.0;

#[tauri::command]
async fn engine_call(method: String, params: Option<Value>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || engine::call(&method, params.unwrap_or(Value::Object(Default::default()))))
        .await
        .map_err(|e| e.to_string())?
}

/// Opens Terminal.app running a factory command, for example `factory attach F-001`.
#[tauri::command]
fn open_terminal(command: String) -> Result<(), String> {
    if !command.starts_with("factory ") || command.contains(['"', '\\', ';', '&', '|', '`', '$', '\n']) {
        return Err("only plain factory commands open in Terminal".into());
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!("tell application \"Terminal\"\n activate\n do script \"{command}\"\nend tell");
        std::process::Command::new("osascript").args(["-e", &script]).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = command;
    }
    Ok(())
}

#[tauri::command]
fn show_main(app: AppHandle, route: String) -> Result<(), String> {
    open_main(&app, &route);
    Ok(())
}

/// The widget window only covers the pill when closed, so it never blocks clicks underneath.
#[tauri::command]
fn widget_open(app: AppHandle, open: bool) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("widget") {
        w.set_size(LogicalSize::new(WIDGET_W, if open { WIDGET_OPEN_H } else { WIDGET_CLOSED_H })).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn open_main(app: &AppHandle, route: &str) {
    let Some(w) = app.get_webview_window("main") else { return };
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if !route.is_empty() {
        let hash = serde_json::to_string(route).unwrap_or_else(|_| "\"\"".into());
        let _ = w.eval(&format!("location.hash = {hash}"));
    }
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
}

fn show_widget(w: &WebviewWindow) {
    // Top right of the screen it's on, just under the menu bar.
    if let Ok(Some(m)) = w.current_monitor() {
        let scale = m.scale_factor();
        let x = m.position().x + m.size().width as i32 - ((WIDGET_W + 16.0) * scale) as i32;
        let y = m.position().y + (36.0 * scale) as i32;
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
    let _ = w.show();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![engine_call, open_terminal, show_main, widget_open])
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(engine::ensure_running);
            engine::subscribe(handle.clone());

            let mode = engine::call("settings.get", Value::Null)
                .ok()
                .and_then(|s| s.pointer("/ui/mode").and_then(Value::as_str).map(String::from))
                .unwrap_or_else(|| "widget".into());
            if mode == "headless" {
                // The engine keeps running from its launch agent; nothing to show.
                handle.exit(0);
                return Ok(());
            }
            #[cfg(target_os = "macos")]
            if mode == "widget" {
                handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            if let Some(w) = app.get_webview_window("widget") {
                show_widget(&w);
            }
            if mode == "app" {
                open_main(&handle, "queue");
            }

            // Menu bar icon: the same few actions as the pill.
            let open = MenuItem::with_id(app, "open", "Open Factory", true, None::<&str>)?;
            let widget = MenuItem::with_id(app, "widget", "Show or hide the widget", true, None::<&str>)?;
            let needs = MenuItem::with_id(app, "needs", "Needs you", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit the app (the factory keeps running)", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &needs, &widget, &PredefinedMenuItem::separator(app)?, &quit])?;
            let mut tray = TrayIconBuilder::with_id("factory").menu(&menu).tooltip("Factory").show_menu_on_left_click(true);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone()).icon_as_template(true);
            }
            tray.on_menu_event(|app, e| match e.id().as_ref() {
                "open" => open_main(app, "queue"),
                "needs" => open_main(app, "needs"),
                "widget" => {
                    if let Some(w) = app.get_webview_window("widget") {
                        if w.is_visible().unwrap_or(false) {
                            let _ = w.hide();
                        } else {
                            show_widget(&w);
                        }
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            })
            .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window hides it; the widget and the engine carry on.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                    #[cfg(target_os = "macos")]
                    let _ = window.app_handle().set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("the factory app couldn't start");
}
