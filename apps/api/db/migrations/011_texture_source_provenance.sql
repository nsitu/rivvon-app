-- Private source facts retained separately from public processing metadata.
ALTER TABLE texture_sets ADD COLUMN source_provenance TEXT;
