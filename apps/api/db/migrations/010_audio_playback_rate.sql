-- Preserve the source edit recipe used to produce each normalized audio asset.
ALTER TABLE audio_assets ADD COLUMN source_duration REAL;
ALTER TABLE audio_assets ADD COLUMN source_trim_start REAL;
ALTER TABLE audio_assets ADD COLUMN source_trim_end REAL;
ALTER TABLE audio_assets ADD COLUMN playback_rate REAL NOT NULL DEFAULT 1;
ALTER TABLE audio_assets ADD COLUMN pitch_mode TEXT NOT NULL DEFAULT 'tape-speed';
