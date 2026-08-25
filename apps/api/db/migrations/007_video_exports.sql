-- Published video exports and their gallery metadata.
CREATE TABLE IF NOT EXISTS video_exports (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    thumbnail_url TEXT,
    thumbnail_r2_key TEXT,

    -- Encoded media metadata
    format TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    duration REAL NOT NULL,
    fps REAL NOT NULL,
    expected_file_size INTEGER NOT NULL,
    file_size INTEGER,

    -- Gallery playback storage
    storage_provider TEXT NOT NULL DEFAULT 'r2',
    r2_key TEXT,
    playback_url TEXT,

    -- Optional user-owned archival copy
    drive_file_id TEXT,
    drive_folder_id TEXT,

    -- Publication and provenance
    export_settings_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    is_public INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),

    FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_video_exports_owner ON video_exports(owner_id);
CREATE INDEX IF NOT EXISTS idx_video_exports_public ON video_exports(is_public, status, created_at);
CREATE INDEX IF NOT EXISTS idx_video_exports_status ON video_exports(status);
