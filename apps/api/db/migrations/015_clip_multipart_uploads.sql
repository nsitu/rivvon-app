-- Keep unfinished R2 multipart sessions available for cancel/expiry cleanup.
CREATE TABLE IF NOT EXISTS clip_upload_sessions (
    clip_id TEXT PRIMARY KEY REFERENCES clip_assets(id) ON DELETE CASCADE,
    id TEXT NOT NULL UNIQUE,
    upload_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
