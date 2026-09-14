-- Persist the source drawing payload separately from render settings.
ALTER TABLE video_exports ADD COLUMN source_drawing_payload_json TEXT;
ALTER TABLE video_exports ADD COLUMN render_snapshot_json TEXT;
