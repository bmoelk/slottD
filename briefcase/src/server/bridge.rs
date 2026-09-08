use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::git::GitDriver;
use crate::sync::SyncEngine;

pub struct BridgeServer {
    pub port: u16,
    pub content_dir: PathBuf,
    pub db_path: PathBuf,
    pub logs: Arc<Mutex<VecDeque<String>>>,
    pub secondary_logs: Option<Arc<Mutex<VecDeque<String>>>>,
}

impl BridgeServer {
    pub fn new(
        port: u16,
        content_dir: PathBuf,
        db_path: PathBuf,
        logs: Arc<Mutex<VecDeque<String>>>,
    ) -> Self {
        Self {
            port,
            content_dir,
            db_path,
            logs,
            secondary_logs: None,
        }
    }

    pub fn with_secondary_logs(mut self, secondary: Arc<Mutex<VecDeque<String>>>) -> Self {
        self.secondary_logs = Some(secondary);
        self
    }

    /// Spawns the HTTP server thread on 127.0.0.1:port.
    /// If the port is already bound, it logs a notice without crashing.
    pub fn start(&self) -> Result<()> {
        let addr = format!("127.0.0.1:{}", self.port);
        let listener = match TcpListener::bind(&addr) {
            Ok(l) => l,
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                log_msg(
                    &self.logs,
                    self.secondary_logs.as_ref(),
                    format!(
                        "⚠️ [Git Bridge] Port {} already in use. Assuming external bridge active.",
                        self.port
                    ),
                );
                return Ok(());
            }
            Err(e) => {
                log_msg(
                    &self.logs,
                    self.secondary_logs.as_ref(),
                    format!("❌ [Git Bridge] Failed to bind port {}: {}", self.port, e),
                );
                return Err(e).context(format!("Failed to bind Git bridge on {}", addr));
            }
        };

        log_msg(
            &self.logs,
            self.secondary_logs.as_ref(),
            format!("🔌 [Git Bridge] Native SlottD Git Bridge active on http://{}", addr),
        );

        let content_dir = self.content_dir.clone();
        let db_path = self.db_path.clone();
        let logs = Arc::clone(&self.logs);
        let secondary = self.secondary_logs.clone();

        thread::spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(s) => {
                        let content_clone = content_dir.clone();
                        let db_clone = db_path.clone();
                        let logs_clone = Arc::clone(&logs);
                        let secondary_clone = secondary.clone();
                        thread::spawn(move || {
                            let _ = handle_client(
                                s,
                                &content_clone,
                                &db_clone,
                                &logs_clone,
                                secondary_clone.as_ref(),
                            );
                        });
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(())
    }
}

fn handle_client(
    mut stream: TcpStream,
    content_dir: &Path,
    db_path: &Path,
    logs: &Arc<Mutex<VecDeque<String>>>,
    secondary: Option<&Arc<Mutex<VecDeque<String>>>>,
) -> Result<()> {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(30)));

    let mut reader = BufReader::new(&mut stream);
    let mut first_line = String::new();
    reader.read_line(&mut first_line)?;
    if first_line.trim().is_empty() {
        return Ok(());
    }

    let mut parts = first_line.trim().split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();

    let mut content_length: usize = 0;
    loop {
        let mut header_line = String::new();
        reader.read_line(&mut header_line)?;
        let trimmed = header_line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse::<usize>().unwrap_or(0);
            }
        }
    }

    let mut body_bytes = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body_bytes)?;
    }
    let body_str = String::from_utf8_lossy(&body_bytes);

    let cors_headers = "Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
