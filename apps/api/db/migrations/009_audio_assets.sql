-- User-owned, audio-only assets extracted from audio or video sources.
CREATE TABLE IF NOT EXISTS audio_assets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    source_filename TEXT,
    source_mime_type TEXT,
    mime_type TEXT NOT NULL,
    format TEXT NOT NULL,
    duration REAL NOT NULL,
    sample_rate INTEGER,
    channel_count INTEGER,
    expected_file_size INTEGER NOT NULL,
    file_size INTEGER,
    storage_provider TEXT NOT NULL DEFAULT 'r2',
    r2_key TEXT,
    playback_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    is_public INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),

    FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_audio_assets_owner ON audio_assets(owner_id);
CREATE INDEX IF NOT EXISTS idx_audio_assets_status ON audio_assets(status);
CREATE INDEX IF NOT EXISTS idx_audio_assets_public ON audio_assets(is_public, status, created_at);
