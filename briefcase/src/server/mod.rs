use anyhow::{Context, Result};
use command_group::{CommandGroup, GroupChild};
use std::collections::VecDeque;
use std::env;
use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
pub mod bridge;
pub use bridge::BridgeServer;

const MAX_LOG_LINES: usize = 300;

pub fn is_port_ready(port: u16) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(80)).is_ok()
}

#[derive(Debug, Clone, PartialEq)]
pub enum ServiceStatus {
    Stopped,
    Starting,
    WaitingForDependency(String),
    Running { pid: u32, port: u16 },
    Error(String),
}

pub struct ManagedService {
    pub name: String,
    pub working_dir: PathBuf,
    pub command: String,
    pub args: Vec<String>,
    pub env_vars: Vec<(String, String)>,
    pub port: u16,
    child: Option<GroupChild>,
    pub status: Arc<Mutex<ServiceStatus>>,
    pub logs: Arc<Mutex<VecDeque<String>>>,
}

impl ManagedService {
    pub fn new(
        name: &str,
        working_dir: PathBuf,
        command: &str,
        args: &[&str],
        env_vars: &[(&str, &str)],
        port: u16,
    ) -> Self {
        Self {
            name: name.to_string(),
            working_dir,
            command: command.to_string(),
            args: args.iter().map(|s| s.to_string()).collect(),
            env_vars: env_vars.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            port,
            child: None,
            status: Arc::new(Mutex::new(ServiceStatus::Stopped)),
            logs: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_LINES))),
        }
    }

    /// Spawns the service in its own isolated process group with full user PATH and overrides.
    pub fn start(&mut self) -> Result<()> {
        if self.is_running() {
            return Ok(());
        }

        if !self.working_dir.exists() {
            let err = format!("Directory not found: {:?}", self.working_dir);
            *self.status.lock().unwrap() = ServiceStatus::Error(err.clone());
            self.append_log(format!("❌ {}", err));
            anyhow::bail!(err);
        }

        *self.status.lock().unwrap() = ServiceStatus::Starting;
        self.append_log(format!("🚀 Starting {} in {:?}...", self.name, self.working_dir));

        let current_path = env::var("PATH").unwrap_or_default();

        let mut cmd = Command::new(&self.command);
        cmd.args(&self.args)
            .current_dir(&self.working_dir)
            .env("PATH", current_path);

        // Disconnect stdin so Vite / Wrangler do not compete with Ratatui's raw mode on terminal stdin
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Environment Sanitization:
        // 1. Strip agent detection markers (prevents Astro 7 am-i-vibing from auto-daemonizing and exiting)
        cmd.env_remove("ANTIGRAVITY_AGENT");
        cmd.env_remove("ANTIGRAVITY_PROJECT_ID");
        cmd.env_remove("CLAUDECODE");
        cmd.env_remove("CURSOR_TRACE_ID");

        // 2. Strip npm environment contamination from parent `npm run briefcase`
        cmd.env_remove("INIT_CWD");
        cmd.env_remove("npm_package_json");
        cmd.env_remove("npm_package_name");
        cmd.env_remove("npm_package_version");
        cmd.env_remove("npm_lifecycle_event");
        cmd.env_remove("npm_lifecycle_script");

        // 3. Explicitly enforce foreground execution for Astro
        cmd.env("ASTRO_DEV_BACKGROUND", "false");

        // Inject explicit environment overrides (e.g. CMS_API_URL=http://127.0.0.1:8787)
        for (k, v) in &self.env_vars {
            cmd.env(k, v);
            self.append_log(format!("   [env override] {}={}", k, v));
        }

        // Spawn process with command-group for complete descendant termination
        let mut group_child = match cmd.group_spawn() {
            Ok(child) => child,
            Err(e) => {
                let err_msg = format!("Failed to spawn {}: {}", self.name, e);
                *self.status.lock().unwrap() = ServiceStatus::Error(err_msg.clone());
                self.append_log(format!("❌ {}", err_msg));
                return Err(e).context(err_msg);
            }
        };

        let pid = group_child.id();
        let port = self.port;
        *self.status.lock().unwrap() = ServiceStatus::Running { pid, port };
        self.append_log(format!("🟢 {} running (PID: {}, Port: {})", self.name, pid, port));

        // Background reader for stdout
        if let Some(stdout) = group_child.inner().stdout.take() {
            let logs_clone = Arc::clone(&self.logs);
            let name_clone = self.name.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    let mut logs = logs_clone.lock().unwrap();
                    if logs.len() >= MAX_LOG_LINES {
                        logs.pop_front();
                    }
                    logs.push_back(format!("[{}] {}", name_clone, line));
                }
            });
        }

        // Background reader for stderr
        if let Some(stderr) = group_child.inner().stderr.take() {
            let logs_clone = Arc::clone(&self.logs);
            let name_clone = self.name.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    let mut logs = logs_clone.lock().unwrap();
                    if logs.len() >= MAX_LOG_LINES {
                        logs.pop_front();
                    }
                    logs.push_back(format!("[{}:err] {}", name_clone, line));
                }
            });
        }

        self.child = Some(group_child);
        Ok(())
    }

    /// Gracefully kills the entire process group (workerd / vite / node descendants).
    pub fn stop(&mut self) -> Result<()> {
        if let Some(mut child) = self.child.take() {
            self.append_log(format!("🛑 Stopping {}...", self.name));
            let _ = child.kill();
            let _ = child.wait();
            *self.status.lock().unwrap() = ServiceStatus::Stopped;
            self.append_log(format!("⚪ {} stopped.", self.name));
        }
        Ok(())
    }

    pub fn is_running(&self) -> bool {
        match *self.status.lock().unwrap() {
            ServiceStatus::Running { .. } => true,
            _ => false,
        }
    }

    fn append_log(&self, line: String) {
        let mut logs = self.logs.lock().unwrap();
        if logs.len() >= MAX_LOG_LINES {
            logs.pop_front();
        }
        logs.push_back(line);
    }
}

