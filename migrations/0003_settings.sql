-- Migration: 0003_settings.sql
-- Persistent System Settings for SlottD Studio (Password Hash, Git Remotes, Edge Config)

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
