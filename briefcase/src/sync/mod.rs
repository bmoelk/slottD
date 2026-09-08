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
}

pub struct SyncEngine {
    db_path: PathBuf,
    content_dir: PathBuf,
}

impl SyncEngine {
    pub fn new(db_path: PathBuf, content_dir: PathBuf) -> Self {
        Self {
            db_path,
            content_dir,
        }
    }

    /// Exports all documents from SQLite into flat JSON and Markdown files.
    pub fn export_to_disk(&self) -> Result<usize> {
        let db = D1Database::open_readonly(self.db_path.to_str().unwrap())
            .context("Failed to open local database for export")?;

        let docs = db.list_documents()
            .context("Failed to query documents from database")?;

        if self.content_dir.exists() {
            if let Ok(entries) = fs::read_dir(&self.content_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = path.file_name().unwrap_or_default().to_string_lossy();
                    if name.starts_with('.')
                        || name == "node_modules"
                        || name == "package.json"
                        || name == "README.md"
                        || name == ".gitignore"
                    {
                        continue;
                    }
                    if path.is_dir() {
                        let _ = fs::remove_dir_all(&path);
                    }
                }
            }
        } else {
            fs::create_dir_all(&self.content_dir)
                .context("Failed to create content directory")?;
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
            };

            let json_path = col_dir.join(format!("{}.json", doc.slug));
            let json_str = serde_json::to_string_pretty(&meta)?;
            fs::write(&json_path, format!("{}\n", json_str))?;
            count += 1;
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

                        let doc_record = DocumentRecord {
                            id: meta.id,
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

        Ok(count)
    }
}
