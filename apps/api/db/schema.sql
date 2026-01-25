-- src/db/schema.sql

-- Users (synced from Google OAuth on first login)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                  -- Internal user ID (UUID)
    google_id TEXT UNIQUE,                -- Google user ID (sub claim from ID token)
    name TEXT,                            -- Display name
    email TEXT,                           -- Email address
    picture TEXT,                         -- Avatar URL
    drive_folder_id TEXT,                 -- Cached "Slyce Textures" folder ID in Google Drive
    created_at INTEGER DEFAULT (unixepoch()),
    last_login INTEGER DEFAULT (unixepoch())
);
-- Note: refresh_token stored in HTTP-only cookie, NOT in database

-- Texture sets (a collection of KTX2 tiles)
CREATE TABLE IF NOT EXISTS texture_sets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,              -- User ID (references users.id)
    name TEXT NOT NULL,
    description TEXT,
    thumbnail_url TEXT,                   -- R2 public URL for preview (always R2)
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    
    -- Source video metadata
    source_filename TEXT,
    source_width INTEGER,
    source_height INTEGER,
    source_duration REAL,
    source_frame_count INTEGER,
    sampled_frame_count INTEGER,          -- Actual frames used (may be limited by user)
    
    -- Texture configuration
    tile_resolution INTEGER NOT NULL,     -- 256, 512, 1024, etc.
    tile_count INTEGER NOT NULL,          -- Number of tiles in set
    layer_count INTEGER NOT NULL,         -- Layers per tile (e.g., 60)
    cross_section_type TEXT,              -- 'planes' or 'waves'
    
    -- Storage
    storage_provider TEXT DEFAULT 'r2',   -- 'r2' or 'google-drive'
    drive_folder_id TEXT,                 -- Google Drive folder ID (if using Drive)
    
    -- Status
    status TEXT DEFAULT 'pending',        -- pending, uploading, complete, error
    is_public INTEGER DEFAULT 0,          -- Whether publicly listed
    
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Individual texture tiles
CREATE TABLE IF NOT EXISTS texture_tiles (
    id TEXT PRIMARY KEY,
    texture_set_id TEXT NOT NULL,
    tile_index INTEGER NOT NULL,          -- 0, 1, 2, ... tile_count-1
    r2_key TEXT,                          -- R2 object key (if storage_provider = 'r2')
    drive_file_id TEXT,                   -- Google Drive file ID (if storage_provider = 'google-drive')
    public_url TEXT,                      -- Pre-computed public URL for fast retrieval
    file_size INTEGER,
    checksum TEXT,                        -- MD5 or SHA256
    created_at INTEGER DEFAULT (unixepoch()),
    
    FOREIGN KEY (texture_set_id) REFERENCES texture_sets(id) ON DELETE CASCADE,
    UNIQUE(texture_set_id, tile_index)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_texture_sets_owner ON texture_sets(owner_id);
CREATE INDEX IF NOT EXISTS idx_texture_sets_public ON texture_sets(is_public);
CREATE INDEX IF NOT EXISTS idx_texture_tiles_set ON texture_tiles(texture_set_id);