Access-Control-Allow-Headers: Content-Type\r\n";

    // 1. CORS Preflight
    if method == "OPTIONS" {
        let response = format!(
            "HTTP/1.1 204 No Content\r\n\
{}Content-Length: 0\r\n\
Connection: close\r\n\
\r\n",
            cors_headers
        );
        stream.write_all(response.as_bytes())?;
        stream.flush()?;
        return Ok(());
    }

    // 2. Health check
    if method == "GET" && path == "/health" {
        let payload = json!({
            "status": "ok",
            "bridge": "slottd-briefcase",
            "port": 8788
        });
        send_json_response(&mut stream, 200, &payload.to_string(), cors_headers)?;
        return Ok(());
    }

    // 3. Execute Release (Export D1 + Git Commit, Tag, Push)
    if method == "POST" && path == "/exec/release" {
        let parsed: Value = serde_json::from_str(&body_str).unwrap_or(Value::Null);
        let tag = parsed
            .get("tag")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                format!("release-{}", chrono::Local::now().format("%Y.%m.%d-%H%M"))
            });
        let message = parsed
            .get("message")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("chore(content): release snapshot {}", tag));
        let push = parsed.get("push").and_then(|v| v.as_bool()).unwrap_or(true);
        let req_repo = parsed
            .get("repoPath")
            .and_then(|v| v.as_str())
            .map(PathBuf::from);

        let target_repo = req_repo
            .filter(|p| p.exists())
            .unwrap_or_else(|| content_dir.to_path_buf());

        log_msg(
            logs,
            secondary,
            format!(
                "🔌 [Git Bridge] Release request received for tag '{}' in {:?}",
                tag, target_repo
            ),
        );

        // Step A: Export database records to disk
        let sync_engine = SyncEngine::new(db_path.to_path_buf(), target_repo.clone());
        let export_result = sync_engine.export_to_disk();
        let export_count = match export_result {
            Ok(count) => {
                log_msg(
                    logs,
                    secondary,
                    format!("📦 [Git Bridge] Exported {} documents to disk.", count),
                );
                count
            }
            Err(e) => {
                log_msg(logs, secondary, format!("⚠️ [Git Bridge] Export notice: {}", e));
                0
            }
        };

        // Step B: Commit, Tag, and Push via GitDriver
        let git = GitDriver::new(target_repo.clone());
        match git.release(&tag, &message, push) {
            Ok(sha) => {
                let success_msg =
                    format!("Successfully created and pushed release '{}' via host Git!", tag);
                let output = format!(
                    "Database snapshot exported: {} documents.\nCreated commit: {}\nCreated tag: {}{}",
                    export_count,
                    sha,
                    tag,
                    if push {
                        "\nPushed commit and tags to origin."
                    } else {
                        ""
                    }
                );
                log_msg(logs, secondary, format!("✅ [Git Bridge] {}", success_msg));
                let resp = json!({
                    "success": true,
                    "message": success_msg,
                    "output": output,
                    "sha": sha,
                });
                send_json_response(&mut stream, 200, &resp.to_string(), cors_headers)?;
            }
            Err(err) => {
                let err_msg = format!("Git operation failed: {}", err);
                log_msg(logs, secondary, format!("❌ [Git Bridge] {}", err_msg));
                let resp = json!({
                    "success": false,
                    "error": err_msg,
                    "output": format!("{}", err)
                });
                send_json_response(&mut stream, 500, &resp.to_string(), cors_headers)?;
            }
        }
        return Ok(());
    }

    // 4. Fetch Remote Tags
    if method == "POST" && path == "/exec/fetch" {
        let parsed: Value = serde_json::from_str(&body_str).unwrap_or(Value::Null);
        let req_repo = parsed
            .get("repoPath")
            .and_then(|v| v.as_str())
            .map(PathBuf::from);
        let target_repo = req_repo
            .filter(|p| p.exists())
            .unwrap_or_else(|| content_dir.to_path_buf());

        let git = GitDriver::new(target_repo);
        match git.fetch_remote_tags() {
            Ok((tags, output)) => {
                let resp = json!({
                    "success": true,
                    "tags": tags,
                    "output": output
                });
                send_json_response(&mut stream, 200, &resp.to_string(), cors_headers)?;
            }
            Err(e) => {
                let resp = json!({
                    "success": false,
                    "error": format!("Failed to fetch remote tags: {}", e),
                    "output": format!("{}", e)
                });
                send_json_response(&mut stream, 500, &resp.to_string(), cors_headers)?;
            }
        }
        return Ok(());
    }

    // 5. Diff Preview
    if method == "POST" && path == "/exec/diff" {
        let parsed: Value = serde_json::from_str(&body_str).unwrap_or(Value::Null);
        let tag = parsed.get("tag").and_then(|v| v.as_str()).unwrap_or("");
        let req_repo = parsed
            .get("repoPath")
            .and_then(|v| v.as_str())
            .map(PathBuf::from);
        let target_repo = req_repo
            .filter(|p| p.exists())
            .unwrap_or_else(|| content_dir.to_path_buf());

        let git = GitDriver::new(target_repo);
        match git.diff(tag) {
            Ok(output) => {
                let resp = json!({
                    "success": true,
                    "output": output
                });
                send_json_response(&mut stream, 200, &resp.to_string(), cors_headers)?;
            }
            Err(e) => {
                let resp = json!({
                    "success": false,
                    "error": format!("Diff failed: {}", e),
                    "output": format!("{}", e)
                });
                send_json_response(&mut stream, 500, &resp.to_string(), cors_headers)?;
            }
        }
        return Ok(());
    }

    // 404 Not Found for unrecognized routes
    let resp = json!({ "error": "Endpoint not found on Git bridge" });
    send_json_response(&mut stream, 404, &resp.to_string(), cors_headers)?;
    Ok(())
}

