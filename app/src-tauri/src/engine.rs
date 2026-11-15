//! The bridge to the engine. The app never touches factory.db: every call goes over the engine's Unix
//! socket (one JSON message per line), and a subscription relays the engine's events to the windows.
//! If the engine isn't running, the app starts it the same way the CLI does (`factory engine start`).

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

static SEQ: AtomicU64 = AtomicU64::new(1);
static STARTING: AtomicBool = AtomicBool::new(false);

/// Same rules as the engine's src/paths.ts: FACTORY_SOCKET, else FACTORY_HOME/run, else ~/.factory/run.
pub fn socket_path() -> PathBuf {
    if let Ok(s) = std::env::var("FACTORY_SOCKET") {
        return PathBuf::from(s);
    }
    let home = std::env::var("FACTORY_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".factory"));
    home.join("run").join("factoryd.sock")
}

/// One request, one answer. A fresh connection per call keeps this simple and crash-proof.
pub fn call(method: &str, params: Value) -> Result<Value, String> {
    let mut stream = UnixStream::connect(socket_path()).map_err(|_| "the engine isn't running; the app is starting it".to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(120))).ok();
    let id = SEQ.fetch_add(1, Ordering::Relaxed);
    let line = json!({ "id": id, "method": method, "params": params }).to_string() + "\n";
    stream.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream);
    let mut buf = String::new();
    loop {
        buf.clear();
        let n = reader.read_line(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("the engine closed the connection".into());
        }
        let Ok(msg) = serde_json::from_str::<Value>(&buf) else { continue };
        if msg.get("id").and_then(Value::as_u64) != Some(id) {
            continue;
        }
        return if msg.get("ok").and_then(Value::as_bool) == Some(true) {
            Ok(msg.get("result").cloned().unwrap_or(Value::Null))
        } else {
            Err(msg.get("error").and_then(Value::as_str).unwrap_or("failed").to_string())
        };
    }
}

pub fn alive() -> bool {
    UnixStream::connect(socket_path()).is_ok()
}

/// Starts the engine through a login shell, so PATH has node and the `factory` command as in Terminal.
pub fn ensure_running() {
    if alive() || STARTING.swap(true, Ordering::SeqCst) {
        return;
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let _ = Command::new(shell)
        .args(["-lc", "factory engine start"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    let t = Instant::now();
    while !alive() && t.elapsed() < Duration::from_secs(10) {
        std::thread::sleep(Duration::from_millis(200));
    }
    STARTING.store(false, Ordering::SeqCst);
}

/// Relays engine events to every window as "engine" events, and the connection state as
/// "engine-state". Reconnects (and restarts the engine) whenever the socket drops.
pub fn subscribe(app: AppHandle) {
    std::thread::spawn(move || loop {
        if let Ok(mut stream) = UnixStream::connect(socket_path()) {
            let line = json!({ "id": 0, "method": "subscribe", "params": {} }).to_string() + "\n";
            if stream.write_all(line.as_bytes()).is_ok() {
                let _ = app.emit("engine-state", true);
                let reader = BufReader::new(stream);
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
                    if let Some(event) = msg.get("event") {
                        let _ = app.emit("engine", json!({ "event": event, "data": msg.get("data").cloned().unwrap_or(Value::Null) }));
                    }
                }
            }
        }
        let _ = app.emit("engine-state", false);
        ensure_running();
        std::thread::sleep(Duration::from_secs(2));
    });
}
