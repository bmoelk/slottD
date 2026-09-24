use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
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

        Ok(commit_sha)
    }

    /// Stages content changes, commits, tags, and pushes to Git remote using native SSH.
    pub fn release(&self, tag: &str, message: &str, push: bool) -> Result<String> {
        let add_res = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "add", "."])
            .output()
            .context("Failed to stage git changes")?;
        if !add_res.status.success() {
            anyhow::bail!("git add failed: {}", String::from_utf8_lossy(&add_res.stderr));
        }

        let _commit_res = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "commit", "-m", message])
            .output();

        let tag_res = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "tag", "-a", tag, "-m", message])
            .output()
            .context("Failed to create git tag")?;
        if !tag_res.status.success() {
            anyhow::bail!("git tag failed: {}", String::from_utf8_lossy(&tag_res.stderr));
        }

        if push {
            let tag_ref = format!("refs/tags/{}", tag);
            let push_res = Command::new("git")
                .args(["-C", self.repo_path.to_str().unwrap(), "push", "origin", "HEAD", &tag_ref])
                .output()
                .context("Failed to push git commit and tag")?;
            if !push_res.status.success() {
                anyhow::bail!("git push failed: {}", String::from_utf8_lossy(&push_res.stderr));
            }
        }

        let rev_out = Command::new("git")
            .args(["-C", self.repo_path.to_str().unwrap(), "rev-parse", "--short", "HEAD"])
            .output()?;
        let commit_sha = String::from_utf8_lossy(&rev_out.stdout).trim().to_string();

        Ok(commit_sha)
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
}
