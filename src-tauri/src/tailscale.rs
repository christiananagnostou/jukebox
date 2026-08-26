use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

const JUKEBOX_PORT: &str = "45321";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_ERROR_LENGTH: usize = 240;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleStatus {
    installed: bool,
    connected: bool,
    backend_state: Option<String>,
    dns_name: Option<String>,
    serve_configured: bool,
    url: Option<String>,
    error: Option<String>,
}

struct CommandOutput {
    stdout: String,
    stderr: String,
    success: bool,
}

#[tauri::command]
pub async fn get_tailscale_status() -> TailscaleStatus {
    inspect_tailscale().await
}

async fn inspect_tailscale() -> TailscaleStatus {
    let Some((binary, status)) = first_available_status().await else {
        return TailscaleStatus {
            installed: false,
            connected: false,
            backend_state: None,
            dns_name: None,
            serve_configured: false,
            url: None,
            error: None,
        };
    };

    if !status.success {
        return TailscaleStatus {
            installed: true,
            connected: false,
            backend_state: None,
            dns_name: None,
            serve_configured: false,
            url: None,
            error: command_error(&status),
        };
    }

    let status_json: Value = match serde_json::from_str(&status.stdout) {
        Ok(value) => value,
        Err(_) => {
            return TailscaleStatus {
                installed: true,
                connected: false,
                backend_state: None,
                dns_name: None,
                serve_configured: false,
                url: None,
                error: Some("Tailscale returned an unreadable status".to_string()),
            };
        }
    };
    let backend_state = status_json
        .get("BackendState")
        .and_then(Value::as_str)
        .map(str::to_string);
    let connected = backend_state.as_deref() == Some("Running");
    let dns_name = status_json
        .get("Self")
        .and_then(|value| value.get("DNSName"))
        .and_then(Value::as_str)
        .map(|value| value.trim_end_matches('.').to_string())
        .filter(|value| !value.is_empty());

    let serve = run_command(&binary, &["serve", "status", "--json"]).await;
    let (serve_configured, serve_url) = serve
        .as_ref()
        .filter(|output| output.success)
        .and_then(|output| serde_json::from_str::<Value>(&output.stdout).ok())
        .map(|value| parse_serve_status(&value))
        .unwrap_or_default();
    let url = serve_url.or_else(|| {
        serve_configured
            .then(|| dns_name.as_ref().map(|name| format!("https://{name}")))
            .flatten()
    });

    TailscaleStatus {
        installed: true,
        connected,
        backend_state,
        dns_name,
        serve_configured,
        url,
        error: None,
    }
}

async fn first_available_status() -> Option<(PathBuf, CommandOutput)> {
    for candidate in candidates() {
        if candidate.is_absolute() {
            if !candidate.is_file() {
                continue;
            }
            let output = run_command(&candidate, &["status", "--json"])
                .await
                .unwrap_or_else(|| CommandOutput {
                    stdout: String::new(),
                    stderr: "Tailscale status timed out or could not be read".to_string(),
                    success: false,
                });
            return Some((candidate, output));
        } else if let Some(output) = run_command(&candidate, &["status", "--json"]).await {
            return Some((candidate, output));
        }
    }
    None
}

async fn run_command(binary: &Path, args: &[&str]) -> Option<CommandOutput> {
    let mut command = Command::new(binary);
    command
        .args(args)
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = tokio::time::timeout(COMMAND_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;
    Some(CommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        success: output.status.success(),
    })
}

fn candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(target_os = "macos")]
    candidates.extend([
        PathBuf::from("/usr/local/bin/tailscale"),
        PathBuf::from("/opt/homebrew/bin/tailscale"),
        PathBuf::from("/Applications/Tailscale.app/Contents/MacOS/Tailscale"),
    ]);
    #[cfg(target_os = "windows")]
    candidates.extend([
        PathBuf::from(r"C:\Program Files\Tailscale\tailscale.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Tailscale\tailscale.exe"),
    ]);
    #[cfg(all(unix, not(target_os = "macos")))]
    candidates.extend([
        PathBuf::from("/usr/bin/tailscale"),
        PathBuf::from("/usr/local/bin/tailscale"),
    ]);
    candidates.push(PathBuf::from("tailscale"));
    candidates
}

fn parse_serve_status(value: &Value) -> (bool, Option<String>) {
    let mut strings = Vec::new();
    collect_strings(value, &mut strings);
    let configured = strings.iter().any(|value| is_jukebox_target(value));
    let url = configured.then(|| {
        strings
            .iter()
            .find(|value| value.starts_with("https://") && value.contains(".ts.net"))
            .map(|value| value.trim_end_matches('/').to_string())
    });
    (configured, url.flatten())
}

fn is_jukebox_target(value: &str) -> bool {
    value.contains(&format!("127.0.0.1:{JUKEBOX_PORT}"))
        || value.contains(&format!("localhost:{JUKEBOX_PORT}"))
}

fn collect_strings<'a>(value: &'a Value, output: &mut Vec<&'a str>) {
    match value {
        Value::String(value) => output.push(value),
        Value::Array(values) => {
            for value in values {
                collect_strings(value, output);
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                output.push(key);
                collect_strings(value, output);
            }
        }
        _ => {}
    }
}

fn command_error(output: &CommandOutput) -> Option<String> {
    let message = if output.stderr.trim().is_empty() {
        output.stdout.trim()
    } else {
        output.stderr.trim()
    };
    if message.is_empty() {
        return Some("Tailscale is installed but not ready".to_string());
    }
    let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(normalized.chars().take(MAX_ERROR_LENGTH).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_the_jukebox_proxy_and_private_url() {
        let status = serde_json::json!({
            "Web": {
                "jukebox.tailnet.ts.net:443": {
                    "Handlers": {
                        "/": { "Proxy": "http://127.0.0.1:45321" }
                    }
                }
            },
            "URL": "https://jukebox.tailnet.ts.net/"
        });

        assert_eq!(
            parse_serve_status(&status),
            (true, Some("https://jukebox.tailnet.ts.net".to_string()))
        );
    }

    #[test]
    fn ignores_unrelated_serve_targets() {
        let status = serde_json::json!({
            "Web": {
                "other.tailnet.ts.net:443": {
                    "Handlers": {
                        "/": { "Proxy": "http://127.0.0.1:3000" }
                    }
                }
            }
        });

        assert_eq!(parse_serve_status(&status), (false, None));
    }

    #[test]
    fn bounds_cli_errors_before_sending_them_to_the_ui() {
        let output = CommandOutput {
            stdout: String::new(),
            stderr: "x".repeat(MAX_ERROR_LENGTH + 20),
            success: false,
        };

        assert_eq!(
            command_error(&output).expect("error").len(),
            MAX_ERROR_LENGTH
        );
    }
}
