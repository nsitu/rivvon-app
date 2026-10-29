CREATE TABLE IF NOT EXISTS image_assets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    source_filename TEXT,
    source_mime_type TEXT,
    mime_type TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    expected_file_size INTEGER NOT NULL,
    file_size INTEGER,
    thumbnail_size INTEGER NOT NULL,
    thumbnail_mime_type TEXT NOT NULL,
    image_key TEXT NOT NULL,
    thumbnail_key TEXT NOT NULL,
    storage_provider TEXT NOT NULL DEFAULT 'r2',
    status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'complete', 'deleting')),
    upload_expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 3600),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_image_assets_owner ON image_assets(owner_id, status, created_at);

-- Rebuild the two-column exclusive constraint without dropping existing references.
DROP TRIGGER IF EXISTS texture_delete_requires_preset_consent;
DROP TRIGGER IF EXISTS audio_delete_requires_preset_consent;
CREATE TABLE preset_media_dependencies_images (
    preset_id TEXT NOT NULL REFERENCES scene_presets(id) ON DELETE CASCADE,
    texture_set_id TEXT REFERENCES texture_sets(id) ON DELETE RESTRICT,
    audio_asset_id TEXT REFERENCES audio_assets(id) ON DELETE RESTRICT,
    image_asset_id TEXT REFERENCES image_assets(id) ON DELETE RESTRICT,
    CHECK ((texture_set_id IS NOT NULL) + (audio_asset_id IS NOT NULL) + (image_asset_id IS NOT NULL) = 1)
);

INSERT INTO preset_media_dependencies_images (preset_id, texture_set_id, audio_asset_id)
SELECT preset_id, texture_set_id, audio_asset_id FROM preset_media_dependencies;
DROP TABLE preset_media_dependencies;
ALTER TABLE preset_media_dependencies_images RENAME TO preset_media_dependencies;
CREATE UNIQUE INDEX IF NOT EXISTS idx_preset_texture_dependency ON preset_media_dependencies(preset_id, texture_set_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_preset_audio_dependency ON preset_media_dependencies(preset_id, audio_asset_id);
CREATE INDEX IF NOT EXISTS idx_texture_preset_dependencies ON preset_media_dependencies(texture_set_id);
CREATE INDEX IF NOT EXISTS idx_audio_preset_dependencies ON preset_media_dependencies(audio_asset_id);

-- Close the race between validating a source and attaching a new preset to it.
CREATE TRIGGER IF NOT EXISTS preset_texture_must_be_ready BEFORE INSERT ON preset_media_dependencies
WHEN NEW.texture_set_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM texture_sets WHERE id = NEW.texture_set_id AND status = 'complete')
BEGIN SELECT RAISE(ABORT, 'Preset texture is no longer available'); END;
CREATE TRIGGER IF NOT EXISTS preset_audio_must_be_ready BEFORE INSERT ON preset_media_dependencies
WHEN NEW.audio_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM audio_assets WHERE id = NEW.audio_asset_id AND status = 'complete')
BEGIN SELECT RAISE(ABORT, 'Preset audio is no longer available'); END;

-- Roll back a deletion if new dependencies appeared after the confirmation.
CREATE TRIGGER IF NOT EXISTS texture_delete_requires_preset_consent BEFORE UPDATE OF status ON texture_sets
WHEN NEW.status = 'deleting' AND EXISTS (SELECT 1 FROM preset_media_dependencies WHERE texture_set_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Linked presets changed'); END;

CREATE TRIGGER IF NOT EXISTS texture_deletion_stays_locked BEFORE UPDATE OF status ON texture_sets
WHEN OLD.status = 'deleting' AND NEW.status != 'deleting'
BEGIN SELECT RAISE(ABORT, 'Media deletion is in progress'); END;
CREATE TRIGGER IF NOT EXISTS audio_deletion_stays_locked BEFORE UPDATE OF status ON audio_assets
WHEN OLD.status = 'deleting' AND NEW.status != 'deleting'
BEGIN SELECT RAISE(ABORT, 'Media deletion is in progress'); END;
CREATE TRIGGER IF NOT EXISTS audio_delete_requires_preset_consent BEFORE UPDATE OF status ON audio_assets
WHEN NEW.status = 'deleting' AND EXISTS (SELECT 1 FROM preset_media_dependencies WHERE audio_asset_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Linked presets changed'); END;


CREATE UNIQUE INDEX IF NOT EXISTS idx_preset_image_dependency ON preset_media_dependencies(preset_id, image_asset_id);
CREATE INDEX IF NOT EXISTS idx_image_preset_dependencies ON preset_media_dependencies(image_asset_id);
CREATE TRIGGER IF NOT EXISTS preset_image_must_be_ready BEFORE INSERT ON preset_media_dependencies
WHEN NEW.image_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM image_assets WHERE id = NEW.image_asset_id AND status = 'complete')
BEGIN SELECT RAISE(ABORT, 'Preset image is no longer available'); END;
CREATE TRIGGER IF NOT EXISTS image_delete_requires_preset_consent BEFORE UPDATE OF status ON image_assets
WHEN NEW.status = 'deleting' AND EXISTS (SELECT 1 FROM preset_media_dependencies WHERE image_asset_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Linked presets changed'); END;
CREATE TRIGGER IF NOT EXISTS image_deletion_stays_locked BEFORE UPDATE OF status ON image_assets
WHEN OLD.status = 'deleting' AND NEW.status != 'deleting'
BEGIN SELECT RAISE(ABORT, 'Media deletion is in progress'); END;
