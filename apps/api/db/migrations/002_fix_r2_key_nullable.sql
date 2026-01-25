-- Migration: Make r2_key nullable in texture_tiles
-- Run with: wrangler d1 execute rivvon-textures --file=./db/migrations/002_fix_r2_key_nullable.sql --remote
--
-- SQLite doesn't support ALTER COLUMN, so we must recreate the table

-- Step 1: Create new table with correct schema (r2_key nullable)
CREATE TABLE texture_tiles_new (
    id TEXT PRIMARY KEY,
    texture_set_id TEXT NOT NULL,
    tile_index INTEGER NOT NULL,
    r2_key TEXT,                          -- Now nullable (was NOT NULL)
    drive_file_id TEXT,
    public_url TEXT,
    file_size INTEGER,
    checksum TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    
    FOREIGN KEY (texture_set_id) REFERENCES texture_sets(id) ON DELETE CASCADE,
    UNIQUE(texture_set_id, tile_index)
);

-- Step 2: Copy existing data
INSERT INTO texture_tiles_new (id, texture_set_id, tile_index, r2_key, drive_file_id, public_url, file_size, checksum, created_at)
SELECT id, texture_set_id, tile_index, r2_key, drive_file_id, public_url, file_size, checksum, created_at
FROM texture_tiles;

-- Step 3: Drop old table
DROP TABLE texture_tiles;

-- Step 4: Rename new table
ALTER TABLE texture_tiles_new RENAME TO texture_tiles;

-- Step 5: Recreate index
CREATE INDEX IF NOT EXISTS idx_texture_tiles_set ON texture_tiles(texture_set_id);
