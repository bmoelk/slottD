-- Migration: 0001_init.sql
-- SlottD Indestructible Documents & Media Storage Schema

-- 1. Universal Documents Table
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'published' | 'archived'
  data JSON NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(collection, slug)
);

CREATE INDEX IF NOT EXISTS idx_docs_collection_slug ON documents(collection, slug);
CREATE INDEX IF NOT EXISTS idx_docs_collection_status ON documents(collection, status);
CREATE INDEX IF NOT EXISTS idx_docs_collection_updated ON documents(collection, updated_at DESC);

-- 2. Media / Files Registry (Backing R2 Storage)
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
