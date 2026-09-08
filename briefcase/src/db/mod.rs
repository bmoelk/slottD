use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentRecord {
    pub id: String,
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

    /// Fetches all documents across all collections.
    pub fn list_documents(&self) -> Result<Vec<DocumentRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, collection, slug, title, status, schema_version, publish_at, data, 
                    created_at, updated_at, draft_data, draft_updated_at, draft_status 
             FROM documents ORDER BY collection, slug"
        )?;

        let doc_iter = stmt.query_map([], |row| {
            Ok(DocumentRecord {
                id: row.get(0)?,
                collection: row.get(1)?,
                slug: row.get(2)?,
                title: row.get(3)?,
                status: row.get(4)?,
                schema_version: row.get(5)?,
                publish_at: row.get(6)?,
                data: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                draft_data: row.get(10)?,
                draft_updated_at: row.get(11)?,
                draft_status: row.get(12)?,
            })
        })?;

        let mut docs = Vec::new();
        for doc in doc_iter {
            docs.push(doc?);
        }
        Ok(docs)
    }

    /// Inserts or updates a document into the documents table.
    pub fn upsert_document(&self, doc: &DocumentRecord) -> Result<()> {
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
}
