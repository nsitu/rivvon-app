-- Migration: Add root-child texture family support
-- Run with: wrangler d1 execute rivvon-textures --file=./db/migrations/003_texture_set_families.sql --remote

-- Add nullable root/original family pointer for derived variants.
-- Root/original texture sets keep this column NULL.
ALTER TABLE texture_sets ADD COLUMN parent_texture_set_id TEXT REFERENCES texture_sets(id) ON DELETE CASCADE;

-- Index for family lookups and root->children expansion.
CREATE INDEX IF NOT EXISTS idx_texture_sets_parent ON texture_sets(parent_texture_set_id);