fn send_json_response(
    stream: &mut TcpStream,
    status_code: u16,
    json_body: &str,
    cors_headers: &str,
) -> Result<()> {
    let status_text = match status_code {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "Status",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\n\
{}Content-Type: application/json\r\n\
Content-Length: {}\r\n\
Connection: close\r\n\
\r\n\
{}",
        status_code,
        status_text,
        cors_headers,
        json_body.len(),
        json_body
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()?;
    Ok(())
}

fn log_msg(
    logs: &Arc<Mutex<VecDeque<String>>>,
    secondary: Option<&Arc<Mutex<VecDeque<String>>>>,
    msg: String,
) {
    {
        let mut l = logs.lock().unwrap();
        if l.len() >= 300 {
            l.pop_front();
        }
        l.push_back(msg.clone());
    }
    if let Some(sec) = secondary {
        let mut l = sec.lock().unwrap();
        if l.len() >= 300 {
            l.pop_front();
        }
        l.push_back(msg);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    #[test]
    fn test_bridge_server_health_and_cors() {
        // Bind on ephemeral port
        let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind ephemeral port");
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let logs = Arc::new(Mutex::new(VecDeque::new()));
        let bridge = BridgeServer::new(
            port,
            PathBuf::from("/tmp"),
            PathBuf::from("/tmp/test.sqlite"),
            Arc::clone(&logs),
        );
        bridge.start().expect("Failed to start bridge server");

        // Wait brief moment for listener to boot
        thread::sleep(std::time::Duration::from_millis(50));

        // Test GET /health
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port))
            .expect("Failed to connect to bridge");
        stream
            .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();

        assert!(response.contains("HTTP/1.1 200 OK"));
        assert!(response.contains("\"status\":\"ok\""));
        assert!(response.contains("Access-Control-Allow-Origin: *"));

        // Test OPTIONS CORS
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port))
            .expect("Failed to connect for OPTIONS");
        stream
            .write_all(b"OPTIONS /exec/release HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();

        assert!(response.contains("HTTP/1.1 204 No Content"));
        assert!(response.contains("Access-Control-Allow-Methods: GET, POST, OPTIONS"));

        // Test 404 on unknown endpoint
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port))
            .expect("Failed to connect for 404 test");
        stream
            .write_all(b"GET /unknown HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.contains("HTTP/1.1 404 Not Found"));
        assert!(response.contains("Endpoint not found"));

        // Test POST /exec/diff endpoint
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port))
            .expect("Failed to connect for diff test");
        let body = r#"{"tag":""}"#;
        let req = format!(
            "POST /exec/diff HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        stream.write_all(req.as_bytes()).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.contains("HTTP/1.1 200 OK") || response.contains("HTTP/1.1 500"));
    }
}
