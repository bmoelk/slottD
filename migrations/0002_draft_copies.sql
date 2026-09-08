-- Migration: 0002_draft_copies.sql
-- SlottD Dual-State Draft Engine, Directus Versions & Concurrent Draft Bundles

-- 1. Extend documents table with dual-state working copy columns
ALTER TABLE documents ADD COLUMN draft_data JSON DEFAULT NULL;
ALTER TABLE documents ADD COLUMN draft_updated_at INTEGER DEFAULT NULL;
ALTER TABLE documents ADD COLUMN draft_status TEXT NOT NULL DEFAULT 'none' CHECK (draft_status IN ('none', 'modified', 'new'));

CREATE INDEX IF NOT EXISTS idx_docs_draft_status ON documents(draft_status);

-- 2. Directus Content Versioning system collection (directus_versions)
CREATE TABLE IF NOT EXISTS directus_versions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  collection TEXT NOT NULL,
  item TEXT NOT NULL,
  delta JSON NOT NULL DEFAULT '{}',
  date_created INTEGER NOT NULL,
  date_updated INTEGER NOT NULL,
  user_created TEXT,
  user_updated TEXT
);

CREATE INDEX IF NOT EXISTS idx_versions_collection_item ON directus_versions(collection, item);
CREATE INDEX IF NOT EXISTS idx_versions_key ON directus_versions(key);

-- 3. Concurrent Draft Bundles table
CREATE TABLE IF NOT EXISTS bundles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved', 'published')),
  git_branch TEXT,
  publish_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bundles_slug ON bundles(slug);
CREATE INDEX IF NOT EXISTS idx_bundles_status ON bundles(status);
