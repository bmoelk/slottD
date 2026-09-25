use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

use crate::db::{D1Database, DocumentRecord};

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportedMeta {
    pub id: String,
    pub collection: String,
    pub slug: String,
    pub title: String,
    pub status: String,
    pub schema_version: i64,
    pub publish_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub data: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site_id: Option<String>,
}

pub struct SyncEngine {
    db_path: PathBuf,
    content_dir: PathBuf,
    site_id: String,
}

impl SyncEngine {
    pub fn new(db_path: PathBuf, content_dir: PathBuf, site_id: Option<String>) -> Result<Self> {
        let site_id = site_id
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| anyhow::anyhow!("site_id is required for SyncEngine; the 'default' site concept has been abolished."))?;

        Ok(Self {
            db_path,
            content_dir,
            site_id,
        })
    }

    /// Exports documents from SQLite into flat JSON and Markdown files.
    pub fn export_to_disk(&self) -> Result<usize> {
        let db = D1Database::open_readonly(self.db_path.to_str().unwrap())
            .context("Failed to open local database for export")?;

        let filter_site = if self.site_id == "all" {
            None
        } else {
            Some(self.site_id.as_str())
        };

        let docs = db.list_documents(filter_site)
            .context("Failed to query documents from database")?;

        // Safety guard: NEVER export into a CMS or project root directory!
        if self.content_dir.join("wrangler.toml").exists()
            || self.content_dir.join("wrangler.jsonc").exists()
            || self.content_dir.join("slottd.config.ts").exists()
            || self.content_dir.join("pnpm-workspace.yaml").exists()
            || self.content_dir.join("lerna.json").exists()
            || self.content_dir.join("turbo.json").exists()
        {
            anyhow::bail!(
                "Refusing to export into CMS or monorepo root directory: {:?}. Content directory must be a separate repository or dedicated content subpath.",
                self.content_dir
            );
        }

        if !self.content_dir.exists() {
            fs::create_dir_all(&self.content_dir)
                .context("Failed to create content directory")?;
        }

        // Safe pruning: Only clean .json and .md files inside active collection directories being exported
        let active_collections: std::collections::HashSet<String> = docs.iter().map(|d| d.collection.clone()).collect();
        for col in &active_collections {
            let col_dir = self.content_dir.join(col);
            if col_dir.exists() && col_dir.is_dir() {
                if let Ok(entries) = fs::read_dir(&col_dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
                            if ext == "json" || ext == "md" {
                                let _ = fs::remove_file(&p);
                            }
                        }
                    }
                }
            }
        }

        let mut count = 0;
        for doc in docs {
            let col_dir = self.content_dir.join(&doc.collection);
            if !col_dir.exists() {
                fs::create_dir_all(&col_dir)?;
            }

            let mut custom_data: Value = serde_json::from_str(&doc.data)
                .unwrap_or_else(|_| Value::Object(serde_json::Map::new()));

            // Extract narrative markdown if present
            if let Some(obj) = custom_data.as_object_mut() {
                if let Some(content_val) = obj.remove("content") {
                    if let Some(content_str) = content_val.as_str() {
                        let md_path = col_dir.join(format!("{}.md", doc.slug));
                        fs::write(&md_path, format!("{}\n", content_str.trim()))?;
                    }
                }
            }

            let meta = ExportedMeta {
                id: doc.id,
                collection: doc.collection,
                slug: doc.slug.clone(),
                title: doc.title,
                status: doc.status,
                schema_version: doc.schema_version,
                publish_at: doc.publish_at,
                created_at: doc.created_at,
                updated_at: doc.updated_at,
                data: custom_data,
                site_id: Some(doc.site_id),
            };

            let json_path = col_dir.join(format!("{}.json", doc.slug));
            let json_str = serde_json::to_string_pretty(&meta)?;
            fs::write(&json_path, format!("{}\n", json_str))?;
            count += 1;
        }

        // Export activity logs into .slottd/activity.jsonl
        let activities = db.list_activities(filter_site).unwrap_or_default();
        if !activities.is_empty() {
            let slottd_dir = self.content_dir.join(".slottd");
            if !slottd_dir.exists() {
                let _ = fs::create_dir_all(&slottd_dir);
            }
            let activity_file = slottd_dir.join("activity.jsonl");
            let mut lines = Vec::new();
            for act in activities {
                if let Ok(line) = serde_json::to_string(&act) {
                    lines.push(line);
                }
            }
            let _ = fs::write(&activity_file, format!("{}\n", lines.join("\n")));
        }

        Ok(count)
    }

    /// Hydrates flat JSON and Markdown files from disk back into SQLite.
    pub fn hydrate_from_disk(&self) -> Result<usize> {
        if !self.content_dir.exists() {
            anyhow::bail!("Content directory does not exist: {:?}", self.content_dir);
        }

        let db = D1Database::open(self.db_path.to_str().unwrap())
            .context("Failed to open local database for hydration")?;

        let mut count = 0;
        for entry in fs::read_dir(&self.content_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                let col = path.file_name().unwrap().to_string_lossy().to_string();
                if col.starts_with('.') || col == "node_modules" {
                    continue;
                }

                for file_entry in fs::read_dir(&path)? {
                    let file_entry = file_entry?;
                    let file_path = file_entry.path();
                    if file_path.extension().and_then(|s| s.to_str()) == Some("json") {
                        let json_content = fs::read_to_string(&file_path)?;
                        let meta: ExportedMeta = serde_json::from_str(&json_content)?;

                        let mut custom_data = meta.data;

                        // Check for companion markdown
                        let md_path = path.join(format!("{}.md", meta.slug));
                        if md_path.exists() {
                            let md_body = fs::read_to_string(&md_path)?;
                            if let Some(obj) = custom_data.as_object_mut() {
                                obj.insert("content".to_string(), Value::String(md_body));
                            }
                        }

                        let effective_site = meta.site_id.unwrap_or_else(|| self.site_id.clone());

                        let doc_record = DocumentRecord {
                            id: meta.id,
                            site_id: effective_site,
                            collection: meta.collection,
                            slug: meta.slug,
                            title: meta.title,
                            status: meta.status,
                            schema_version: meta.schema_version,
                            publish_at: meta.publish_at,
                            data: serde_json::to_string(&custom_data)?,
                            created_at: meta.created_at,
                            updated_at: meta.updated_at,
                            draft_data: None,
                            draft_updated_at: None,
                            draft_status: "none".to_string(),
                        };

                        db.upsert_document(&doc_record)?;
                        count += 1;
                    }
                }
            }
        }

        // Hydrate activity logs from .slottd/activity.jsonl if present
        let activity_file = self.content_dir.join(".slottd").join("activity.jsonl");
        if activity_file.exists() {
            if let Ok(content) = fs::read_to_string(&activity_file) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        if let Ok(act) = serde_json::from_str::<crate::db::ActivityRecord>(trimmed) {
                            let _ = db.insert_activity_if_not_exists(&act);
                        }
                    }
                }
            }
        }

        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    struct TempDirGuard(std::path::PathBuf);
    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn setup_test_db(path: &std::path::Path) -> D1Database {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL DEFAULT 'default',
                collection TEXT NOT NULL,
                slug TEXT NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL,
                schema_version INTEGER NOT NULL DEFAULT 1,
                publish_at INTEGER,
                data TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                draft_data TEXT,
                draft_updated_at INTEGER,
                draft_status TEXT NOT NULL DEFAULT 'none'
            );
            CREATE TABLE IF NOT EXISTS activity_log (
                id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL DEFAULT 'default',
                timestamp INTEGER NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                collection TEXT NOT NULL,
                document_id TEXT NOT NULL,
                document_title TEXT,
                details TEXT
            );"
        ).unwrap();
        D1Database::open(path.to_str().unwrap()).unwrap()
    }

    #[test]
    fn test_activity_log_export_and_hydrate() {
        let temp_dir = std::env::temp_dir().join(format!(
            "slottd-sync-test-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(12345)
        ));
        let _ = fs::create_dir_all(&temp_dir);
        let _guard = TempDirGuard(temp_dir.clone());

        let db_path = temp_dir.join("source.sqlite");
        let content_dir = temp_dir.join("content");
        let db = setup_test_db(&db_path);

        // Insert a document
        let doc = DocumentRecord {
            id: "doc-1".to_string(),
            site_id: "test.io".to_string(),
            collection: "projects".to_string(),
            slug: "slottd".to_string(),
            title: "SlottD".to_string(),
            status: "published".to_string(),
            schema_version: 1,
            publish_at: None,
            data: "{\"name\":\"SlottD\"}".to_string(),
            created_at: 1000,
            updated_at: 1000,
            draft_data: None,
            draft_updated_at: None,
            draft_status: "none".to_string(),
        };
        db.upsert_document(&doc).unwrap();

        // Insert an activity record
        let act = crate::db::ActivityRecord {
            id: "act-1".to_string(),
            site_id: "test.io".to_string(),
            timestamp: 1000,
            actor: "bmo@test.io".to_string(),
            action: "create".to_string(),
            collection: "projects".to_string(),
            document_id: "doc-1".to_string(),
            document_title: Some("SlottD".to_string()),
            details: Some("{\"tag\":\"v1\"}".to_string()),
        };
        db.insert_activity_if_not_exists(&act).unwrap();

        let sync_engine = SyncEngine::new(db_path.clone(), content_dir.clone(), Some("test.io".to_string())).unwrap();
        let exported = sync_engine.export_to_disk().unwrap();
        assert_eq!(exported, 1);

        // Verify .slottd/activity.jsonl exists
        let activity_file = content_dir.join(".slottd").join("activity.jsonl");
        assert!(activity_file.exists());
        let content = fs::read_to_string(&activity_file).unwrap();
        assert!(content.contains("\"id\":\"act-1\""));
        assert!(content.contains("\"actor\":\"bmo@test.io\""));

        // Now test hydration into a fresh second database
        let db_dest_path = temp_dir.join("dest.sqlite");
        let db_dest = setup_test_db(&db_dest_path);

        let dest_sync = SyncEngine::new(db_dest_path.clone(), content_dir.clone(), Some("test.io".to_string())).unwrap();
        let hydrated = dest_sync.hydrate_from_disk().unwrap();
        assert_eq!(hydrated, 1);

        // Verify document and activity were restored into the second database
        let dest_docs = db_dest.list_documents(Some("test.io")).unwrap();
        assert_eq!(dest_docs.len(), 1);

        let dest_activities = db_dest.list_activities(Some("test.io")).unwrap();
        assert_eq!(dest_activities.len(), 1);
        assert_eq!(dest_activities[0].id, "act-1");
        assert_eq!(dest_activities[0].actor, "bmo@test.io");
        assert_eq!(dest_activities[0].action, "create");
    }
}