impl Drop for ManagedService {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

pub struct DualSupervisor {
    pub cms: ManagedService,
    pub site: Option<ManagedService>,
    site_pending: bool,
}

impl DualSupervisor {
    pub fn new(cms_dir: PathBuf, site_dir: Option<PathBuf>) -> Self {
        let cms = ManagedService::new(
            "SlottD CMS",
            cms_dir,
            "npx",
            &["wrangler", "dev", "--port", "8787", "--ip", "127.0.0.1"],
            &[],
            8787,
        );

        let site = site_dir.map(|dir| {
            ManagedService::new(
                "Astro Site",
                dir,
                "npx",
                &["astro", "dev", "--host", "127.0.0.1", "--port", "4321"],
                &[
                    ("CMS_PROVIDER", "slottd"),
                    ("CMS_API_URL", "http://127.0.0.1:8787"),
                    ("ASTRO_DEV_BACKGROUND", "false"),
                ],
                4321,
            )
        });

        Self {
            cms,
            site,
            site_pending: false,
        }
    }

    pub fn start_all(&mut self) {
        let _ = self.cms.start();
        if self.site.is_some() {
            self.site_pending = true;
            if let Some(site) = self.site.as_mut() {
                *site.status.lock().unwrap() =
                    ServiceStatus::WaitingForDependency("SlottD CMS (:8787)".to_string());
                site.append_log("🟡 Waiting for SlottD CMS (:8787) readiness before launching Astro...".to_string());
            }
        }
    }

    /// Periodic non-blocking check called from the TUI event loop.
    pub fn tick(&mut self) {
        if self.site_pending {
            // Check if CMS port 8787 is ready
            if is_port_ready(8787) {
                if let Some(site) = self.site.as_mut() {
                    site.append_log("⚡ SlottD CMS is listening on :8787! Launching Astro dev server...".to_string());
                    let _ = site.start();
                }
                self.site_pending = false;
            }
        }
    }

    pub fn stop_all(&mut self) {
        self.site_pending = false;
        let _ = self.cms.stop();
        if let Some(site) = self.site.as_mut() {
            let _ = site.stop();
        }
    }
}

impl Drop for DualSupervisor {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn test_is_port_ready_with_mock_listener() {
        // Find an available ephemeral port
        let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind ephemeral port");
        let port = listener.local_addr().unwrap().port();

        // While listener is active, is_port_ready must return true
        assert!(is_port_ready(port), "Port {} should be reported as ready", port);

        // Drop the listener to close the socket
        drop(listener);

        // Now is_port_ready must return false
        assert!(!is_port_ready(port), "Port {} should be reported as not ready after drop", port);
    }

    #[test]
    fn test_managed_service_initial_state() {
        let service = ManagedService::new(
            "Test Service",
            PathBuf::from("/tmp"),
            "echo",
            &["hello"],
            &[("FOO", "BAR")],
            9999,
        );

        assert_eq!(*service.status.lock().unwrap(), ServiceStatus::Stopped);
        assert_eq!(service.is_running(), false);
        assert_eq!(service.port, 9999);
    }
}

