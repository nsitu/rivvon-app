CREATE TABLE IF NOT EXISTS drawings (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    parent_drawing_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    kind TEXT NOT NULL,
    path_count INTEGER NOT NULL DEFAULT 0,
    point_count INTEGER NOT NULL DEFAULT 0,
    thumbnail_url TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    payload_json TEXT,
    payload_size INTEGER,
    payload_r2_key TEXT,
    payload_drive_file_id TEXT,
    payload_public_url TEXT,
    storage_provider TEXT DEFAULT 'google-drive',
    drive_folder_id TEXT,
    status TEXT DEFAULT 'pending',
    is_public INTEGER DEFAULT 0,
    FOREIGN KEY (owner_id) REFERENCES users(id),
    FOREIGN KEY (parent_drawing_id) REFERENCES drawings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_drawings_owner ON drawings(owner_id);
CREATE INDEX IF NOT EXISTS idx_drawings_parent ON drawings(parent_drawing_id);
CREATE INDEX IF NOT EXISTS idx_drawings_status ON drawings(status);