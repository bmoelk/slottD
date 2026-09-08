use anyhow::Result;
use clap::{Parser, Subcommand};
use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph, Tabs},
    Terminal,
};
use slottd_briefcase::{
    BridgeServer, D1Database, DualSupervisor, GitDriver, KeyringStore, ServiceStatus, SyncEngine,
};
use std::collections::VecDeque;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Parser)]
#[command(name = "slottd")]
#[command(about = "Native Briefcase CLI & TUI for SlottD CMS and Astro Frontend", long_about = None)]
struct Cli {
    #[arg(short, long, default_value = "/Users/bmo/code/websites-deployed/brainendeavor.com")]
    content_dir: String,

    #[arg(short, long, default_value = "/Users/bmo/code/websites/brainendeavor-slottd-cms/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/3d535fbf7b999553924854d156be0504900204de12924b359a7a78708fb42342.sqlite")]
    db_path: String,

    /// Path to the SlottD CMS directory containing wrangler.toml
    #[arg(long, default_value = "/Users/bmo/code/websites/brainendeavor-slottd-cms")]
    cms_dir: String,

    /// Path to the Astro website directory containing package.json / astro.config
    #[arg(long, default_value = "/Users/bmo/code/websites/brainendeavor.com")]
    site_dir: Option<String>,

    /// Disable running the Astro website dev server
    #[arg(long, default_value_t = false)]
    no_site: bool,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Export local D1 database records to flat Git repository files
    Export,
    /// Restore and load database from Git repository (optionally from a specific release tag)
    Restore {
        #[arg(short, long)]
        tag: Option<String>,
    },
    /// Create Git release snapshot, tag, and push via SSH
    Release {
        #[arg(short, long)]
        tag: Option<String>,
        #[arg(short, long, default_value = "chore(content): release snapshot")]
        message: String,
        #[arg(long, default_value_t = true)]
        push: bool,
    },
    /// Inspect or configure OS Keyring credentials
    Keyring {
        #[arg(short, long)]
        key: Option<String>,
        #[arg(short, long)]
        set: Option<String>,
    },
}

#[derive(PartialEq, Clone, Copy)]
enum LogTab {
    Cms = 0,
    Site = 1,
    Git = 2,
}

enum ModalState {
    None,
    TagPicker { tags: Vec<String>, selected: usize },
    Search { input: String },
}

fn highlight_line(line: &str, query: Option<&str>) -> Line<'static> {
    let base_fg = if line.contains(":err]") || line.contains("Error") || line.contains("ERROR") {
        Color::LightRed
    } else if line.contains("🟢") || line.contains("⚡") || line.contains("🎉") || line.contains("✅") {
        Color::LightGreen
    } else if line.contains("🟡") || line.contains("⚠️") {
        Color::Yellow
    } else {
        Color::White
    };

    if let Some(q) = query {
        if !q.is_empty() {
            let lower_line = line.to_lowercase();
            let lower_q = q.to_lowercase();
            if let Some(idx) = lower_line.find(&lower_q) {
                let match_end = idx + lower_q.len();
                return Line::from(vec![
                    Span::styled(line[..idx].to_string(), Style::default().fg(base_fg)),
                    Span::styled(
                        line[idx..match_end].to_string(),
                        Style::default().fg(Color::Black).bg(Color::Yellow).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(line[match_end..].to_string(), Style::default().fg(base_fg)),
                ]);
            }
        }
    }

    Line::from(Span::styled(line.to_string(), Style::default().fg(base_fg)))
}

fn resolve_paths(cli_cms: &str, cli_site: Option<&str>) -> (PathBuf, Option<PathBuf>) {
    let cms_path = PathBuf::from(cli_cms);
    
    // Auto-detect site dir if sibling exists, or use explicitly provided
    let site_path = if let Some(site) = cli_site {
        let p = PathBuf::from(site);
        if p.exists() {
            Some(p)
        } else {
            // Check sibling
            let sibling = cms_path.parent().map(|p| p.join("brainendeavor.com"));
            if sibling.as_ref().map(|p| p.exists()).unwrap_or(false) {
                sibling
            } else {
                Some(p)
            }
        }
    } else {
        None
    };

    (cms_path, site_path)
}

