use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentRecord {
    pub id: String,
    pub site_id: String,
    pub collection: String,
    pub slug: String,
    pub title: String,
    pub status: String,
    pub schema_version: i64,
    pub publish_at: Option<i64>,
    pub data: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub draft_data: Option<String>,
    pub draft_updated_at: Option<i64>,
    pub draft_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityRecord {
    pub id: String,
    pub site_id: String,
    pub timestamp: i64,
    pub actor: String,
    pub action: String,
    pub collection: String,
    pub document_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

pub struct D1Database {
    conn: Connection,
}

impl D1Database {
    pub fn open(path: &str) -> Result<Self> {
        let conn = Connection::open(path)
            .with_context(|| format!("Failed to open SQLite database at: {}", path))?;
        Ok(Self { conn })
    }

    pub fn open_readonly(path: &str) -> Result<Self> {
        let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .with_context(|| format!("Failed to open readonly SQLite database at: {}", path))?;
        Ok(Self { conn })
    }

    /// Checks if the documents table contains the site_id column
    pub fn has_site_id(&self) -> bool {
        let mut stmt = match self.conn.prepare("PRAGMA table_info(documents)") {
            Ok(s) => s,
            Err(_) => return false,
        };
        let mut rows = match stmt.query([]) {
            Ok(r) => r,
            Err(_) => return false,
        };
        while let Ok(Some(row)) = rows.next() {
            let col_name: String = row.get(1).unwrap_or_default();
            if col_name == "site_id" {
                return true;
            }
        }
        false
    }

    /// Fetches all documents, optionally scoped to a specific site_id.
    pub fn list_documents(&self, site_id: Option<&str>) -> Result<Vec<DocumentRecord>> {
        let has_site = self.has_site_id();
        let mut docs = Vec::new();

        if has_site {
            if let Some(site) = site_id {
                let mut stmt = self.conn.prepare(
                    "SELECT id, site_id, collection, slug, title, status, schema_version, publish_at, data, 
                            created_at, updated_at, draft_data, draft_updated_at, draft_status 
                     FROM documents WHERE site_id = ?1 ORDER BY collection, slug"
                )?;
                let doc_iter = stmt.query_map([site], |row| {
                    Ok(DocumentRecord {
                        id: row.get(0)?,
                        site_id: row.get(1)?,
                        collection: row.get(2)?,
                        slug: row.get(3)?,
                        title: row.get(4)?,
                        status: row.get(5)?,
                        schema_version: row.get(6)?,
                        publish_at: row.get(7)?,
                        data: row.get(8)?,
                        created_at: row.get(9)?,
                        updated_at: row.get(10)?,
                        draft_data: row.get(11)?,
                        draft_updated_at: row.get(12)?,
                        draft_status: row.get(13)?,
                    })
                })?;
                for doc in doc_iter {
                    docs.push(doc?);
                }
            } else {
                let mut stmt = self.conn.prepare(
                    "SELECT id, site_id, collection, slug, title, status, schema_version, publish_at, data, 
                            created_at, updated_at, draft_data, draft_updated_at, draft_status 
                     FROM documents ORDER BY collection, slug"
                )?;
                let doc_iter = stmt.query_map([], |row| {
                    Ok(DocumentRecord {
                        id: row.get(0)?,
                        site_id: row.get(1)?,
                        collection: row.get(2)?,
                        slug: row.get(3)?,
                        title: row.get(4)?,
                        status: row.get(5)?,
                        schema_version: row.get(6)?,
                        publish_at: row.get(7)?,
                        data: row.get(8)?,
                        created_at: row.get(9)?,
                        updated_at: row.get(10)?,
                        draft_data: row.get(11)?,
                        draft_updated_at: row.get(12)?,
                        draft_status: row.get(13)?,
                    })
                })?;
                for doc in doc_iter {
                    docs.push(doc?);
                }
            }
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT id, 'default' AS site_id, collection, slug, title, status, schema_version, publish_at, data, 
                        created_at, updated_at, draft_data, draft_updated_at, draft_status 
                 FROM documents ORDER BY collection, slug"
            )?;
            let doc_iter = stmt.query_map([], |row| {
                Ok(DocumentRecord {
                    id: row.get(0)?,
                    site_id: row.get(1)?,
                    collection: row.get(2)?,
                    slug: row.get(3)?,
                    title: row.get(4)?,
                    status: row.get(5)?,
                    schema_version: row.get(6)?,
                    publish_at: row.get(7)?,
                    data: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                    draft_data: row.get(11)?,
                    draft_updated_at: row.get(12)?,
                    draft_status: row.get(13)?,
                })
            })?;
            for doc in doc_iter {
                docs.push(doc?);
            }
        }

        Ok(docs)
    }

    /// Inserts or updates a document into the documents table.
    pub fn upsert_document(&self, doc: &DocumentRecord) -> Result<()> {
        if self.has_site_id() {
            // Reconcile by (site_id, collection, slug) to preserve UUID and prevent duplicate collisions
            let existing_id: Option<String> = self.conn.query_row(
                "SELECT id FROM documents WHERE site_id = ?1 AND collection = ?2 AND slug = ?3",
                params![doc.site_id, doc.collection, doc.slug],
                |r| r.get(0),
            ).ok();
            let target_id = existing_id.unwrap_or_else(|| doc.id.clone());

            self.conn.execute(
                "INSERT INTO documents (
                    id, site_id, collection, slug, title, status, schema_version, publish_at, 
                    data, created_at, updated_at, draft_status
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                    site_id = excluded.site_id,
                    collection = excluded.collection,
                    slug = excluded.slug,
                    title = excluded.title,
                    status = excluded.status,
                    schema_version = excluded.schema_version,
                    publish_at = excluded.publish_at,
                    data = excluded.data,
                    updated_at = excluded.updated_at,
                    draft_status = excluded.draft_status",
                params![
                    target_id,
                    doc.site_id,
                    doc.collection,
                    doc.slug,
                    doc.title,
                    doc.status,
                    doc.schema_version,
                    doc.publish_at,
                    doc.data,
                    doc.created_at,
                    doc.updated_at,
                    doc.draft_status,
                ],
            )?;
        } else {
            self.conn.execute(
                "INSERT INTO documents (
                    id, collection, slug, title, status, schema_version, publish_at, 
                    data, created_at, updated_at, draft_status
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(id) DO UPDATE SET
                    collection = excluded.collection,
                    slug = excluded.slug,
                    title = excluded.title,
                    status = excluded.status,
                    schema_version = excluded.schema_version,
                    publish_at = excluded.publish_at,
                    data = excluded.data,
                    updated_at = excluded.updated_at,
                    draft_status = excluded.draft_status",
                params![
                    doc.id,
                    doc.collection,
                    doc.slug,
                    doc.title,
                    doc.status,
                    doc.schema_version,
                    doc.publish_at,
                    doc.data,
                    doc.created_at,
                    doc.updated_at,
                    doc.draft_status,
                ],
            )?;
        }
        Ok(())
    }

    /// Count total documents and collections.
    pub fn get_stats(&self) -> Result<(usize, usize)> {
        let doc_count: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM documents",
            [],
            |r| r.get(0),
        ).unwrap_or(0);

        let col_count: usize = self.conn.query_row(
            "SELECT COUNT(DISTINCT collection) FROM documents",
            [],
            |r| r.get(0),
        ).unwrap_or(0);

        Ok((doc_count, col_count))
    }

    /// Ensures activity_log table exists with multi-tenant site_id index.
    pub fn ensure_activity_log_table(&self) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS activity_log (
                id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL DEFAULT 'default',
                timestamp INTEGER NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                collection TEXT NOT NULL,
                document_id TEXT NOT NULL,
                document_title TEXT,
                details TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_activity_site ON activity_log(site_id);
            CREATE INDEX IF NOT EXISTS idx_activity_site_time ON activity_log(site_id, timestamp);"
        )?;
        Ok(())
    }

    /// Fetches all activity records, optionally scoped to a site_id.
    pub fn list_activities(&self, site_id: Option<&str>) -> Result<Vec<ActivityRecord>> {
        let _ = self.ensure_activity_log_table();
        let mut activities = Vec::new();
        if let Some(site) = site_id {
            let mut stmt = self.conn.prepare(
                "SELECT id, site_id, timestamp, actor, action, collection, document_id, document_title, details
                 FROM activity_log WHERE site_id = ?1 ORDER BY timestamp ASC"
            )?;
            let iter = stmt.query_map([site], |row| {
                Ok(ActivityRecord {
                    id: row.get(0)?,
                    site_id: row.get(1)?,
                    timestamp: row.get(2)?,
                    actor: row.get(3)?,
                    action: row.get(4)?,
                    collection: row.get(5)?,
                    document_id: row.get(6)?,
                    document_title: row.get(7)?,
                    details: row.get(8)?,
                })
            })?;
            for act in iter {
                activities.push(act?);
            }
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT id, site_id, timestamp, actor, action, collection, document_id, document_title, details
                 FROM activity_log ORDER BY timestamp ASC"
            )?;
            let iter = stmt.query_map([], |row| {
                Ok(ActivityRecord {
                    id: row.get(0)?,
                    site_id: row.get(1)?,
                    timestamp: row.get(2)?,
                    actor: row.get(3)?,
                    action: row.get(4)?,
                    collection: row.get(5)?,
                    document_id: row.get(6)?,
                    document_title: row.get(7)?,
                    details: row.get(8)?,
                })
            })?;
            for act in iter {
                activities.push(act?);
            }
        }
        Ok(activities)
    }

    /// Inserts an activity log record if it does not already exist.
    pub fn insert_activity_if_not_exists(&self, act: &ActivityRecord) -> Result<bool> {
        let _ = self.ensure_activity_log_table();
        let changed = self.conn.execute(
            "INSERT OR IGNORE INTO activity_log (
                id, site_id, timestamp, actor, action, collection, document_id, document_title, details
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                act.id,
                act.site_id,
                act.timestamp,
                act.actor,
                act.action,
                act.collection,
                act.document_id,
                act.document_title,
                act.details,
            ],
        )?;
        Ok(changed > 0)
    }
}

