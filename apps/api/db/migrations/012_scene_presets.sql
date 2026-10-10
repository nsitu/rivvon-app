CREATE TABLE IF NOT EXISTS scene_presets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    parent_preset_id TEXT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
    schema_version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'deleting')),
    manifest_json TEXT NOT NULL,
    audio_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_scene_presets_owner ON scene_presets(owner_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_scene_presets_public ON scene_presets(visibility, status, created_at);

CREATE TABLE IF NOT EXISTS preset_media_dependencies (
    preset_id TEXT NOT NULL REFERENCES scene_presets(id) ON DELETE CASCADE,
    texture_set_id TEXT REFERENCES texture_sets(id) ON DELETE RESTRICT,
    audio_asset_id TEXT REFERENCES audio_assets(id) ON DELETE RESTRICT,
    CHECK ((texture_set_id IS NOT NULL) != (audio_asset_id IS NOT NULL))
);
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