fn resolve_db_path(explicit_db_path: &Path, cms_path: &Path) -> PathBuf {
    if explicit_db_path.exists() {
        return explicit_db_path.to_path_buf();
    }
    // Auto-discover active SQLite database inside Miniflare D1 state folder
    let d1_dir = cms_path.join(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
    if d1_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&d1_dir) {
            let mut sqlites: Vec<PathBuf> = entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("sqlite"))
                .collect();
            sqlites.sort_by_key(|p| p.metadata().and_then(|m| m.modified()).ok());
            if let Some(latest) = sqlites.pop() {
                return latest;
            }
        }
    }
    explicit_db_path.to_path_buf()
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let content_path = PathBuf::from(&cli.content_dir);
    let (cms_path, site_path) = if cli.no_site {
        (PathBuf::from(&cli.cms_dir), None)
    } else {
        resolve_paths(&cli.cms_dir, cli.site_dir.as_deref())
    };
    let db_path = resolve_db_path(&PathBuf::from(&cli.db_path), &cms_path);

    if let Some(cmd) = cli.command {
        match cmd {
            Commands::Export => {
                println!("🚀 Exporting SlottD D1 database to: {:?}", content_path);
                let engine = SyncEngine::new(db_path, content_path);
                let count = engine.export_to_disk()?;
                println!("✅ Exported {} documents successfully!", count);
            }
            Commands::Restore { tag } => {
                let git = GitDriver::new(content_path.clone());
                if let Some(ref t) = tag {
                    println!("🏷️ Checking out tag '{}' in content repository...", t);
                    git.checkout_ref(t)?;
                }
                println!("📥 Restoring and loading SlottD D1 database from: {:?}", content_path);
                let engine = SyncEngine::new(db_path, content_path);
                let count = engine.hydrate_from_disk()?;
                println!("🎉 Successfully restored and loaded {} documents into D1!", count);
            }
            Commands::Release { tag, message, push } => {
                let release_tag = tag.unwrap_or_else(|| {
                    format!("release-{}", chrono::Local::now().format("%Y.%m.%d-%H%M"))
                });
                println!("🏷️ Creating release snapshot: {}", release_tag);
                let engine = SyncEngine::new(db_path, content_path.clone());
                let count = engine.export_to_disk()?;
                println!("📦 Snapshot exported ({} documents).", count);

                let git = GitDriver::new(content_path);
                println!("🚀 Committing, tagging, and pushing via SSH...");
                let commit_sha = git.release(&release_tag, &message, push)?;
                println!("✅ Successfully released! Commit SHA: {}", commit_sha);
            }
            Commands::Keyring { key, set } => {
                let store = KeyringStore::default();
                let target_key = key.unwrap_or_else(|| "admin_passphrase".to_string());
                if let Some(secret) = set {
                    store.set_secret(&target_key, &secret)?;
                    println!("🔒 Secret saved to OS Keyring under key: {}", target_key);
                } else {
                    match store.get_secret(&target_key)? {
                        Some(_) => println!("🔑 Key '{}' is present in OS Keyring.", target_key),
                        None => println!("⚠️ Key '{}' not found in OS Keyring.", target_key),
                    }
                }
            }
        }
        return Ok(());
    }

    // Default: Launch Interactive TUI with Dual Process Supervision
    run_tui(content_path, db_path, cms_path, site_path)
}

