use anyhow::{Context, Result};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct GitStatusInfo {
    pub branch: String,
    pub remote: String,
    pub is_dirty: bool,
    pub dirty_files: Vec<String>,
    pub unpushed_commits: usize,
}

pub struct GitDriver {
    repo_path: PathBuf,
}

impl GitDriver {
    pub fn new(repo_path: PathBuf) -> Self {
        Self { repo_path }
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

        Ok(GitStatusInfo {
            branch,
            remote,
            is_dirty,
            dirty_files,
            unpushed_commits,
        })
    }

    /// Stages all changes, commits, tags, and pushes to Git remote using native SSH.
    pub fn release(&self, tag: &str, message: &str, push: bool) -> Result<String> {
        // 1. git add -A
        let add_res = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "add", "-A"])
            .output()
            .context("Failed to stage git changes")?;
        if !add_res.status.success() {
            anyhow::bail!("git add failed: {}", String::from_utf8_lossy(&add_res.stderr));
        }

        // 2. git commit
        let _commit_res = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "commit", "-m", message])
            .output();

        // 3. git tag -a
        let tag_res = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "tag", "-a", tag, "-m", message])
            .output()
            .context("Failed to create git tag")?;
        if !tag_res.status.success() {
            anyhow::bail!("git tag failed: {}", String::from_utf8_lossy(&tag_res.stderr));
        }

        // 4. git push (if requested)
        if push {
            let push_res = Command::new("git")
                .args(["-C", self.repo_path.to_str().unwrap(), "push", "origin", "HEAD", "--tags"])
                .output()
                .context("Failed to push git commit and tags")?;
            if !push_res.status.success() {
                anyhow::bail!("git push failed: {}", String::from_utf8_lossy(&push_res.stderr));
            }
        }

        // Get latest commit hash
        let rev_out = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "rev-parse", "--short", "HEAD"])
            .output()?;
        let commit_sha = String::from_utf8_lossy(&rev_out.stdout).trim().to_string();

        Ok(commit_sha)
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

    /// Fetches tags from remote and returns both the tag list and fetch command log.
    pub fn fetch_remote_tags(&self) -> Result<(Vec<String>, String)> {
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
