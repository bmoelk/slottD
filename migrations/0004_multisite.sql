-- Migration: 0004_multisite.sql
-- SlottD Multi-Website Database Migration & Rigid Site Isolation
-- 100% Generic: uses 'default' placeholder without hardcoding private domains

-- 1. Create system_site_settings registry table
CREATE TABLE IF NOT EXISTS system_site_settings (
  site_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, key)
);
CREATE INDEX IF NOT EXISTS idx_system_site_settings_site ON system_site_settings(site_id);

-- 2. Create site_domain_referrals table (for configurable domain referral fallback)
CREATE TABLE IF NOT EXISTS site_domain_referrals (
  referral_domain TEXT PRIMARY KEY,
  target_site_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referrals_target ON site_domain_referrals(target_site_id);

-- 3. Backfill existing system_settings to system_site_settings under generic 'default' site
INSERT OR IGNORE INTO system_site_settings (site_id, key, value, updated_at)
SELECT 'default', key, value, updated_at FROM system_settings
WHERE key IN ('git_remote_url', 'repo_path', 'git_branch', 'git_token_enc', 'content_path');

-- 4. Recreate documents table with site_id and UNIQUE(site_id, collection, slug)
CREATE TABLE IF NOT EXISTS documents_multisite (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL DEFAULT 'default',
  collection TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  schema_version INTEGER NOT NULL DEFAULT 1,
  publish_at INTEGER,
  data JSON NOT NULL DEFAULT '{}',
  draft_data JSON DEFAULT NULL,
  draft_updated_at INTEGER DEFAULT NULL,
  draft_status TEXT NOT NULL DEFAULT 'none' CHECK (draft_status IN ('none', 'modified', 'new')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(site_id, collection, slug)
);

INSERT INTO documents_multisite (
  id, site_id, collection, slug, title, status, schema_version, publish_at,
  data, draft_data, draft_updated_at, draft_status, created_at, updated_at
)
SELECT 
  id, 'default', collection, slug, title, status, schema_version, publish_at,
  data, draft_data, draft_updated_at, draft_status, created_at, updated_at
FROM documents;

DROP TABLE documents;
ALTER TABLE documents_multisite RENAME TO documents;

CREATE INDEX IF NOT EXISTS idx_docs_site_col_slug ON documents(site_id, collection, slug);
CREATE INDEX IF NOT EXISTS idx_docs_site_col_status ON documents(site_id, collection, status);
CREATE INDEX IF NOT EXISTS idx_docs_site_draft ON documents(site_id, draft_status);
CREATE INDEX IF NOT EXISTS idx_docs_site_updated ON documents(site_id, collection, updated_at DESC);

-- 5. Recreate media table with site_id and UNIQUE(site_id, key)
CREATE TABLE IF NOT EXISTS media_multisite (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(site_id, key)
);

INSERT INTO media_multisite (id, site_id, key, filename, mime_type, size, width, height, created_at)
SELECT id, 'default', key, filename, mime_type, size, width, height, created_at
FROM media;

DROP TABLE media;
ALTER TABLE media_multisite RENAME TO media;

CREATE INDEX IF NOT EXISTS idx_media_site_key ON media(site_id, key);

-- 6. Extend bundles, directus_versions, and activity_log with site_id
ALTER TABLE bundles ADD COLUMN site_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_bundles_site_slug ON bundles(site_id, slug);

ALTER TABLE directus_versions ADD COLUMN site_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_versions_site_col ON directus_versions(site_id, collection, item);

ALTER TABLE activity_log ADD COLUMN site_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_activity_site ON activity_log(site_id);
