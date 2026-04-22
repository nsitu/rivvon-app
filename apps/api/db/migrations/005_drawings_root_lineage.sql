-- Migration: Add explicit root lineage support to drawings
-- Run with: wrangler d1 execute rivvon-textures --file=./db/migrations/005_drawings_root_lineage.sql --remote

ALTER TABLE drawings ADD COLUMN root_drawing_id TEXT;

WITH RECURSIVE drawing_roots(drawing_id, current_id, parent_id, depth) AS (
    SELECT id, id, parent_drawing_id, 0
    FROM drawings

    UNION ALL

    SELECT drawing_roots.drawing_id, parent.id, parent.parent_drawing_id, drawing_roots.depth + 1
    FROM drawing_roots
    JOIN drawings parent ON parent.id = drawing_roots.parent_id
    WHERE drawing_roots.parent_id IS NOT NULL
      AND drawing_roots.depth < 100
),
ranked_roots AS (
    SELECT
        drawing_id,
        current_id AS root_id,
        ROW_NUMBER() OVER (PARTITION BY drawing_id ORDER BY depth DESC) AS row_num
    FROM drawing_roots
)
UPDATE drawings
SET root_drawing_id = COALESCE(
    (
        SELECT root_id
        FROM ranked_roots
        WHERE ranked_roots.drawing_id = drawings.id
          AND ranked_roots.row_num = 1
    ),
    drawings.id
)
WHERE root_drawing_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_drawings_root ON drawings(root_drawing_id);