fn run_tui(
    content_path: PathBuf,
    db_path: PathBuf,
    cms_path: PathBuf,
    site_path: Option<PathBuf>,
) -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let sync_engine = SyncEngine::new(db_path.clone(), content_path.clone());
    let git_driver = GitDriver::new(content_path.clone());

    // Boot Dual Process Supervisor (CMS + Astro site)
    let mut supervisor = DualSupervisor::new(cms_path.clone(), site_path.clone());
    supervisor.start_all();

    let git_logs = Arc::new(Mutex::new(VecDeque::with_capacity(300)));

    // Boot Native Git Execution Bridge on :8788
    let bridge = BridgeServer::new(
        8788,
        content_path.clone(),
        db_path.clone(),
        Arc::clone(&git_logs),
    )
    .with_secondary_logs(Arc::clone(&supervisor.cms.logs));
    let _ = bridge.start();

    let mut log_message = "Ready. [O] Studio (:8787) | [W] Site (:4321) | [/] Search | [↑/↓] Scroll | [Z] Zoom".to_string();
    let mut active_tab = LogTab::Cms;
    let mut modal_state = ModalState::None;
    let mut full_log_mode = false;
    let mut scroll_offset: usize = 0;
    let mut search_query: Option<String> = None;

    loop {
        supervisor.tick();

        let (doc_count, col_count) = match D1Database::open_readonly(db_path.to_str().unwrap()) {
            Ok(db) => db.get_stats().unwrap_or((0, 0)),
            Err(_) => (0, 0),
        };

        let git_status = git_driver.status().unwrap_or_else(|_| slottd_briefcase::GitStatusInfo {
            branch: "unknown".into(),
            remote: "none".into(),
            is_dirty: false,
            dirty_files: vec![],
            unpushed_commits: 0,
        });

        let cms_status = supervisor.cms.status.lock().unwrap().clone();
        let site_status = supervisor.site.as_ref().map(|s| s.status.lock().unwrap().clone());

        terminal.draw(|f| {
            let (chunks, stream_chunk) = if full_log_mode {
                let chunks = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3), // Header [0]
                        Constraint::Length(3), // Tabs [1]
                        Constraint::Min(10),  // Active Tab Content (Full Height) [2]
                        Constraint::Length(3), // Notifications Bar [3]
                        Constraint::Length(3), // Controls Footer [4]
                    ])
                    .split(f.area());
                let stream_chunk = chunks[2];
                (chunks, stream_chunk)
            } else {
                let chunks = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(3), // Header [0]
                        Constraint::Length(8), // Dual Services, Paths & Page Telemetry Panel [1]
                        Constraint::Length(3), // Visual Tabs Bar [2]
                        Constraint::Min(8),   // Active Tab Content (Fills remaining height) [3]
                        Constraint::Length(3), // Notifications Bar [4]
                        Constraint::Length(3), // Controls Footer [5]
                    ])
                    .split(f.area());
                let stream_chunk = chunks[3];
                (chunks, stream_chunk)
            };

            // 1. Header
            let header = Paragraph::new(Line::from(vec![
                Span::styled("  🧳 SlottD Briefcase ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                Span::raw("— Local Edge CMS & Astro Development Command Center"),
            ]))
            .block(Block::default().borders(Borders::ALL).title("SlottD Command Center"));
            f.render_widget(header, chunks[0]);

            // 2. Services, Paths & Status Panel (if not in full log mode)
            if !full_log_mode {
                let cms_badge = match cms_status {
                    ServiceStatus::Running { pid, port } => {
                        Span::styled(format!("🟢 Running (PID: {}, Port: {})", pid, port), Style::default().fg(Color::LightGreen))
                    }
                    ServiceStatus::Starting => Span::styled("🟡 Starting...", Style::default().fg(Color::Yellow)),
                    ServiceStatus::WaitingForDependency(ref dep) => {
                        Span::styled(format!("🟡 Waiting for {}...", dep), Style::default().fg(Color::Yellow))
                    }
                    ServiceStatus::Stopped => Span::styled("⚪ Stopped", Style::default().fg(Color::DarkGray)),
                    ServiceStatus::Error(ref err) => Span::styled(format!("🔴 Error: {}", err), Style::default().fg(Color::LightRed)),
                };

                let site_badge = match site_status {
                    Some(ServiceStatus::Running { pid, port }) => {
                        Span::styled(format!("🟢 Running (PID: {}, Port: {})", pid, port), Style::default().fg(Color::LightGreen))
                    }
                    Some(ServiceStatus::Starting) => Span::styled("🟡 Starting...", Style::default().fg(Color::Yellow)),
                    Some(ServiceStatus::WaitingForDependency(ref dep)) => {
                        Span::styled(format!("🟡 Waiting for {}...", dep), Style::default().fg(Color::Yellow))
                    }
                    Some(ServiceStatus::Stopped) => Span::styled("⚪ Stopped", Style::default().fg(Color::DarkGray)),
                    Some(ServiceStatus::Error(ref err)) => Span::styled(format!("🔴 Error: {}", err), Style::default().fg(Color::LightRed)),
                    None => Span::styled("⚪ Disabled (--no-site)", Style::default().fg(Color::DarkGray)),
                };

                let site_display_path = site_path.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| "None".to_string());

                let (cms_reqs, cms_avg_ms, last_burst_summary, last_page_boundary) = {
                    let logs = supervisor.cms.logs.lock().unwrap();
                    let mut count = 0;
                    let mut total_ms = 0.0;
                    let mut burst = String::new();
                    let mut page_boundary = String::new();
                    for line in logs.iter() {
                        if line.contains("⚡ [SlottD]") {
                            count += 1;
                            if let Some(pos) = line.rfind('(') {
                                if let Some(end_pos) = line[pos..].find("ms)") {
                                    let num_str = &line[pos + 1..pos + end_pos];
                                    if let Ok(ms) = num_str.parse::<f64>() {
                                        total_ms += ms;
                                    }
                                }
                            }
                        }
                        if line.contains("📊 [SlottD Telemetry]") {
                            if let Some(pos) = line.find("Page burst:") {
                                burst = line[pos..].to_string();
                            }
                        }
                        if line.contains("🏁 [SlottD Telemetry]") {
                            if let Some(pos) = line.find("Page '") {
                                page_boundary = line[pos..].to_string();
                            }
                        }
                    }
                    let avg = if count > 0 { total_ms / (count as f64) } else { 0.0 };
                    (count, avg, burst, page_boundary)
                };

                let status_lines = vec![
                    Line::from(vec![
                        Span::styled("SlottD CMS: ", Style::default().fg(Color::Yellow)),
                        cms_badge,
                        Span::raw(format!("  Path: {}", cms_path.to_string_lossy())),
                    ]),
                    Line::from(vec![
                        Span::styled("Astro Site: ", Style::default().fg(Color::Yellow)),
                        site_badge,
                        Span::raw(format!("  Path: {}", site_display_path)),
                    ]),
                    Line::from(vec![
                        Span::styled("Telemetry:  ", Style::default().fg(Color::Yellow)),
                        Span::styled(format!("⚡ {} CMS queries served", cms_reqs), Style::default().fg(Color::Cyan)),
                        Span::raw(format!(" (avg {:.1}ms/query)", cms_avg_ms)),
                        if !last_burst_summary.is_empty() {
                            Span::styled(format!("  |  📊 {}", last_burst_summary), Style::default().fg(Color::LightGreen))
                        } else {
                            Span::raw("")
                        },
                    ]),
                    Line::from(vec![
                        Span::styled("Page Route: ", Style::default().fg(Color::Yellow)),
                        if !last_page_boundary.is_empty() {
                            Span::styled(format!("🏁 {}", last_page_boundary), Style::default().fg(Color::LightCyan))
                        } else {
                            Span::styled("Awaiting first page navigation...", Style::default().fg(Color::DarkGray))
                        },
                    ]),
                    Line::from(vec![
                        Span::styled("Content DB: ", Style::default().fg(Color::Yellow)),
                        Span::raw(format!("{} documents ({} collections)", doc_count, col_count)),
                        Span::raw(" | Git: "),
                        if git_status.is_dirty {
                            Span::styled(format!("⚠️ Dirty ({} uncommitted)", git_status.dirty_files.len()), Style::default().fg(Color::LightRed))
                        } else {
                            Span::styled("✅ Clean", Style::default().fg(Color::LightGreen))
                        },
                        Span::raw(format!(" (Branch: {})", git_status.branch)),
                    ]),
                    Line::from(vec![
                        Span::styled("Quick Link: ", Style::default().fg(Color::Yellow)),
                        Span::raw("[O] Studio: http://localhost:8787/admin  |  [W] Site: http://localhost:4321  |  Git Bridge: :8788"),
                    ]),
                ];
                let status_widget = Paragraph::new(status_lines)
                    .block(Block::default().borders(Borders::ALL).title("Active Services, Paths & Telemetry"));
                f.render_widget(status_widget, chunks[1]);
            }

            // 3. Visual Tabs Bar
            let tab_titles = vec![
                Line::from("[1] SlottD CMS Logs"),
                Line::from("[2] Astro Site Logs"),
                Line::from("[3] Git Content Status"),
            ];
            let tabs_idx = if full_log_mode { 1 } else { 2 };
            let tabs_widget = Tabs::new(tab_titles)
                .block(Block::default().borders(Borders::ALL).title("Select Log View ([1], [2], [3] or [Tab])"))
                .select(active_tab as usize)
                .style(Style::default().fg(Color::Gray))
                .highlight_style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD));
            f.render_widget(tabs_widget, chunks[tabs_idx]);

            // 4. Tab Content (or Modal if open) — Scrollable & Searchable
            let available_lines = stream_chunk.height.saturating_sub(2) as usize;

            match modal_state {
                ModalState::TagPicker { ref tags, selected } => {
                    let tag_items: Vec<ListItem> = tags
                        .iter()
                        .enumerate()
                        .map(|(idx, t)| {
                            if idx == selected {
                                ListItem::new(format!(" 👉 [{}] {} (Press Enter to Restore)", idx + 1, t))
                                    .style(Style::default().fg(Color::Green).add_modifier(Modifier::BOLD))
                            } else {
                                ListItem::new(format!("    [{}] {}", idx + 1, t))
                            }
                        })
                        .collect();

                    let picker_widget = List::new(tag_items)
                        .block(Block::default().borders(Borders::ALL).title("🏷️ Select Release Tag to Load/Restore (Up/Down + Enter, [Esc] to cancel)"));
                    f.render_widget(picker_widget, stream_chunk);
                }
                _ => {
                    // Gather raw lines for the active tab
                    let raw_lines: Vec<String> = match active_tab {
                        LogTab::Cms => {
                            let logs = supervisor.cms.logs.lock().unwrap();
                            logs.iter().cloned().collect()
                        }
                        LogTab::Site => {
                            if let Some(ref s) = supervisor.site {
                                let logs = s.logs.lock().unwrap();
                                logs.iter().cloned().collect()
                            } else {
                                vec!["No Astro site configured.".to_string()]
                            }
                        }
                        LogTab::Git => {
                            let mut lines = Vec::new();
                            lines.push(format!(
                                "🌿 Branch: {}  |  Remote: {}  |  Unpushed: {} commit(s)",
                                git_status.branch, git_status.remote, git_status.unpushed_commits
                            ));
                            if git_status.is_dirty {
                                lines.push(format!(
                                    "⚠️ Working tree has {} uncommitted change(s):",
                                    git_status.dirty_files.len()
                                ));
                                for f in &git_status.dirty_files {
                                    lines.push(format!("   {}", f));
                                }
                            } else {
                                lines.push("✅ Working tree clean. All content synchronized with Git remote.".to_string());
                            }
                            lines.push("──────────────────────────────────────────────────────────────────────────".to_string());
                            lines.push("📜 Git Operations & Bridge Activity Log:".to_string());

                            let logs = git_logs.lock().unwrap();
                            if logs.is_empty() {
                                lines.push("   (No Git operations recorded yet. Use [R] to release or trigger via Studio UI)".to_string());
                            } else {
                                for l in logs.iter() {
                                    lines.push(format!("   {}", l));
                                }
                            }
                            lines
                        }
                    };

                    // Filter by search query if active
                    let filtered_lines: Vec<String> = if let Some(ref query) = search_query {
                        let q_lower = query.to_lowercase();
                        raw_lines
                            .into_iter()
                            .filter(|line| line.to_lowercase().contains(&q_lower))
                            .collect()
                    } else {
                        raw_lines
                    };

                    let total_lines = filtered_lines.len();
                    let max_scroll = total_lines.saturating_sub(available_lines);
                    let current_scroll = scroll_offset.min(max_scroll);

                    let end = total_lines.saturating_sub(current_scroll);
                    let start = end.saturating_sub(available_lines);

                    let visible_lines = if total_lines == 0 {
                        if search_query.is_some() {
                            vec!["No log lines matched the search query. Press [Esc] to clear filter.".to_string()]
                        } else {
                            vec!["Waiting for process log output...".to_string()]
                        }
                    } else {
                        filtered_lines[start..end].to_vec()
                    };

                    let log_items: Vec<ListItem> = visible_lines
                        .into_iter()
                        .map(|line| ListItem::new(highlight_line(&line, search_query.as_deref())))
                        .collect();

                    let stream_title = {
                        let mut parts = Vec::new();
                        if full_log_mode {
                            parts.push("Full Height [Z: toggle]".to_string());
                        }
                        if let Some(ref q) = search_query {
                            parts.push(format!("🔍 Filter: \"{}\" ({} matches) [Esc to clear]", q, total_lines));
                        }
                        if current_scroll > 0 {
                            parts.push(format!("📜 Scrolled {} lines up [G / End: auto-follow]", current_scroll));
                        } else {
                            parts.push("⚡ Live Stream (Auto-follow ON)".to_string());
                        }
                        format!("Active Stream ── {}", parts.join(" | "))
                    };

                    let list_widget = List::new(log_items)
                        .block(Block::default().borders(Borders::ALL).title(stream_title));
                    f.render_widget(list_widget, stream_chunk);
                }
            }

            // 5. Notification Bar / Search Input Prompt
            let notif_idx = if full_log_mode { 3 } else { 4 };
            let notif_widget = match modal_state {
                ModalState::Search { ref input } => {
                    Paragraph::new(Line::from(vec![
                        Span::styled(" 🔍 Search logs: ", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
                        Span::styled(input.clone(), Style::default().fg(Color::White).add_modifier(Modifier::BOLD)),
                        Span::styled("█", Style::default().fg(Color::Yellow)),
                        Span::styled("   [Enter: Apply filter | Esc: Cancel]", Style::default().fg(Color::DarkGray)),
                    ]))
                    .block(Block::default().borders(Borders::ALL).title("Search Stream (live input)"))
                }
                _ => {
                    let display_msg = if let Some(ref q) = search_query {
                        format!("🔍 Filter: \"{}\" (Press [Esc] to clear)  |  {}", q, log_message)
                    } else {
                        log_message.clone()
                    };
                    Paragraph::new(Line::from(Span::styled(display_msg, Style::default().fg(Color::White))))
                        .block(Block::default().borders(Borders::ALL).title("Output & Notifications"))
                }
            };
            f.render_widget(notif_widget, chunks[notif_idx]);

            // 6. Footer Hotkeys
            let footer_idx = if full_log_mode { 4 } else { 5 };
            let zoom_label = if full_log_mode { " Unzoom | " } else { " Zoom | " };
            let footer = Paragraph::new(Line::from(vec![
                Span::styled("[O]", Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
                Span::raw(" Studio | "),
                Span::styled("[W]", Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
                Span::raw(" Site | "),
                Span::styled("[/]", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                Span::raw(" Search | "),
                Span::styled("[↑/↓/PgUp/PgDn]", Style::default().fg(Color::Yellow)),
                Span::raw(" Scroll | "),
                Span::styled("[Z]", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
                Span::raw(zoom_label),
                Span::styled("[E]", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                Span::raw(" Export | "),
                Span::styled("[L]", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                Span::raw(" Restore | "),
                Span::styled("[1-3/Tab]", Style::default().fg(Color::Yellow)),
                Span::raw(" Tabs | "),
                Span::styled("[Q]", Style::default().fg(Color::Red).add_modifier(Modifier::BOLD)),
                Span::raw(" Quit"),
            ]))
            .block(Block::default().borders(Borders::ALL));
            f.render_widget(footer, chunks[footer_idx]);
        })?;

        if event::poll(std::time::Duration::from_millis(300))? {
            if let Event::Key(key) = event::read()? {
                // 1. Handle Search Modal Input
                if let ModalState::Search { ref mut input } = modal_state {
                    match key.code {
                        KeyCode::Esc => {
                            modal_state = ModalState::None;
                            log_message = if let Some(ref q) = search_query {
                                format!("Search edit cancelled. Active filter: \"{}\"", q)
                            } else {
                                "Search cancelled.".to_string()
                            };
                            continue;
                        }
                        KeyCode::Enter => {
                            let query = input.trim().to_string();
                            if query.is_empty() {
                                search_query = None;
                                log_message = "Search filter cleared.".to_string();
                            } else {
                                search_query = Some(query.clone());
                                log_message = format!("Filtering logs by \"{}\". Press [Esc] or [/] to clear.", query);
                            }
                            scroll_offset = 0;
                            modal_state = ModalState::None;
                            continue;
                        }
                        KeyCode::Backspace => {
                            input.pop();
                            continue;
                        }
                        KeyCode::Char(c) => {
                            input.push(c);
                            continue;
                        }
                        _ => {
                            continue;
                        }
                    }
                }

                // 2. Handle TagPicker Modal Input
                if let ModalState::TagPicker { ref tags, ref mut selected } = modal_state {
                    match key.code {
                        KeyCode::Esc => {
                            modal_state = ModalState::None;
                            log_message = "Tag selection cancelled.".to_string();
                            continue;
                        }
                        KeyCode::Up => {
                            if *selected > 0 {
                                *selected -= 1;
                            }
                            continue;
                        }
                        KeyCode::Down => {
                            if *selected + 1 < tags.len() {
                                *selected += 1;
                            }
                            continue;
                        }
                        KeyCode::Enter => {
                            let chosen_tag = tags[*selected].clone();
                            modal_state = ModalState::None;
                            if let Err(e) = git_driver.checkout_ref(&chosen_tag) {
                                log_message = format!("❌ Git checkout error: {}", e);
                            } else {
                                log_message = match sync_engine.hydrate_from_disk() {
                                    Ok(n) => format!("🎉 Successfully restored {} documents from tag '{}'!", n, chosen_tag),
                                    Err(err) => format!("❌ Restore error: {}", err),
                                };
                            }
                            continue;
                        }
                        _ => {}
                    }
                }

                // 3. Normal View Hotkeys
                match key.code {
                    KeyCode::Char('q') => break,
                    KeyCode::Esc => {
                        if search_query.is_some() {
                            search_query = None;
                            scroll_offset = 0;
                            log_message = "Search filter cleared.".to_string();
                        } else {
                            break;
                        }
                    }
                    KeyCode::Char('/') => {
                        modal_state = ModalState::Search {
                            input: search_query.clone().unwrap_or_default(),
                        };
                    }
                    // Scrolling Hotkeys
                    KeyCode::Up | KeyCode::Char('k') => {
                        scroll_offset = scroll_offset.saturating_add(1);
                    }
                    KeyCode::Down | KeyCode::Char('j') => {
                        scroll_offset = scroll_offset.saturating_sub(1);
                    }
                    KeyCode::PageUp => {
                        scroll_offset = scroll_offset.saturating_add(15);
                    }
                    KeyCode::PageDown => {
                        scroll_offset = scroll_offset.saturating_sub(15);
                    }
                    KeyCode::Home | KeyCode::Char('g') => {
                        scroll_offset = usize::MAX / 2;
                    }
                    KeyCode::End | KeyCode::Char('G') => {
                        scroll_offset = 0;
                        log_message = "Jumped to latest logs (auto-follow enabled).".to_string();
                    }
                    // Tab Switching (resets scroll offset for fresh view)
                    KeyCode::Char('1') => {
                        active_tab = LogTab::Cms;
                        scroll_offset = 0;
                    }
                    KeyCode::Char('2') => {
                        active_tab = LogTab::Site;
                        scroll_offset = 0;
                    }
                    KeyCode::Char('3') => {
                        active_tab = LogTab::Git;
                        scroll_offset = 0;
                    }
                    KeyCode::Tab => {
                        active_tab = match active_tab {
                            LogTab::Cms => LogTab::Site,
                            LogTab::Site => LogTab::Git,
                            LogTab::Git => LogTab::Cms,
                        };
                        scroll_offset = 0;
                    }
                    KeyCode::Char('o') => {
                        let _ = open::that("http://localhost:8787/admin");
                        log_message = "Opened SlottD Studio (http://localhost:8787/admin) in default browser.".to_string();
                    }
                    KeyCode::Char('w') => {
                        let _ = open::that("http://localhost:4321");
                        log_message = "Opened Astro Web Site (http://localhost:4321) in default browser.".to_string();
                    }
                    KeyCode::Char('z') => {
                        full_log_mode = !full_log_mode;
                        log_message = if full_log_mode {
                            "Full height log mode enabled. Press [Z] to restore standard dashboard view.".to_string()
                        } else {
                            "Standard dashboard view restored.".to_string()
                        };
                    }
                    KeyCode::Char('e') => {
                        log_message = match sync_engine.export_to_disk() {
                            Ok(n) => format!("✅ Exported {} documents successfully to disk.", n),
                            Err(err) => format!("❌ Export error: {}", err),
                        };
                    }
                    KeyCode::Char('l') => {
                        // Open Tag Picker Modal
                        match git_driver.fetch_tags() {
                            Ok(tags) => {
                                if tags.is_empty() {
                                    // Fallback to direct restore from disk if no tags
                                    log_message = match sync_engine.hydrate_from_disk() {
                                        Ok(n) => format!("🎉 Restored {} documents directly from disk.", n),
                                        Err(err) => format!("❌ Restore error: {}", err),
                                    };
                                } else {
                                    modal_state = ModalState::TagPicker { tags, selected: 0 };
                                    log_message = "Select a release tag with Up/Down and press Enter to restore.".to_string();
                                }
                            }
                            Err(e) => {
                                log_message = format!("❌ Failed to fetch tags: {}", e);
                            }
                        }
                    }
                    KeyCode::Char('r') => {
                        let release_tag = format!("release-{}", chrono::Local::now().format("%Y.%m.%d-%H%M"));
                        log_message = match sync_engine.export_to_disk() {
                            Ok(n) => {
                                {
                                    let mut g = git_logs.lock().unwrap();
                                    g.push_back(format!("📦 [TUI Hotkey] Exported {} documents to disk.", n));
                                }
                                match git_driver.release(&release_tag, &format!("chore(content): release {}", release_tag), true) {
                                    Ok(sha) => {
                                        let msg = format!("🚀 Released and pushed! Commit: {} (Tag: {})", sha, release_tag);
                                        let mut g = git_logs.lock().unwrap();
                                        g.push_back(format!("✅ [TUI Hotkey] {}", msg));
                                        msg
                                    }
                                    Err(err) => {
                                        let msg = format!("❌ Git push error: {}", err);
                                        let mut g = git_logs.lock().unwrap();
                                        g.push_back(msg.clone());
                                        msg
                                    }
                                }
                            }
                            Err(err) => {
                                let msg = format!("❌ Export error: {}", err);
                                let mut g = git_logs.lock().unwrap();
                                g.push_back(msg.clone());
                                msg
                            }
                        };
                    }
                    _ => {}
                }
            }
        }
    }

    // Clean exit: kill all background services (workerd, vite, node)
    supervisor.stop_all();
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
