use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

const JUKEBOX_PORT: &str = "45321";
const HTTPS_PORT_CANDIDATES: [u16; 4] = [443, 8443, 9443, 10_443];
const STATUS_COMMAND_TIMEOUT: Duration = Duration::from_secs(3);
const MUTATION_COMMAND_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_ERROR_LENGTH: usize = 240;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleStatus {
    installed: bool,
    connected: bool,
    backend_state: Option<String>,
    dns_name: Option<String>,
    serve_configured: bool,
    serve_managed: bool,
    https_port: Option<u16>,
    recommended_https_port: Option<u16>,
    url: Option<String>,
    error: Option<String>,
}

struct CommandOutput {
    stdout: String,
    stderr: String,
    success: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct JukeboxServeMapping {
    port: u16,
    url: String,
    exclusive: bool,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct ServeInspection {
    mapping: Option<JukeboxServeMapping>,
    occupied_ports: BTreeSet<u16>,
}

struct TailscaleRuntime {
    binary: PathBuf,
    backend_state: Option<String>,
    connected: bool,
    dns_name: Option<String>,
}

#[tauri::command]
pub async fn get_tailscale_status() -> TailscaleStatus {
    inspect_tailscale().await
}

#[tauri::command]
pub async fn start_tailscale_serve() -> Result<TailscaleStatus, String> {
    let runtime = load_runtime().await?;
    if !runtime.connected {
        return Err("Open Tailscale and sign in before starting private access".to_string());
    }

    let inspection = inspect_serve(&runtime.binary).await?;
    if inspection.mapping.is_some() {
        return Ok(status_from(runtime, inspection, None));
    }
    let port = recommended_https_port(&inspection)
        .ok_or_else(|| "No supported private HTTPS port is available".to_string())?;
    let https_flag = format!("--https={port}");
    let output = run_command(
        &runtime.binary,
        &["serve", "--bg", &https_flag, JUKEBOX_PORT],
        MUTATION_COMMAND_TIMEOUT,
    )
    .await
    .ok_or_else(|| "Tailscale Serve timed out or could not be started".to_string())?;
    if !output.success {
        return Err(command_error(&output)
            .unwrap_or_else(|| "Tailscale Serve could not be started".to_string()));
    }

    let refreshed = inspect_serve(&runtime.binary).await?;
    if refreshed.mapping.is_none() {
        return Err("Tailscale did not report the Jukebox endpoint after starting it".to_string());
    }
    Ok(status_from(runtime, refreshed, None))
}

#[tauri::command]
pub async fn stop_tailscale_serve() -> Result<TailscaleStatus, String> {
    let runtime = load_runtime().await?;
    let inspection = inspect_serve(&runtime.binary).await?;
    let Some(mapping) = inspection.mapping.as_ref() else {
        return Ok(status_from(runtime, inspection, None));
    };
    if !mapping.exclusive {
        return Err(
            "Jukebox shares this Tailscale endpoint, so it cannot be stopped without affecting another app"
                .to_string(),
        );
    }

    let https_flag = format!("--https={}", mapping.port);
    let output = run_command(
        &runtime.binary,
        &["serve", &https_flag, "off"],
        MUTATION_COMMAND_TIMEOUT,
    )
    .await
    .ok_or_else(|| "Tailscale Serve timed out or could not be stopped".to_string())?;
    if !output.success {
        return Err(command_error(&output)
            .unwrap_or_else(|| "Tailscale Serve could not be stopped".to_string()));
    }

    let refreshed = inspect_serve(&runtime.binary).await?;
    if refreshed.mapping.is_some() {
        return Err("Tailscale still reports a Jukebox endpoint after stopping it".to_string());
    }
    Ok(status_from(runtime, refreshed, None))
}

async fn inspect_tailscale() -> TailscaleStatus {
    let runtime = match load_runtime().await {
        Ok(runtime) => runtime,
        Err(error) => return unavailable_status(error),
    };
    match inspect_serve(&runtime.binary).await {
        Ok(inspection) => status_from(runtime, inspection, None),
        Err(error) => status_from(runtime, ServeInspection::default(), Some(error)),
    }
}

async fn load_runtime() -> Result<TailscaleRuntime, String> {
    let Some((binary, status)) = first_available_status().await else {
        return Err("Tailscale is not installed".to_string());
    };
    if !status.success {
        return Err(command_error(&status)
            .unwrap_or_else(|| "Tailscale is installed but not ready".to_string()));
    }

    let status_json: Value = serde_json::from_str(&status.stdout)
        .map_err(|_| "Tailscale returned an unreadable status".to_string())?;
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

    Ok(TailscaleRuntime {
        binary,
        backend_state,
        connected,
        dns_name,
    })
}

async fn inspect_serve(binary: &Path) -> Result<ServeInspection, String> {
    let output = run_command(
        binary,
        &["serve", "status", "--json"],
        STATUS_COMMAND_TIMEOUT,
    )
    .await
    .ok_or_else(|| "Tailscale Serve status timed out or could not be read".to_string())?;
    if !output.success {
        return Err(command_error(&output)
            .unwrap_or_else(|| "Tailscale Serve status is unavailable".to_string()));
    }
    let value: Value = serde_json::from_str(&output.stdout)
        .map_err(|_| "Tailscale returned an unreadable Serve status".to_string())?;
    Ok(parse_serve_status(&value))
}

fn status_from(
    runtime: TailscaleRuntime,
    inspection: ServeInspection,
    error: Option<String>,
) -> TailscaleStatus {
    let recommended_https_port = error
        .is_none()
        .then(|| recommended_https_port(&inspection))
        .flatten();
    let (serve_configured, serve_managed, https_port, url) = inspection
        .mapping
        .map(|mapping| {
            (
                true,
                mapping.exclusive,
                Some(mapping.port),
                Some(mapping.url),
            )
        })
        .unwrap_or((false, false, None, None));
    TailscaleStatus {
        installed: true,
        connected: runtime.connected,
        backend_state: runtime.backend_state,
        dns_name: runtime.dns_name,
        serve_configured,
        serve_managed,
        https_port,
        recommended_https_port,
        url,
        error,
    }
}

fn unavailable_status(error: String) -> TailscaleStatus {
    let installed = error != "Tailscale is not installed";
    TailscaleStatus {
        installed,
        connected: false,
        backend_state: None,
        dns_name: None,
        serve_configured: false,
        serve_managed: false,
        https_port: None,
        recommended_https_port: Some(HTTPS_PORT_CANDIDATES[0]),
        url: None,
        error: installed.then_some(error),
    }
}

fn recommended_https_port(inspection: &ServeInspection) -> Option<u16> {
    HTTPS_PORT_CANDIDATES
        .into_iter()
        .find(|port| !inspection.occupied_ports.contains(port))
}

async fn first_available_status() -> Option<(PathBuf, CommandOutput)> {
    for candidate in candidates() {
        if candidate.is_absolute() {
            if !candidate.is_file() {
                continue;
            }
            let output = run_command(&candidate, &["status", "--json"], STATUS_COMMAND_TIMEOUT)
                .await
                .unwrap_or_else(|| CommandOutput {
                    stdout: String::new(),
                    stderr: "Tailscale status timed out or could not be read".to_string(),
                    success: false,
                });
            return Some((candidate, output));
        } else if let Some(output) =
            run_command(&candidate, &["status", "--json"], STATUS_COMMAND_TIMEOUT).await
        {
            return Some((candidate, output));
        }
    }
    None
}

async fn run_command(binary: &Path, args: &[&str], timeout: Duration) -> Option<CommandOutput> {
    let mut command = Command::new(binary);
    command
        .args(args)
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = tokio::time::timeout(timeout, command.output())
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

fn parse_serve_status(value: &Value) -> ServeInspection {
    let mut inspection = ServeInspection::default();
    collect_web_endpoints(value, &mut inspection, true);
    inspection
}

fn collect_web_endpoints(value: &Value, inspection: &mut ServeInspection, manageable: bool) {
    match value {
        Value::Array(values) => {
            for value in values {
                collect_web_endpoints(value, inspection, manageable);
            }
        }
        Value::Object(values) => {
            if let Some(tcp) = values.get("TCP").and_then(Value::as_object) {
                for port in tcp.keys().filter_map(|port| port.parse::<u16>().ok()) {
                    inspection.occupied_ports.insert(port);
                }
            }
            if let Some(web) = values.get("Web").and_then(Value::as_object) {
                for (host_port, endpoint) in web {
                    inspect_web_endpoint(host_port, endpoint, inspection, manageable);
                }
            }
            for (key, value) in values {
                if key != "TCP" && key != "Web" {
                    collect_web_endpoints(value, inspection, manageable && key != "Services");
                }
            }
        }
        _ => {}
    }
}

fn inspect_web_endpoint(
    host_port: &str,
    endpoint: &Value,
    inspection: &mut ServeInspection,
    manageable: bool,
) {
    let Some(port) = host_port
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok())
    else {
        return;
    };
    inspection.occupied_ports.insert(port);

    let Some(handlers) = endpoint.get("Handlers").and_then(Value::as_object) else {
        return;
    };
    for (path, handler) in handlers {
        let Some(proxy) = handler.get("Proxy").and_then(Value::as_str) else {
            continue;
        };
        if is_jukebox_target(proxy) {
            let suffix = if path == "/" { "" } else { path.as_str() };
            let mapping = JukeboxServeMapping {
                port,
                url: format!("https://{host_port}{suffix}"),
                exclusive: manageable && handlers.len() == 1 && path == "/",
            };
            if inspection
                .mapping
                .as_ref()
                .is_none_or(|current| !current.exclusive && mapping.exclusive)
            {
                inspection.mapping = Some(mapping);
            }
        }
    }
}

fn is_jukebox_target(value: &str) -> bool {
    value.contains(&format!("127.0.0.1:{JUKEBOX_PORT}"))
        || value.contains(&format!("localhost:{JUKEBOX_PORT}"))
}

fn command_error(output: &CommandOutput) -> Option<String> {
    let message = [output.stderr.trim(), output.stdout.trim()]
        .into_iter()
        .filter(|message| !message.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
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
    fn detects_a_dedicated_jukebox_endpoint_and_exact_url() {
        let status = serde_json::json!({
            "TCP": {
                "8443": { "HTTPS": true }
            },
            "Web": {
                "mac.tailnet.ts.net:8443": {
                    "Handlers": {
                        "/": { "Proxy": "http://127.0.0.1:45321" }
                    }
                }
            }
        });

        let inspection = parse_serve_status(&status);
        assert_eq!(
            inspection.mapping,
            Some(JukeboxServeMapping {
                port: 8443,
                url: "https://mac.tailnet.ts.net:8443".to_string(),
                exclusive: true,
            })
        );
        assert_eq!(inspection.occupied_ports, BTreeSet::from([8443]));
    }

    #[test]
    fn chooses_a_free_port_without_replacing_coach() {
        let status = serde_json::json!({
            "TCP": {
                "443": { "HTTPS": true }
            },
            "Web": {
                "mac.tailnet.ts.net:443": {
                    "Handlers": {
                        "/": { "Proxy": "http://127.0.0.1:3000" }
                    }
                }
            }
        });

        let inspection = parse_serve_status(&status);
        assert_eq!(inspection.mapping, None);
        assert_eq!(recommended_https_port(&inspection), Some(8443));
    }

    #[test]
    fn refuses_to_manage_a_shared_endpoint() {
        let status = serde_json::json!({
            "Services": {
                "svc:apps": {
                    "Web": {
                        "apps.tailnet.ts.net:443": {
                            "Handlers": {
                                "/coach": { "Proxy": "http://127.0.0.1:3000" },
                                "/jukebox": { "Proxy": "http://localhost:45321" }
                            }
                        }
                    }
                }
            }
        });

        let mapping = parse_serve_status(&status)
            .mapping
            .expect("Jukebox mapping");
        assert_eq!(mapping.url, "https://apps.tailnet.ts.net:443/jukebox");
        assert!(!mapping.exclusive);
    }

    #[test]
    fn refuses_to_manage_an_endpoint_owned_by_a_named_service() {
        let status = serde_json::json!({
            "Services": {
                "svc:jukebox": {
                    "Web": {
                        "jukebox.tailnet.ts.net:8443": {
                            "Handlers": {
                                "/": { "Proxy": "http://127.0.0.1:45321" }
                            }
                        }
                    }
                }
            }
        });

        let mapping = parse_serve_status(&status)
            .mapping
            .expect("Jukebox mapping");
        assert!(!mapping.exclusive);
    }

    #[test]
    fn reports_when_all_supported_ports_are_occupied() {
        let inspection = ServeInspection {
            mapping: None,
            occupied_ports: BTreeSet::from(HTTPS_PORT_CANDIDATES),
        };

        assert_eq!(recommended_https_port(&inspection), None);
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

    #[test]
    fn preserves_useful_output_from_both_cli_streams() {
        let output = CommandOutput {
            stdout: "Visit https://login.tailscale.com/a/example".to_string(),
            stderr: "HTTPS certificate approval is required".to_string(),
            success: false,
        };

        assert_eq!(
            command_error(&output).as_deref(),
            Some(
                "HTTPS certificate approval is required Visit https://login.tailscale.com/a/example"
            )
        );
    }
}
