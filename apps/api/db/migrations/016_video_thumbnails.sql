-- Silent, compressed video previews, independent of still poster thumbnails.
ALTER TABLE video_exports ADD COLUMN video_thumbnail_url TEXT;
ALTER TABLE video_exports ADD COLUMN video_thumbnail_r2_key TEXT;
ALTER TABLE video_exports ADD COLUMN video_thumbnail_width INTEGER;
ALTER TABLE video_exports ADD COLUMN video_thumbnail_height INTEGER;
ALTER TABLE video_exports ADD COLUMN video_thumbnail_file_size INTEGER;
