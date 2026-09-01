-- Migration: 0001_init.sql
-- SlottD Indestructible Documents, Collections Metadata & Media Storage Schema

-- 1. Collections Metadata Table
CREATE TABLE IF NOT EXISTS collections (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  icon TEXT,
  description TEXT,
  pack_name TEXT NOT NULL,
  pack_author TEXT,
  pack_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  schema JSON NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collections_pack ON collections(pack_name);

-- 2. Universal Documents Table
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'scheduled' | 'published' | 'archived'
  schema_version INTEGER NOT NULL DEFAULT 1,
  publish_at INTEGER,
  data JSON NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(collection, slug)
);

CREATE INDEX IF NOT EXISTS idx_docs_collection_slug ON documents(collection, slug);
CREATE INDEX IF NOT EXISTS idx_docs_collection_status ON documents(collection, status);
CREATE INDEX IF NOT EXISTS idx_docs_collection_version ON documents(collection, schema_version);
CREATE INDEX IF NOT EXISTS idx_docs_collection_updated ON documents(collection, updated_at DESC);

-- 3. Media / Files Registry (Backing R2 Storage)
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_key ON media(key);

