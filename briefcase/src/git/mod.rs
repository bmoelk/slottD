use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GitStatusInfo {
    pub branch: String,
    pub remote: String,
    pub is_dirty: bool,
    pub dirty_files: Vec<String>,
    pub unpushed_commits: usize,
    #[serde(default)]
    pub divergence: Option<DivergenceInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DivergenceInfo {
    pub export_branch: String,
    pub target_branch: String,
    pub ahead_count: usize,
    pub behind_count: usize,
    pub pending_files: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RebaseOutcome {
    pub success: bool,
    pub has_conflicts: bool,
    pub conflicting_files: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum DeployReadinessLevel {
    /// Level 1: Safe & Clean. Local workstation and origin/main are in sync.
    Safe,
    /// Level 2: Informational. Single-user standalone or non-conflicting background rebuild.
    Notice,
    /// Level 3: Strong Warning with explicit consequences. Diverged state in mixed mode.
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DeployReadiness {
    pub level: DeployReadinessLevel,
    pub allowed: bool,
    pub is_mixed_mode: bool,
    pub unpushed_commits: usize,
    pub unpulled_commits: usize,
    pub unreleased_edits: usize,
    pub message: String,
    pub consequences: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TagDetails {
    pub tag: String,
    pub commit_sha: Option<String>,
    pub message: String,
    pub author: Option<String>,
    pub date: Option<String>,
}

pub struct GitDriver {
    repo_path: PathBuf,
    remote_url: Option<String>,
    branch: String,
    content_subpath: String,
    site_id: Option<String>,
}

struct TempDirGuard(PathBuf);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

impl GitDriver {
    pub fn new(repo_path: PathBuf) -> Self {
        Self {
            repo_path,
            remote_url: None,
            branch: "main".to_string(),
            content_subpath: "content".to_string(),
            site_id: None,
        }
    }

    pub fn repo_path(&self) -> &Path {
        &self.repo_path
    }

    pub fn has_local_git(&self) -> bool {
        self.repo_path.join(".git").exists()
    }

    pub fn with_remote(mut self, remote_url: Option<String>) -> Self {
        self.remote_url = remote_url;
        self
    }

    pub fn with_branch(mut self, branch: String) -> Self {
        self.branch = branch;
        self
    }

    pub fn with_content_subpath(mut self, subpath: String) -> Self {
        self.content_subpath = subpath;
        self
    }

    pub fn with_site_id(mut self, site_id: Option<String>) -> Self {
        self.site_id = site_id;
        self
    }

    pub fn resolve_remote_url(&self) -> Option<String> {
        if let Some(ref r) = self.remote_url {
            let trimmed = r.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        let remote_out = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "remote", "get-url", "origin"])
            .output()
            .ok()?;
        if remote_out.status.success() {
            let r = String::from_utf8_lossy(&remote_out.stdout).trim().to_string();
            if !r.is_empty() {
                return Some(r);
            }
        }
        None
    }

    /// Returns the standardized local export branch name for this site or branch.
    /// e.g. "briefcase/splitphase.io" or "briefcase/main".
    pub fn export_branch_name(&self) -> String {
        if let Some(ref s) = self.site_id {
            let clean = s.trim().to_lowercase().replace(' ', "-");
            if !clean.is_empty() {
                return format!("briefcase/{}", clean);
            }
        }
        format!("briefcase/{}", self.branch)
    }

    /// Ensures the local export branch exists in the repository.
    /// If missing, creates it from self.branch or HEAD without switching branches.
    pub fn ensure_export_branch(&self) -> Result<String> {
        let repo_str = self.repo_path.to_str().ok_or_else(|| anyhow::anyhow!("Invalid repo_path"))?;
        let export_branch = self.export_branch_name();

        let check = Command::new("git")
            .args(["-C", repo_str, "rev-parse", "--verify", &format!("refs/heads/{}", export_branch)])
            .output();

        if let Ok(c) = check {
            if c.status.success() {
                return Ok(export_branch);
            }
        }

        // Try creating from self.branch if it exists
        let create_res = Command::new("git")
            .args(["-C", repo_str, "branch", &export_branch, &self.branch])
            .output();

        match create_res {
            Ok(o) if o.status.success() => Ok(export_branch),
            _ => {
                // Fallback: try creating from HEAD
                let head_res = Command::new("git")
                    .args(["-C", repo_str, "branch", &export_branch, "HEAD"])
                    .output()?;
                if head_res.status.success() {
                    Ok(export_branch)
                } else {
                    anyhow::bail!(
                        "Failed to create local export branch '{}': {}",
                        export_branch,
                        String::from_utf8_lossy(&head_res.stderr)
                    );
                }
            }
        }
    }

    /// Computes divergence telemetry between the local export branch and target upstream branch.
    pub fn get_divergence(&self) -> Result<DivergenceInfo> {
        let repo_str = self.repo_path.to_str().ok_or_else(|| anyhow::anyhow!("Invalid repo_path"))?;
        let export_branch = self.export_branch_name();
        let target_branch = self.branch.clone();

        let branch_exists = Command::new("git")
            .args(["-C", repo_str, "rev-parse", "--verify", &format!("refs/heads/{}", export_branch)])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if !branch_exists {
            return Ok(DivergenceInfo {
                export_branch,
                target_branch,
                ahead_count: 0,
                behind_count: 0,
                pending_files: Vec::new(),
            });
        }

        let remote_ref = format!("origin/{}", target_branch);
        let has_remote_ref = Command::new("git")
            .args(["-C", repo_str, "rev-parse", "--verify", &remote_ref])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        let base_ref = if has_remote_ref {
            remote_ref
        } else {
            target_branch.clone()
        };

        let ahead_out = Command::new("git")
            .args(["-C", repo_str, "rev-list", "--count", &format!("{}..{}", base_ref, export_branch)])
            .output();
        let ahead_count = ahead_out
            .ok()
            .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<usize>().ok())
            .unwrap_or(0);

        let behind_out = Command::new("git")
            .args(["-C", repo_str, "rev-list", "--count", &format!("{}..{}", export_branch, base_ref)])
            .output();
        let behind_count = behind_out
            .ok()
            .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<usize>().ok())
            .unwrap_or(0);

        let diff_out = Command::new("git")
            .args(["-C", repo_str, "diff", "--name-only", &format!("{}...{}", base_ref, export_branch)])
            .output();
        let pending_files = diff_out
            .ok()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        Ok(DivergenceInfo {
            export_branch,
            target_branch,
            ahead_count,
            behind_count,
            pending_files,
        })
    }

    /// Extracts unmerged/conflicting files from `git status --porcelain`.
    pub fn detect_conflicting_files(repo_str: &str) -> Vec<String> {
        let status_out = Command::new("git")
            .args(["-C", repo_str, "status", "--porcelain"])
            .output();

        if let Ok(out) = status_out {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .filter(|line| {
                    line.starts_with("UU ")
                        || line.starts_with("AA ")
                        || line.starts_with("UD ")
                        || line.starts_with("DU ")
                        || line.starts_with("DD ")
                        || line.starts_with("AU ")
                        || line.starts_with("UA ")
                })
                .map(|line| line[3..].trim().to_string())
                .collect()
        } else {
            Vec::new()
        }
    }

    /// Fetches upstream and rebases the local export branch onto origin/<target_branch>.
    pub fn rebase_export_branch(&self) -> Result<RebaseOutcome> {
        let repo_str = self.repo_path.to_str().ok_or_else(|| anyhow::anyhow!("Invalid repo_path"))?;
        let export_branch = self.ensure_export_branch()?;
        let target_branch = &self.branch;

        // 1. Fetch remote if available
        let _ = Command::new("git")
            .args(["-C", repo_str, "fetch", "origin", target_branch])
            .output();

        // 2. Checkout the export branch
        let checkout_res = Command::new("git")
            .args(["-C", repo_str, "checkout", &export_branch])
            .output()
            .context("Failed to checkout export branch before rebase")?;
        if !checkout_res.status.success() {
            anyhow::bail!(
                "Failed to checkout export branch '{}': {}",
                export_branch,
                String::from_utf8_lossy(&checkout_res.stderr)
            );
        }

        // 3. Determine rebase target (origin/main if exists, else main)
        let remote_ref = format!("origin/{}", target_branch);
        let has_remote = Command::new("git")
            .args(["-C", repo_str, "rev-parse", "--verify", &remote_ref])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        let rebase_target = if has_remote {
            remote_ref.as_str()
        } else {
            target_branch.as_str()
        };

        // 4. Run git rebase
        let rebase_res = Command::new("git")
            .args(["-C", repo_str, "rebase", rebase_target])
            .output()
            .context("Failed to execute git rebase")?;

        if rebase_res.status.success() {
            return Ok(RebaseOutcome {
                success: true,
                has_conflicts: false,
                conflicting_files: Vec::new(),
                message: format!("Successfully rebased '{}' onto '{}'", export_branch, rebase_target),
            });
        }

        // Rebase failed or halted due to conflict
        let conflicting_files = Self::detect_conflicting_files(repo_str);
        let has_conflicts = !conflicting_files.is_empty();

        let stderr_msg = String::from_utf8_lossy(&rebase_res.stderr).to_string();
        let stdout_msg = String::from_utf8_lossy(&rebase_res.stdout).to_string();
        let message = if has_conflicts {
            format!("Rebase halted with {} conflicting file(s)", conflicting_files.len())
        } else {
            format!("Rebase failed: {}{}", stderr_msg, stdout_msg)
        };

        Ok(RebaseOutcome {
            success: false,
            has_conflicts,
            conflicting_files,
            message,
        })
    }

    /// Continues an in-progress rebase after conflicts have been resolved and staged.
    pub fn rebase_continue(&self) -> Result<RebaseOutcome> {
        let repo_str = self.repo_path.to_str().ok_or_else(|| anyhow::anyhow!("Invalid repo_path"))?;

        // GIT_EDITOR=true to auto-accept default rebase commit messages
        let mut cmd = Command::new("git");
        cmd.args(["-C", repo_str, "rebase", "--continue"]);
        cmd.env("GIT_EDITOR", "true");

        let res = cmd.output().context("Failed to execute git rebase --continue")?;
        if res.status.success() {
            return Ok(RebaseOutcome {
                success: true,
                has_conflicts: false,
                conflicting_files: Vec::new(),
                message: "Rebase continued and completed cleanly.".to_string(),
            });
        }

        let conflicting_files = Self::detect_conflicting_files(repo_str);
        let has_conflicts = !conflicting_files.is_empty();
        let stderr_msg = String::from_utf8_lossy(&res.stderr).to_string();

        Ok(RebaseOutcome {
            success: false,
            has_conflicts,
            conflicting_files,
            message: format!("Rebase continue halted: {}", stderr_msg),
        })
    }

    /// Aborts an in-progress rebase and resets to pre-rebase HEAD.
    pub fn rebase_abort(&self) -> Result<()> {
        let repo_str = self.repo_path.to_str().ok_or_else(|| anyhow::anyhow!("Invalid repo_path"))?;
        let res = Command::new("git")
            .args(["-C", repo_str, "rebase", "--abort"])
            .output()
            .context("Failed to execute git rebase --abort")?;
        if !res.status.success() {
            anyhow::bail!("git rebase --abort failed: {}", String::from_utf8_lossy(&res.stderr));
        }
        Ok(())
    }

    /// Fast-forwards remote target_branch from the rebased export_branch,
    /// advances local target_branch, and tags if requested.
    /// Strictly NEVER pushes export_branch as a remote branch.
    pub fn push_rebased_to_main(
        &self,
        tag: Option<&str>,
        message: Option<&str>,
        push: bool,
        force: bool,
    ) -> Result<String> {
        let repo_str = self.repo_path.to_str().ok_or_else(|| anyhow::anyhow!("Invalid repo_path"))?;
        let export_branch = self.export_branch_name();
        let target_branch = &self.branch;

        // 1. Get HEAD commit of export_branch
        let rev_out = Command::new("git")
            .args(["-C", repo_str, "rev-parse", &export_branch])
            .output()
            .context("Failed to resolve export branch commit")?;
        if !rev_out.status.success() {
            anyhow::bail!("Cannot push: export branch '{}' has no commit", export_branch);
        }
        let commit_sha = String::from_utf8_lossy(&rev_out.stdout).trim().to_string();

        // 2. Advance local target_branch to match export_branch
        let branch_update = Command::new("git")
            .args(["-C", repo_str, "branch", "-f", target_branch, &export_branch])
            .output();
        if let Err(e) = branch_update {
            anyhow::bail!("Failed to advance local '{}' branch: {}", target_branch, e);
        }

        // 3. Create tag on target_branch if tag name provided
        if let Some(tag_name) = tag {
            let msg = message.unwrap_or(tag_name);
            let tag_res = Command::new("git")
                .args(["-C", repo_str, "tag", "-a", tag_name, "-m", msg, &commit_sha])
                .output();
            if let Ok(ref t) = tag_res {
                if !t.status.success() {
                    // Tag might already exist
                }
            }
        }

        // 4. Push export_branch:target_branch to origin
        if push {
            let push_ref = format!("{}:{}", export_branch, target_branch);
            let mut push_args = vec!["-C", repo_str, "push"];
            if force {
                push_args.push("--force-with-lease");
            }
            push_args.push("origin");
            push_args.push(&push_ref);

            let push_res = Command::new("git")
                .args(&push_args)
                .output()
                .context("Failed to push to remote origin")?;

            if !push_res.status.success() {
                anyhow::bail!("git push to origin failed: {}", String::from_utf8_lossy(&push_res.stderr));
            }

            // Push tags if tag created
            if let Some(tag_name) = tag {
                let tag_ref = format!("refs/tags/{}", tag_name);
                let _ = Command::new("git")
                    .args(["-C", repo_str, "push", "origin", &tag_ref])
                    .output();
            }
        }

        Ok(commit_sha)
    }

    /// Evaluates deployment readiness based on environment mode and divergence.
    ///
    /// Single-user standalone mode is 100% frictionless (never blocks).
    /// Mixed mode with clean remote is also completely safe.
    /// Mixed mode with divergence triggers a Level 3 consequence warning unless force=true.
    pub fn check_deploy_readiness(
        &self,
        is_mixed_mode: bool,
        unreleased_edits: usize,
        force: bool,
    ) -> Result<DeployReadiness> {
        let export_branch = self.export_branch_name();
        let divergence = self.get_divergence().unwrap_or(DivergenceInfo {
            export_branch,
            target_branch: self.branch.clone(),
            ahead_count: 0,
            behind_count: 0,
            pending_files: Vec::new(),
        });

        let unpushed_commits = divergence.ahead_count;
        let unpulled_commits = divergence.behind_count;
        let is_diverged = unpushed_commits > 0 || unpulled_commits > 0 || unreleased_edits > 0;

        // 1. Single-user standalone mode: 100% Frictionless
        if !is_mixed_mode {
            return Ok(DeployReadiness {
                level: DeployReadinessLevel::Safe,
                allowed: true,
                is_mixed_mode: false,
                unpushed_commits,
                unpulled_commits,
                unreleased_edits,
                message: "Standalone single-user mode: direct deployment allowed frictionlessly.".to_string(),
                consequences: Vec::new(),
            });
        }

        // 2. Mixed mode: Clean state (ahead == 0 && behind == 0 && unreleased == 0)
        if !is_diverged {
            return Ok(DeployReadiness {
                level: DeployReadinessLevel::Safe,
                allowed: true,
                is_mixed_mode: true,
                unpushed_commits: 0,
                unpulled_commits: 0,
                unreleased_edits: 0,
                message: "Mixed mode clean: local state is fully synchronized with origin/main.".to_string(),
                consequences: Vec::new(),
            });
        }

        // 3. Mixed mode: Diverged state
        let mut consequences = Vec::new();
        consequences.push("Production will be deployed with local unpushed workstation files.".to_string());
        consequences.push("Remote Web CMS editors and other team members will be out of sync.".to_string());
        consequences.push("Production site content will differ from what is committed to Git.".to_string());

        let warning_message = format!(
            "Local state and origin/{} are out of sync: {} unpushed commit(s), {} unpulled commit(s), {} unreleased edit(s).",
            self.branch, unpushed_commits, unpulled_commits, unreleased_edits
        );

        if force {
            Ok(DeployReadiness {
                level: DeployReadinessLevel::Warning,
                allowed: true,
                is_mixed_mode: true,
                unpushed_commits,
                unpulled_commits,
                unreleased_edits,
                message: format!("FORCE OVERRIDE: Proceeding with deployment despite divergence. {}", warning_message),
                consequences,
            })
        } else {
            Ok(DeployReadiness {
                level: DeployReadinessLevel::Warning,
                allowed: false,
                is_mixed_mode: true,
                unpushed_commits,
                unpulled_commits,
                unreleased_edits,
                message: warning_message,
                consequences,
            })
        }
    }

    /// Inspects status of the Git repository.
    pub fn status(&self) -> Result<GitStatusInfo> {
        let branch_out = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "branch", "--show-current"])
            .output()
            .context("Failed to get current git branch")?;
        let branch = String::from_utf8_lossy(&branch_out.stdout).trim().to_string();

        let remote_out = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "remote", "get-url", "origin"])
            .output()
            .unwrap_or_else(|_| std::process::Output {
                status: Default::default(),
                stdout: Vec::new(),
                stderr: Vec::new(),
            });
        let remote = String::from_utf8_lossy(&remote_out.stdout).trim().to_string();

        let status_out = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "status", "-s"])
            .output()
            .context("Failed to get git status")?;
        let status_text = String::from_utf8_lossy(&status_out.stdout);
        let dirty_files: Vec<String> = status_text
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        let is_dirty = !dirty_files.is_empty();

        let unpushed_out = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "rev-list", "--count", "@{u}..HEAD"])
            .output()
            .unwrap_or_else(|_| std::process::Output {
                status: Default::default(),
                stdout: b"0\n".to_vec(),
                stderr: Vec::new(),
            });
        let unpushed_commits = String::from_utf8_lossy(&unpushed_out.stdout)
            .trim()
            .parse::<usize>()
            .unwrap_or(0);

        let divergence = self.get_divergence().ok();

        Ok(GitStatusInfo {
            branch,
            remote,
            is_dirty,
            dirty_files,
            unpushed_commits,
            divergence,
        })
    }

    /// Detects if this repository path is a subdirectory inside a parent monorepo.
    pub fn detect_monorepo(&self) -> (bool, Option<PathBuf>) {
        let out = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "rev-parse", "--show-toplevel"])
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                let toplevel = PathBuf::from(String::from_utf8_lossy(&o.stdout).trim());
                if toplevel != self.repo_path && self.repo_path.starts_with(&toplevel) {
                    return (true, Some(toplevel));
                }
            }
        }
        (false, None)
    }

    /// Releases by creating an isolated temporary clone of the remote repository,
    /// exporting database documents into content_subpath, committing, tagging, and pushing.
    /// The host working directory / monorepo is NEVER modified.
    pub fn release_via_temp(
        &self,
        db_path: &Path,
        tag: &str,
        message: &str,
        push: bool,
    ) -> Result<String> {
        let site_id = self.site_id.as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| anyhow::anyhow!("site_id is required for Git release operations; the 'default' site concept has been abolished."))?;

        let remote_url = self.resolve_remote_url();

        // Step 1: Create a temp location, git init, add the remote, clone the repo
        let temp_dir_path = std::env::temp_dir().join(format!(
            "slottd-release-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_else(|| chrono::Utc::now().timestamp_millis() * 1_000_000)
        ));
        std::fs::create_dir_all(&temp_dir_path)
            .context("Failed to create temporary directory for release")?;
        let _guard = TempDirGuard(temp_dir_path.clone());
        let temp_str = temp_dir_path.to_str().unwrap();

        // If self.repo_path exists and is a valid git repository, clone locally from it
        if self.repo_path.join(".git").exists() {
            let clone_res = Command::new("git")
                .args(["clone", self.repo_path.to_str().unwrap(), temp_str])
                .output()
                .context("Failed to clone local repository into temp directory")?;
            if !clone_res.status.success() {
                anyhow::bail!("Local git clone failed: {}", String::from_utf8_lossy(&clone_res.stderr));
            }
            if let Some(ref url) = remote_url {
                let _ = Command::new("git")
                    .args(["-C", temp_str, "remote", "set-url", "origin", url])
                    .output();
            }
            let _ = Command::new("git")
                .args(["-C", temp_str, "checkout", "-B", &self.branch])
                .output();
        } else if let Some(ref url) = remote_url {
            let mut cloned = false;
            let clone_res = Command::new("git")
                .args(["clone", "--depth", "1", "--branch", &self.branch, url, temp_str])
                .output();
            if let Ok(ref o) = clone_res {
                if o.status.success() {
                    cloned = true;
                }
            }

            if !cloned {
                let full_clone = Command::new("git")
                    .args(["clone", url, temp_str])
                    .output();
                if let Ok(ref o) = full_clone {
                    if o.status.success() {
                        cloned = true;
                    }
                }
            }

            if !cloned {
                Command::new("git").args(["init", temp_str]).output()
                    .context("Failed to init git in temp directory")?;
                Command::new("git")
                    .args(["-C", temp_str, "remote", "add", "origin", url])
                    .output()
                    .context("Failed to add remote in temp directory")?;
                let _ = Command::new("git")
                    .args(["-C", temp_str, "checkout", "-b", &self.branch])
                    .output();
            }
        } else {
            Command::new("git").args(["init", temp_str]).output()
                .context("Failed to init git in temp directory")?;
            let _ = Command::new("git")
                .args(["-C", temp_str, "checkout", "-b", &self.branch])
                .output();
        }

        // Step 2: Export files into that location
        let target_content = if self.content_subpath.is_empty() {
            temp_dir_path.clone()
        } else {
            temp_dir_path.join(&self.content_subpath)
        };
        let sync_engine = crate::sync::SyncEngine::new(db_path.to_path_buf(), target_content, Some(site_id.to_string()))?;
        let _ = sync_engine.export_to_disk()
            .context("Failed to export database documents into temp release location")?;

        // Step 3: Create tag and push to the remote
        let add_res = Command::new("git")
            .args(["-C", temp_str, "add", "-A"])
            .output()
            .context("Failed to git add in temp release location")?;
        if !add_res.status.success() {
            anyhow::bail!("git add failed: {}", String::from_utf8_lossy(&add_res.stderr));
        }

        let commit_res = Command::new("git")
            .args(["-C", temp_str, "commit", "-m", message])
            .output()
            .context("Failed to execute git commit in temp release location")?;

        // Verify HEAD exists (either created by commit or existed from base repo)
        let head_check = Command::new("git")
            .args(["-C", temp_str, "rev-parse", "--verify", "HEAD"])
            .output()?;
        if !head_check.status.success() {
            anyhow::bail!(
                "Cannot tag release: No commits exist in repository and git commit produced no changes: stdout: {}, stderr: {}",
                String::from_utf8_lossy(&commit_res.stdout).trim(),
                String::from_utf8_lossy(&commit_res.stderr).trim()
            );
        }

        let tag_res = Command::new("git")
            .args(["-C", temp_str, "tag", "-a", tag, "-m", message])
            .output()
            .context("Failed to create git tag")?;
        if !tag_res.status.success() {
            anyhow::bail!("git tag failed: {}", String::from_utf8_lossy(&tag_res.stderr));
        }

        if push && remote_url.is_some() {
            let tag_ref = format!("refs/tags/{}", tag);
            let push_res = Command::new("git")
                .args(["-C", temp_str, "push", "origin", &self.branch, &tag_ref])
                .output()
                .context("Failed to push git commit and tag from temp release location")?;
            if !push_res.status.success() {
                anyhow::bail!("git push failed: {}", String::from_utf8_lossy(&push_res.stderr));
            }

            // Sync back to local content repo if it exists so operator's working tree stays updated
            if self.repo_path.join(".git").exists() {
                let _ = Command::new("git")
                    .args(["-C", self.repo_path.to_str().unwrap(), "fetch", "origin"])
                    .output();
            }
        }

        let rev_out = Command::new("git")
            .args(["-C", temp_str, "rev-parse", "--short", "HEAD"])
            .output()?;
        let commit_sha = String::from_utf8_lossy(&rev_out.stdout).trim().to_string();

        if let Ok(db) = crate::db::D1Database::open(db_path.to_str().unwrap()) {
            let act = crate::db::ActivityRecord {
                id: format!("act_{}", chrono::Utc::now().timestamp_millis()),
                site_id: site_id.to_string(),
                timestamp: chrono::Utc::now().timestamp_millis(),
                actor: "briefcase@localhost".to_string(),
                action: "git_release".to_string(),
                collection: "_git".to_string(),
                document_id: tag.to_string(),
                document_title: Some(format!("Release {}", tag)),
                details: Some(json!({
                    "tag": tag,
                    "commitSha": commit_sha,
                    "branch": self.branch,
                    "pushed": push,
                }).to_string()),
            };
            let _ = db.insert_activity_if_not_exists(&act);
        }

        Ok(commit_sha)
    }

    /// Exports database documents directly into the declared local content repository,
    /// stages changes, commits, tags, and pushes directly from that local working tree.
    /// The local repository advances its HEAD and stays 100% in sync with remote.
    pub fn release_direct(
        &self,
        db_path: &Path,
        tag: &str,
        message: &str,
        push: bool,
        force: bool,
    ) -> Result<String> {
        let site_id = self.site_id.as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| anyhow::anyhow!("site_id is required for Git release operations; the 'default' site concept has been abolished."))?;

        let repo_str = self.repo_path.to_str().ok_or_else(|| anyhow::anyhow!("Invalid repo_path"))?;

        if !self.repo_path.join(".git").exists() {
            anyhow::bail!("Declared repository path '{}' is not a valid git repository (.git directory missing).", repo_str);
        }

        // 0. Pre-Release Upstream Drift Detection
        if push {
            let fetch_out = Command::new("git")
                .args(["-C", repo_str, "fetch", "origin", &self.branch])
                .output();
            if let Ok(f) = fetch_out {
                if f.status.success() {
                    let rev_out = Command::new("git")
                        .args(["-C", repo_str, "rev-list", "--count", &format!("HEAD..origin/{}", self.branch)])
                        .output();
                    if let Ok(r) = rev_out {
                        let behind_count = String::from_utf8_lossy(&r.stdout)
                            .trim()
                            .parse::<usize>()
                            .unwrap_or(0);
                        if behind_count > 0 {
                            let diff_out = Command::new("git")
                                .args(["-C", repo_str, "diff", "--name-only", &format!("HEAD..origin/{}", self.branch)])
                                .output();
                            let diff_files = if let Ok(d) = diff_out {
                                String::from_utf8_lossy(&d.stdout)
                                    .lines()
                                    .map(|s| s.trim().to_string())
                                    .filter(|s| !s.is_empty())
                                    .collect::<Vec<String>>()
                            } else {
                                Vec::new()
                            };

                            let content_prefix = if self.content_subpath.is_empty() {
                                ""
                            } else {
                                self.content_subpath.as_str()
                            };

                            let conflicting_files: Vec<String> = diff_files
                                .iter()
                                .filter(|f| {
                                    let matches_subpath = content_prefix.is_empty() || f.starts_with(content_prefix);
                                    let is_content = f.ends_with(".json") || f.ends_with(".md");
                                    matches_subpath && is_content
                                })
                                .cloned()
                                .collect();

                            if !conflicting_files.is_empty() && !force {
                                anyhow::bail!(
                                    "UPSTREAM_CONFLICT: Upstream changes detected in {} conflicting document(s): {:?}",
                                    conflicting_files.len(),
                                    conflicting_files
                                );
                            }

                            if conflicting_files.is_empty() {
                                // Disjoint changes: auto fast-forward
                                let _ = Command::new("git")
                                    .args(["-C", repo_str, "merge", "--ff-only", &format!("origin/{}", self.branch)])
                                    .output();
                            }
                        }
                    }
                }
            }
        }

        // 1. Export documents directly into the configured content directory
        let target_content = if self.content_subpath.is_empty() {
            self.repo_path.clone()
        } else {
            self.repo_path.join(&self.content_subpath)
        };
        std::fs::create_dir_all(&target_content)
            .context("Failed to ensure target content directory exists in local repository")?;

        let sync_engine = crate::sync::SyncEngine::new(db_path.to_path_buf(), target_content, Some(site_id.to_string()))?;
        sync_engine.export_to_disk()
            .context("Failed to export database documents into local repository")?;

        // 2. Stage changes
        let add_res = Command::new("git")
            .args(["-C", repo_str, "add", "-A"])
            .output()
            .context("Failed to stage changes in local repository")?;
        if !add_res.status.success() {
            anyhow::bail!("git add failed in local repository: {}", String::from_utf8_lossy(&add_res.stderr));
        }

        // 3. Commit changes (or proceed if working tree was already clean)
        let _commit_res = Command::new("git")
            .args(["-C", repo_str, "commit", "-m", message])
            .output();

        // 4. Verify HEAD exists before tagging
        let rev_check = Command::new("git")
            .args(["-C", repo_str, "rev-parse", "--verify", "HEAD"])
            .output()
            .context("Failed to verify HEAD in local repository")?;
        if !rev_check.status.success() {
            anyhow::bail!("Cannot tag release: local repository has no commits and HEAD cannot be resolved.");
        }

        // 5. Create annotated tag
        let tag_res = Command::new("git")
            .args(["-C", repo_str, "tag", "-a", tag, "-m", message])
            .output()
            .context("Failed to create tag in local repository")?;
        if !tag_res.status.success() {
            anyhow::bail!("git tag failed in local repository: {}", String::from_utf8_lossy(&tag_res.stderr));
        }

        // 6. Push commit and tag to remote
        if push {
            let tag_ref = format!("refs/tags/{}", tag);
            let mut push_args = vec!["-C", repo_str, "push"];
            if force {
                push_args.push("--force-with-lease");
            }
            push_args.extend(["origin", &self.branch, &tag_ref]);
            let push_res = Command::new("git")
                .args(&push_args)
                .output()
                .context("Failed to push commit and tag from local repository")?;
            if !push_res.status.success() {
                anyhow::bail!("git push failed from local repository: {}", String::from_utf8_lossy(&push_res.stderr));
            }
        }

        let rev_out = Command::new("git")
            .args(["-C", repo_str, "rev-parse", "--short", "HEAD"])
            .output()?;
        let commit_sha = String::from_utf8_lossy(&rev_out.stdout).trim().to_string();

        if let Ok(db) = crate::db::D1Database::open(db_path.to_str().unwrap()) {
            let act = crate::db::ActivityRecord {
                id: format!("act_{}", chrono::Utc::now().timestamp_millis()),
                site_id: site_id.to_string(),
                timestamp: chrono::Utc::now().timestamp_millis(),
                actor: "briefcase@localhost".to_string(),
                action: "git_release".to_string(),
                collection: "_git".to_string(),
                document_id: tag.to_string(),
                document_title: Some(format!("Release {}", tag)),
                details: Some(json!({
                    "tag": tag,
                    "commitSha": commit_sha,
                    "branch": self.branch,
                    "pushed": push,
                }).to_string()),
            };
            let _ = db.insert_activity_if_not_exists(&act);
        }

        Ok(commit_sha)
    }

    /// Ensures a local repository exists at `target_path`.
    /// If target_path already has a valid `.git` directory, it verifies the remote and adopts it (returns Ok(true)).
    /// If target_path does not have `.git`, it clones `remote_url` into `target_path` (returns Ok(false)).
    pub fn setup_local_repo(remote_url: &str, target_path: &Path, branch: &str) -> Result<bool> {
        let path_str = target_path.to_str().ok_or_else(|| anyhow::anyhow!("Invalid target_path"))?;

        if target_path.join(".git").exists() {
            // Existing clone detected - adopt it directly!
            // Verify or set remote URL
            let current_remote_out = Command::new("git")
                .args(["-C", path_str, "remote", "get-url", "origin"])
                .output();

            match current_remote_out {
                Ok(out) if out.status.success() => {
                    let cur_url = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if cur_url != remote_url && !cur_url.is_empty() {
                        let _ = Command::new("git")
                            .args(["-C", path_str, "remote", "set-url", "origin", remote_url])
                            .output();
                    }
                }
                _ => {
                    let _ = Command::new("git")
                        .args(["-C", path_str, "remote", "add", "origin", remote_url])
                        .output();
                }
            }

            return Ok(true);
        }

        // Directory does not have .git -> clone remote
        std::fs::create_dir_all(target_path)
            .context(format!("Failed to create directory at {:?}", target_path))?;

        let clone_res = Command::new("git")
            .args(["clone", "--branch", branch, remote_url, path_str])
            .output();

        let mut cloned = false;
        if let Ok(ref o) = clone_res {
            if o.status.success() {
                cloned = true;
            }
        }

        if !cloned {
            let full_clone = Command::new("git")
                .args(["clone", remote_url, path_str])
                .output();
            if let Ok(ref o) = full_clone {
                if o.status.success() {
                    cloned = true;
                }
            }
        }

        if !cloned {
            Command::new("git").args(["init", path_str]).output()
                .context("Failed to init git repository")?;
            Command::new("git")
                .args(["-C", path_str, "remote", "add", "origin", remote_url])
                .output()
                .context("Failed to configure remote origin")?;
            let _ = Command::new("git")
                .args(["-C", path_str, "checkout", "-b", branch])
                .output();
        }

        Ok(false)
    }

    /// Extracts content items from a git tag into an isolated temporary directory
    /// and parses the JSON/Markdown records into structured documents.
    pub fn load_tag_items(&self, tag: &str) -> Result<Vec<Value>> {
        let temp_dir_path = std::env::temp_dir().join(format!(
            "slottd-load-tag-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_else(|| chrono::Utc::now().timestamp_millis() * 1_000_000)
        ));
        std::fs::create_dir_all(&temp_dir_path)
            .context("Failed to create temporary directory for tag loading")?;
        let _guard = TempDirGuard(temp_dir_path.clone());
        let temp_str = temp_dir_path.to_str().unwrap();

        let mut extracted = false;
        let remote_url = self.resolve_remote_url();

        // 1. If repo_path has .git and the tag exists locally, extract via git archive
        if self.repo_path.join(".git").exists() {
            let has_local_tag = Command::new("git")
                .args(["-C", self.repo_path.to_str().unwrap(), "rev-parse", "--verify", &format!("refs/tags/{}", tag)])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);

            if has_local_tag {
                let archive_cmd = format!(
                    "set -o pipefail; git -C \"{}\" archive \"{}\" | tar -x -C \"{}\"",
                    self.repo_path.to_str().unwrap(),
                    tag,
                    temp_str
                );
                let archive_out = Command::new("sh").args(["-c", &archive_cmd]).output();
                if let Ok(ref o) = archive_out {
                    if o.status.success() {
                        extracted = true;
                    }
                }
            }
        }

        // 2. If not extracted and remote_url is available, shallow clone by tag
        if !extracted {
            if let Some(ref url) = remote_url {
                let clone_out = Command::new("git")
                    .args(["clone", "--depth", "1", "--branch", tag, url, temp_str])
                    .output();
                if let Ok(ref o) = clone_out {
                    if o.status.success() {
                        extracted = true;
                    }
                }
            }
        }

        // 3. Fallback: if repo_path exists and is a directory (e.g. local git repo path)
        if !extracted && self.repo_path.exists() {
            let clone_out = Command::new("git")
                .args(["clone", "--depth", "1", "--branch", tag, self.repo_path.to_str().unwrap(), temp_str])
                .output();
            if let Ok(ref o) = clone_out {
                if o.status.success() {
                    extracted = true;
                }
            }
        }

        if !extracted {
            anyhow::bail!("Failed to extract content for tag '{}'", tag);
        }

        // Locate content directory
        let mut base_dir = temp_dir_path.clone();
        if !self.content_subpath.is_empty() && temp_dir_path.join(&self.content_subpath).exists() {
            base_dir = temp_dir_path.join(&self.content_subpath);
        } else if temp_dir_path.join("content").is_dir() {
            base_dir = temp_dir_path.join("content");
        }

        let ignored: std::collections::HashSet<&str> = [
            ".git", "node_modules", "dist", "src", "public", "scripts", "tests", "docs", "packages",
        ].into_iter().collect();

        let mut items = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&base_dir) {
            for entry in entries.flatten() {
                let col_path = entry.path();
                if !col_path.is_dir() {
                    continue;
                }
                let col_name = match col_path.file_name().and_then(|s| s.to_str()) {
                    Some(n) if !n.starts_with('.') && !ignored.contains(n) => n.to_string(),
                    _ => continue,
                };

                if let Ok(file_entries) = std::fs::read_dir(&col_path) {
                    for f in file_entries.flatten() {
                        let f_path = f.path();
                        if f_path.extension().and_then(|e| e.to_str()) == Some("json") {
                            let raw_json = match std::fs::read_to_string(&f_path) {
                                Ok(s) => s,
                                Err(_) => continue,
                            };
                            let mut doc: Value = serde_json::from_str(&raw_json).unwrap_or(Value::Null);
                            if !doc.is_object() {
                                continue;
                            }

                            let slug = doc.get("slug")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| {
                                    f_path.file_stem().unwrap().to_string_lossy().to_string()
                                });

                            let companion_md = col_path.join(format!("{}.md", slug));
                            if companion_md.exists() {
                                if let Ok(md_content) = std::fs::read_to_string(&companion_md) {
                                    if let Some(data_obj) = doc.get_mut("data").and_then(|d| d.as_object_mut()) {
                                        data_obj.insert("content".to_string(), Value::String(md_content));
                                    }
                                }
                            }

                            let id = doc.get("id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| format!("doc-{}-{}", col_name, slug));
                            let title = doc.get("title")
                                .and_then(|v| v.as_str())
                                .unwrap_or(&slug)
                                .to_string();
                            let status = doc.get("status")
                                .and_then(|v| v.as_str())
                                .unwrap_or("published")
                                .to_string();
                            let schema_version = doc.get("schema_version")
                                .or_else(|| doc.get("schemaVersion"))
                                .and_then(|v| v.as_i64())
                                .unwrap_or(1);
                            let publish_at = doc.get("publish_at")
                                .or_else(|| doc.get("publishAt"))
                                .and_then(|v| v.as_i64());
                            let data = doc.get("data").cloned().unwrap_or_else(|| json!({}));

                            items.push(json!({
                                "id": id,
                                "collection": col_name,
                                "slug": slug,
                                "title": title,
                                "status": status,
                                "schemaVersion": schema_version,
                                "publishAt": publish_at,
                                "data": data,
                                "createdAt": doc.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0),
                                "updatedAt": doc.get("updated_at").and_then(|v| v.as_i64()).unwrap_or(0),
                            }));
                        }
                    }
                }
            }
        }

        Ok(items)
    }

    /// Fetches all tags from the remote.
    pub fn fetch_tags(&self) -> Result<Vec<String>> {
        let _ = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "fetch", "--tags", "origin"])
            .output();

        let out = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "tag", "-l", "--sort=-creatordate"])
            .output()
            .context("Failed to list git tags")?;

        let text = String::from_utf8_lossy(&out.stdout);
        let tags: Vec<String> = text.lines().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        Ok(tags)
    }

    /// Retrieves detailed commit information and message for a specific Git release tag.
    pub fn get_tag_details(&self, tag: &str) -> Result<TagDetails> {
        let repo_str = self.repo_path.to_str().unwrap_or(".");

        // 1. Message: Try tag annotation first, then fallback to commit message
        let tag_msg_out = Command::new("git")
            .args(["-C", repo_str, "tag", "-l", "--format=%(contents)", tag])
            .output();
        let mut message = if let Ok(ref o) = tag_msg_out {
            if o.status.success() {
                String::from_utf8_lossy(&o.stdout).trim().to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        if message.is_empty() {
            let commit_msg_out = Command::new("git")
                .args(["-C", repo_str, "log", "-1", "--format=%B", tag])
                .output();
            if let Ok(ref o) = commit_msg_out {
                if o.status.success() {
                    message = String::from_utf8_lossy(&o.stdout).trim().to_string();
                }
            }
        }

        // 2. Commit metadata (SHA, author, date)
        let mut commit_sha = None;
        let mut author = None;
        let mut date = None;
        let meta_out = Command::new("git")
            .args(["-C", repo_str, "log", "-1", "--format=%H%x1f%an <%ae>%x1f%aI", tag])
            .output();
        if let Ok(ref o) = meta_out {
            if o.status.success() {
                let text = String::from_utf8_lossy(&o.stdout);
                let parts: Vec<&str> = text.trim().split('\x1f').collect();
                if parts.len() >= 3 {
                    commit_sha = Some(parts[0].to_string());
                    author = Some(parts[1].to_string());
                    date = Some(parts[2].to_string());
                }
            }
        }

        Ok(TagDetails {
            tag: tag.to_string(),
            commit_sha,
            message: if message.is_empty() {
                format!("Release {}", tag)
            } else {
                message
            },
            author,
            date,
        })
    }

    /// Fetches tags from remote and returns both the tag list and fetch command log.
    pub fn fetch_remote_tags(&self) -> Result<(Vec<String>, String)> {
        if let Some(ref url) = self.resolve_remote_url() {
            let out = Command::new("git")
                .args(["ls-remote", "--tags", url])
                .output();
            if let Ok(ref o) = out {
                if o.status.success() {
                    let text = String::from_utf8_lossy(&o.stdout);
                    let mut tags = Vec::new();
                    for line in text.lines() {
                        if let Some(idx) = line.find("refs/tags/") {
                            let tag_str = &line[idx + 10..];
                            let clean_tag = tag_str.trim().trim_end_matches("^{}");
                            if !clean_tag.is_empty() && !tags.contains(&clean_tag.to_string()) {
                                tags.push(clean_tag.to_string());
                            }
                        }
                    }
                    tags.reverse();
                    return Ok((tags, "Remote tags fetched successfully via ls-remote.".to_string()));
                }
            }
        }

        let fetch_out = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "fetch", "--tags", "origin"])
            .output();
        let fetch_log = match fetch_out {
            Ok(ref o) if !o.stdout.is_empty() => String::from_utf8_lossy(&o.stdout).to_string(),
            Ok(ref o) if !o.stderr.is_empty() => String::from_utf8_lossy(&o.stderr).to_string(),
            _ => "Tags fetched successfully.".to_string(),
        };

        let tags = self.fetch_tags()?;
        Ok((tags, fetch_log))
    }

    /// Runs a git diff --stat against a target tag or ref.
    pub fn diff(&self, tag: &str) -> Result<String> {
        let mut cmd = Command::new("git");
        cmd.args(["-C", self.repo_path.to_str().unwrap(), "diff", "--stat"]);
        if !tag.is_empty() {
            cmd.arg(tag);
        }
        let out = cmd.output().context("Failed to run git diff")?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if text.is_empty() {
            Ok("Working directory matches tag (0 changes).".to_string())
        } else {
            Ok(text)
        }
    }

    /// Checks out / restores the content repository to a specific tag or branch.
    pub fn checkout_ref(&self, target_ref: &str) -> Result<()> {
        let out = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "checkout", target_ref])
            .output()
            .with_context(|| format!("Failed to checkout ref '{}'", target_ref))?;

        if !out.status.success() {
            anyhow::bail!("git checkout failed: {}", String::from_utf8_lossy(&out.stderr));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs;

    #[test]
    fn test_git_driver_builder_and_remote_resolution() {
        let driver = GitDriver::new(PathBuf::from("/mock/repo"))
            .with_remote(Some("git@github.com:bmoelk/test.git".to_string()))
            .with_branch("staging".to_string())
            .with_content_subpath("sites/demo/content".to_string());

        assert_eq!(driver.resolve_remote_url(), Some("git@github.com:bmoelk/test.git".to_string()));
        assert_eq!(driver.branch, "staging");
        assert_eq!(driver.content_subpath, "sites/demo/content");
    }

    #[test]
    fn test_release_via_temp_creates_isolated_release() {
        let temp_base = std::env::temp_dir().join(format!(
            "slottd-git-test-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(12345)
        ));
        let _ = fs::create_dir_all(&temp_base);
        let _guard = TempDirGuard(temp_base.clone());

        let bare_remote = temp_base.join("remote.git");
        let monorepo_dir = temp_base.join("monorepo");
        let db_file = temp_base.join("test.db");

        // 1. Setup bare remote
        let _ = Command::new("git").args(["init", "--bare", bare_remote.to_str().unwrap()]).output();

        // 2. Setup monorepo dir with initial commit
        let _ = fs::create_dir_all(&monorepo_dir);
        let _ = Command::new("git").args(["init", monorepo_dir.to_str().unwrap()]).output();
        let _ = Command::new("git").args(["-C", monorepo_dir.to_str().unwrap(), "checkout", "-b", "main"]).output();
        let _ = fs::write(monorepo_dir.join("root.txt"), "hello root");
        let _ = Command::new("git").args(["-C", monorepo_dir.to_str().unwrap(), "add", "."]).output();
        let _ = Command::new("git").args(["-C", monorepo_dir.to_str().unwrap(), "commit", "-m", "initial commit"]).output();

        let initial_mono_sha = String::from_utf8_lossy(
            &Command::new("git").args(["-C", monorepo_dir.to_str().unwrap(), "rev-parse", "HEAD"]).output().unwrap().stdout
        ).trim().to_string();

        // 3. Setup test SQLite db with documents table
        let conn = Connection::open(&db_file).unwrap();
        conn.execute_batch(
            "CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                site_id TEXT,
                collection TEXT,
                slug TEXT,
                title TEXT,
                status TEXT,
                schema_version INTEGER DEFAULT 1,
                publish_at INTEGER,
                data TEXT,
                created_at INTEGER,
                updated_at INTEGER,
                draft_data TEXT,
                draft_updated_at INTEGER,
                draft_status TEXT
            );
            INSERT INTO documents (id, site_id, collection, slug, title, status, data, created_at, updated_at, draft_status)
            VALUES ('d1', 'test-site', 'posts', 'first-post', 'First Post', 'published', '{\"summary\":\"hi\"}', 1000, 1000, 'published');"
        ).unwrap();
        drop(conn);

        // 4. Release via temp using GitDriver pointing at bare_remote
        let driver = GitDriver::new(monorepo_dir.clone())
            .with_remote(Some(bare_remote.to_str().unwrap().to_string()))
            .with_branch("main".to_string())
            .with_content_subpath("content".to_string())
            .with_site_id(Some("test-site".to_string()));

        let result = driver.release_via_temp(&db_file, "v1.0.0", "chore: release v1.0.0", true);
        assert!(result.is_ok(), "release_via_temp failed: {:?}", result.err());

        // 5. Verify bare remote received tag
        let remote_tags = String::from_utf8_lossy(
            &Command::new("git").args(["-C", bare_remote.to_str().unwrap(), "tag", "-l"]).output().unwrap().stdout
        ).to_string();
        assert!(remote_tags.contains("v1.0.0"));

        // 6. Verify load_tag_items can extract and parse the tag items from the remote
        let items = driver.load_tag_items("v1.0.0").unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["slug"], "first-post");
        assert_eq!(items[0]["collection"], "posts");
        assert_eq!(items[0]["title"], "First Post");

        // 7. Verify monorepo was NOT modified!
        let final_mono_sha = String::from_utf8_lossy(
            &Command::new("git").args(["-C", monorepo_dir.to_str().unwrap(), "rev-parse", "HEAD"]).output().unwrap().stdout
        ).trim().to_string();
        assert_eq!(initial_mono_sha, final_mono_sha);
        assert!(!monorepo_dir.join("content").exists());
    }

    #[test]
    fn test_load_tag_items_with_root_level_collections() {
        let temp_base = std::env::temp_dir().join(format!(
            "slottd-root-col-test-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(54321)
        ));
        let _ = fs::create_dir_all(&temp_base);
        let _guard = TempDirGuard(temp_base.clone());

        let bare_remote = temp_base.join("remote.git");
        let work_dir = temp_base.join("work");

        // 1. Setup bare remote
        let _ = Command::new("git").args(["init", "--bare", bare_remote.to_str().unwrap()]).output();

        // 2. Setup work dir and push a tag with root-level collections
        let _ = fs::create_dir_all(&work_dir);
        let _ = Command::new("git").args(["init", work_dir.to_str().unwrap()]).output();
        let _ = Command::new("git").args(["-C", work_dir.to_str().unwrap(), "checkout", "-b", "main"]).output();
        let _ = Command::new("git").args(["-C", work_dir.to_str().unwrap(), "remote", "add", "origin", bare_remote.to_str().unwrap()]).output();

        let blog_col = work_dir.join("blog_posts");
        let _ = fs::create_dir_all(&blog_col);
        let post_json = serde_json::json!({
            "id": "post-1",
            "slug": "root-post",
            "title": "Root Level Post",
            "status": "published",
            "data": { "author": "Brian" }
        });
        let _ = fs::write(blog_col.join("root-post.json"), serde_json::to_string(&post_json).unwrap());
        let _ = fs::write(blog_col.join("root-post.md"), "# Root Post Markdown Content");

        let _ = Command::new("git").args(["-C", work_dir.to_str().unwrap(), "add", "."]).output();
        let _ = Command::new("git").args(["-C", work_dir.to_str().unwrap(), "commit", "-m", "add root-level post"]).output();
        let _ = Command::new("git").args(["-C", work_dir.to_str().unwrap(), "tag", "release-root-v1"]).output();
        let _ = Command::new("git").args(["-C", work_dir.to_str().unwrap(), "push", "origin", "main", "--tags"]).output();

        // 3. Use GitDriver without content_subpath to load tag items
        let driver = GitDriver::new(PathBuf::from("/nonexistent/local"))
            .with_remote(Some(bare_remote.to_str().unwrap().to_string()));

        let items = driver.load_tag_items("release-root-v1").unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["slug"], "root-post");
        assert_eq!(items[0]["collection"], "blog_posts");
        assert_eq!(items[0]["title"], "Root Level Post");
        assert_eq!(items[0]["data"]["content"], "# Root Post Markdown Content");
    }

    #[test]
    fn test_release_direct_updates_working_tree_and_remote() {
        let temp_base = std::env::temp_dir().join(format!(
            "slottd-direct-test-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(99887)
        ));
        let _ = fs::create_dir_all(&temp_base);
        let _guard = TempDirGuard(temp_base.clone());

        let bare_remote = temp_base.join("remote.git");
        let local_repo = temp_base.join("local_clone");

        // 1. Setup bare remote
        let _ = Command::new("git").args(["init", "--bare", bare_remote.to_str().unwrap()]).output();

        // 2. Setup local repo tracking remote
        let _ = fs::create_dir_all(&local_repo);
        let _ = Command::new("git").args(["init", local_repo.to_str().unwrap()]).output();
        let _ = Command::new("git").args(["-C", local_repo.to_str().unwrap(), "checkout", "-b", "main"]).output();
        let _ = Command::new("git").args(["-C", local_repo.to_str().unwrap(), "remote", "add", "origin", bare_remote.to_str().unwrap()]).output();
        let _ = fs::write(local_repo.join("initial.txt"), "hello");
        let _ = Command::new("git").args(["-C", local_repo.to_str().unwrap(), "add", "."]).output();
        let _ = Command::new("git").args(["-C", local_repo.to_str().unwrap(), "commit", "-m", "init"]).output();
        let _ = Command::new("git").args(["-C", local_repo.to_str().unwrap(), "push", "-u", "origin", "main"]).output();

        // 3. Create mock D1 database
        let db_file = temp_base.join("d1.sqlite");
        let conn = rusqlite::Connection::open(&db_file).unwrap();
        conn.execute_batch(
            "CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                site_id TEXT,
                collection TEXT,
                slug TEXT,
                title TEXT,
                status TEXT,
                schema_version INTEGER DEFAULT 1,
                publish_at INTEGER,
                data TEXT,
                created_at INTEGER,
                updated_at INTEGER,
                draft_data TEXT,
                draft_updated_at INTEGER,
                draft_status TEXT
            );
            INSERT INTO documents (id, site_id, collection, slug, title, status, data, created_at, updated_at, draft_status)
            VALUES ('doc-direct', 'test-site', 'posts', 'direct-post', 'Direct Post', 'published', '{\"content\":\"direct markdown\"}', 1000, 2000, 'published');"
        ).unwrap();
        drop(conn);

        // 4. Run release_direct
        let driver = GitDriver::new(local_repo.clone())
            .with_remote(Some(bare_remote.to_str().unwrap().to_string()))
            .with_branch("main".to_string())
            .with_content_subpath("content".to_string())
            .with_site_id(Some("test-site".to_string()));

        let release_res = driver.release_direct(&db_file, "release-direct-v1", "release directly", true, false);
        assert!(release_res.is_ok(), "release_direct failed: {:?}", release_res.err());

        // 5. Verify local working tree has the exported file directly
        assert!(local_repo.join("content/posts/direct-post.json").exists());
        assert!(local_repo.join("content/posts/direct-post.md").exists());

        // 6. Verify working tree is clean at HEAD
        let status_out = String::from_utf8_lossy(
            &Command::new("git").args(["-C", local_repo.to_str().unwrap(), "status", "--porcelain"]).output().unwrap().stdout
        ).to_string();
        assert!(status_out.trim().is_empty(), "Local repo working tree is not clean: {}", status_out);

        // 7. Verify bare remote received tag
        let remote_tags = String::from_utf8_lossy(
            &Command::new("git").args(["-C", bare_remote.to_str().unwrap(), "tag", "-l"]).output().unwrap().stdout
        ).to_string();
        assert!(remote_tags.contains("release-direct-v1"));
    }

    #[test]
    fn test_setup_local_repo_adopts_existing_and_clones_new() {
        let temp_base = std::env::temp_dir().join(format!(
            "slottd-setup-test-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(11223)
        ));
        let _ = fs::create_dir_all(&temp_base);
        let _guard = TempDirGuard(temp_base.clone());

        let bare_remote = temp_base.join("remote.git");
        let _ = Command::new("git").args(["init", "--bare", bare_remote.to_str().unwrap()]).output();

        // Make an initial commit in bare_remote via seed clone
        let seed = temp_base.join("seed");
        let _ = fs::create_dir_all(&seed);
        let _ = Command::new("git").args(["init", seed.to_str().unwrap()]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "checkout", "-b", "main"]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "remote", "add", "origin", bare_remote.to_str().unwrap()]).output();
        let _ = fs::write(seed.join("README.md"), "hello");
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "add", "."]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "commit", "-m", "init"]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "push", "origin", "main"]).output();

        let remote_str = bare_remote.to_str().unwrap();

        // Case A: Clone into non-existent target
        let new_target = temp_base.join("new_clone");
        let clone_res = GitDriver::setup_local_repo(remote_str, &new_target, "main");
        assert!(clone_res.is_ok());
        assert_eq!(clone_res.unwrap(), false); // false = was cloned
        assert!(new_target.join(".git").exists());
        assert!(new_target.join("README.md").exists());

        // Case B: Adopt existing local repo
        let adopt_res = GitDriver::setup_local_repo(remote_str, &new_target, "main");
        assert!(adopt_res.is_ok());
        assert_eq!(adopt_res.unwrap(), true); // true = was adopted
    }

    #[test]
    fn test_export_branch_naming() {
        let driver1 = GitDriver::new(PathBuf::from("/tmp"))
            .with_branch("main".to_string())
            .with_site_id(Some("splitphase.io".to_string()));
        assert_eq!(driver1.export_branch_name(), "briefcase/splitphase.io");

        let driver2 = GitDriver::new(PathBuf::from("/tmp"))
            .with_branch("main".to_string())
            .with_site_id(Some("brain endeavor".to_string()));
        assert_eq!(driver2.export_branch_name(), "briefcase/brain-endeavor");

        let driver3 = GitDriver::new(PathBuf::from("/tmp"))
            .with_branch("production".to_string())
            .with_site_id(None);
        assert_eq!(driver3.export_branch_name(), "briefcase/production");
    }

    #[test]
    fn test_ensure_export_branch_and_divergence() {
        let temp_base = std::env::temp_dir().join(format!(
            "slottd-branch-test-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(99887)
        ));
        let _ = fs::create_dir_all(&temp_base);
        let _guard = TempDirGuard(temp_base.clone());

        let bare_remote = temp_base.join("remote.git");
        let _ = Command::new("git").args(["init", "--bare", bare_remote.to_str().unwrap()]).output();

        // Seed initial commit
        let seed = temp_base.join("seed");
        let _ = fs::create_dir_all(&seed);
        let _ = Command::new("git").args(["init", seed.to_str().unwrap()]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "checkout", "-b", "main"]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "remote", "add", "origin", bare_remote.to_str().unwrap()]).output();
        let _ = fs::write(seed.join("README.md"), "# Init");
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "add", "."]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "commit", "-m", "init"]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "push", "origin", "main"]).output();

        // Local clone
        let local_repo = temp_base.join("local");
        let _ = Command::new("git").args(["clone", bare_remote.to_str().unwrap(), local_repo.to_str().unwrap()]).output();

        let driver = GitDriver::new(local_repo.clone())
            .with_branch("main".to_string())
            .with_site_id(Some("test-site".to_string()));

        // 1. Ensure export branch is created
        let branch_name = driver.ensure_export_branch().unwrap();
        assert_eq!(branch_name, "briefcase/test-site");

        // 2. Initial divergence should be clean
        let div = driver.get_divergence().unwrap();
        assert_eq!(div.export_branch, "briefcase/test-site");
        assert_eq!(div.ahead_count, 0);
        assert_eq!(div.behind_count, 0);
        assert!(div.pending_files.is_empty());

        // 3. Make a commit on export branch
        let local_str = local_repo.to_str().unwrap();
        let _ = Command::new("git").args(["-C", local_str, "checkout", "briefcase/test-site"]).output();
        let _ = fs::write(local_repo.join("content-1.json"), r#"{"title":"New"}"#);
        let _ = Command::new("git").args(["-C", local_str, "add", "."]).output();
        let _ = Command::new("git").args(["-C", local_str, "commit", "-m", "feat: new content"]).output();

        // 4. Divergence should report 1 ahead with pending file
        let div_after = driver.get_divergence().unwrap();
        assert_eq!(div_after.ahead_count, 1);
        assert_eq!(div_after.behind_count, 0);
        assert_eq!(div_after.pending_files, vec!["content-1.json".to_string()]);
    }

    #[test]
    fn test_rebase_clean_disjoint_upstream() {
        let temp_base = std::env::temp_dir().join(format!(
            "slottd-rebase-clean-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(88776)
        ));
        let _ = fs::create_dir_all(&temp_base);
        let _guard = TempDirGuard(temp_base.clone());

        let bare_remote = temp_base.join("remote.git");
        let _ = Command::new("git").args(["init", "--bare", bare_remote.to_str().unwrap()]).output();

        // Seed initial commit
        let seed = temp_base.join("seed");
        let _ = fs::create_dir_all(&seed);
        let _ = Command::new("git").args(["init", seed.to_str().unwrap()]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "checkout", "-b", "main"]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "remote", "add", "origin", bare_remote.to_str().unwrap()]).output();
        let _ = fs::write(seed.join("base.txt"), "base");
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "add", "."]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "commit", "-m", "init"]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "push", "origin", "main"]).output();

        // Local clone
        let local_repo = temp_base.join("local");
        let _ = Command::new("git").args(["clone", bare_remote.to_str().unwrap(), local_repo.to_str().unwrap()]).output();
        let local_str = local_repo.to_str().unwrap();

        let driver = GitDriver::new(local_repo.clone())
            .with_branch("main".to_string())
            .with_site_id(Some("test-site".to_string()));

        let _ = driver.ensure_export_branch().unwrap();

        // 1. Advance remote via seed (simulate Web CMS pushing upstream commit)
        let seed_str = seed.to_str().unwrap();
        let _ = fs::write(seed.join("cms-edit.json"), r#"{"title":"Web CMS"}"#);
        let _ = Command::new("git").args(["-C", seed_str, "add", "."]).output();
        let _ = Command::new("git").args(["-C", seed_str, "commit", "-m", "feat: web cms edit"]).output();
        let _ = Command::new("git").args(["-C", seed_str, "push", "origin", "main"]).output();

        // 2. Commit a disjoint file locally on export branch
        let _ = Command::new("git").args(["-C", local_str, "checkout", "briefcase/test-site"]).output();
        let _ = fs::write(local_repo.join("local-edit.json"), r#"{"title":"Local Workstation"}"#);
        let _ = Command::new("git").args(["-C", local_str, "add", "."]).output();
        let _ = Command::new("git").args(["-C", local_str, "commit", "-m", "feat: local edit"]).output();

        // 3. Rebase export branch onto origin/main
        let outcome = driver.rebase_export_branch().unwrap();
        assert!(outcome.success, "Rebase should succeed cleanly for disjoint changes: {}", outcome.message);
        assert!(!outcome.has_conflicts);

        // 4. Push rebased to remote main
        let commit_sha = driver.push_rebased_to_main(Some("release-test-v1"), Some("release v1"), true, false).unwrap();
        assert!(!commit_sha.is_empty());

        // Verify remote main has both files
        let _ = Command::new("git").args(["-C", seed_str, "pull", "origin", "main"]).output();
        assert!(seed.join("cms-edit.json").exists());
        assert!(seed.join("local-edit.json").exists());
    }

    #[test]
    fn test_rebase_conflict_and_abort() {
        let temp_base = std::env::temp_dir().join(format!(
            "slottd-rebase-conflict-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(77665)
        ));
        let _ = fs::create_dir_all(&temp_base);
        let _guard = TempDirGuard(temp_base.clone());

        let bare_remote = temp_base.join("remote.git");
        let _ = Command::new("git").args(["init", "--bare", bare_remote.to_str().unwrap()]).output();

        // Seed initial commit
        let seed = temp_base.join("seed");
        let _ = fs::create_dir_all(&seed);
        let _ = Command::new("git").args(["init", seed.to_str().unwrap()]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "checkout", "-b", "main"]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "remote", "add", "origin", bare_remote.to_str().unwrap()]).output();
        let _ = fs::write(seed.join("shared.json"), r#"{"version":1}"#);
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "add", "."]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "commit", "-m", "init"]).output();
        let _ = Command::new("git").args(["-C", seed.to_str().unwrap(), "push", "origin", "main"]).output();

        // Local clone
        let local_repo = temp_base.join("local");
        let _ = Command::new("git").args(["clone", bare_remote.to_str().unwrap(), local_repo.to_str().unwrap()]).output();
        let local_str = local_repo.to_str().unwrap();

        let driver = GitDriver::new(local_repo.clone())
            .with_branch("main".to_string())
            .with_site_id(Some("test-site".to_string()));

        let _ = driver.ensure_export_branch().unwrap();

        // 1. Advance remote with conflicting edit to shared.json
        let seed_str = seed.to_str().unwrap();
        let _ = fs::write(seed.join("shared.json"), r#"{"version":2,"from":"remote"}"#);
        let _ = Command::new("git").args(["-C", seed_str, "add", "."]).output();
        let _ = Command::new("git").args(["-C", seed_str, "commit", "-m", "feat: remote version 2"]).output();
        let _ = Command::new("git").args(["-C", seed_str, "push", "origin", "main"]).output();

        // 2. Make local conflicting edit to shared.json on export branch
        let _ = Command::new("git").args(["-C", local_str, "checkout", "briefcase/test-site"]).output();
        let _ = fs::write(local_repo.join("shared.json"), r#"{"version":2,"from":"local"}"#);
        let _ = Command::new("git").args(["-C", local_str, "add", "."]).output();
        let _ = Command::new("git").args(["-C", local_str, "commit", "-m", "feat: local version 2"]).output();

        // 3. Attempt rebase: should halt with conflict
        let outcome = driver.rebase_export_branch().unwrap();
        assert!(!outcome.success, "Rebase should halt due to conflict");
        assert!(outcome.has_conflicts);
        assert!(outcome.conflicting_files.contains(&"shared.json".to_string()));

        // 4. Abort rebase
        let abort_res = driver.rebase_abort();
        assert!(abort_res.is_ok(), "Rebase abort should succeed");

        // 5. Verify local repo is clean and back on export branch
        let status_out = String::from_utf8_lossy(
            &Command::new("git").args(["-C", local_str, "status", "--porcelain"]).output().unwrap().stdout
        ).to_string();
        assert!(status_out.trim().is_empty(), "Working tree should be clean after abort: {}", status_out);
    }

    #[test]
    fn test_check_deploy_readiness_matrix() {
        let temp_base = std::env::temp_dir().join(format!(
            "slottd-deploy-readiness-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(88990)
        ));
        let _ = fs::create_dir_all(&temp_base);
        let _guard = TempDirGuard(temp_base.clone());

        let repo = temp_base.join("repo");
        let _ = fs::create_dir_all(&repo);
        let _ = Command::new("git").args(["init", repo.to_str().unwrap()]).output();
        let _ = Command::new("git").args(["-C", repo.to_str().unwrap(), "checkout", "-b", "main"]).output();
        let _ = fs::write(repo.join("file.txt"), "hello");
        let _ = Command::new("git").args(["-C", repo.to_str().unwrap(), "add", "."]).output();
        let _ = Command::new("git").args(["-C", repo.to_str().unwrap(), "commit", "-m", "init"]).output();

        let driver = GitDriver::new(repo.clone())
            .with_branch("main".to_string())
            .with_site_id(Some("mysite".to_string()));

        let _ = driver.ensure_export_branch().unwrap();

        // 1. Standalone single-user mode: ALWAYS allowed, Level 1 Safe even if unreleased edits exist
        let standalone_res = driver.check_deploy_readiness(false, 5, false).unwrap();
        assert_eq!(standalone_res.level, DeployReadinessLevel::Safe);
        assert!(standalone_res.allowed);
        assert!(!standalone_res.is_mixed_mode);

        // 2. Mixed mode with clean state (ahead=0, behind=0, unreleased=0): Allowed, Level 1 Safe
        let clean_mixed_res = driver.check_deploy_readiness(true, 0, false).unwrap();
        assert_eq!(clean_mixed_res.level, DeployReadinessLevel::Safe);
        assert!(clean_mixed_res.allowed);
        assert!(clean_mixed_res.is_mixed_mode);

        // 3. Mixed mode with diverged state (unreleased edits > 0): Blocked, Level 3 Warning
        let blocked_mixed_res = driver.check_deploy_readiness(true, 2, false).unwrap();
        assert_eq!(blocked_mixed_res.level, DeployReadinessLevel::Warning);
        assert!(!blocked_mixed_res.allowed);
        assert!(blocked_mixed_res.consequences.len() >= 3);
        assert!(blocked_mixed_res.message.contains("2 unreleased edit(s)"));

        // 4. Mixed mode with diverged state and force=true: Allowed, Level 3 Warning with override
        let forced_mixed_res = driver.check_deploy_readiness(true, 2, true).unwrap();
        assert_eq!(forced_mixed_res.level, DeployReadinessLevel::Warning);
        assert!(forced_mixed_res.allowed);
        assert!(forced_mixed_res.message.contains("FORCE OVERRIDE"));
    }
}
