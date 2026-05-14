ALTER TABLE texture_sets ADD COLUMN frame_interpolation_factor INTEGER DEFAULT 1;

UPDATE texture_sets
SET frame_interpolation_factor = 1
WHERE frame_interpolation_factor IS NULL;