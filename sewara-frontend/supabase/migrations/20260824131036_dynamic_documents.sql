-- Migration: Change foto_jaminan from object to array structure
-- Old: { "ktp": "path1", "sim": "path2", "lainnya": "path3" }
-- New: [{ "label": "KTP", "path": "path1" }, { "label": "SIM", "path": "path2" }]

-- Step 1: Migrate existing data from object to array
UPDATE members
SET foto_jaminan = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'label', 
      CASE 
        WHEN key = 'ktp' THEN 'KTP'
        WHEN key = 'sim' THEN 'SIM'
        WHEN key = 'lainnya' THEN 'Lainnya'
        ELSE initcap(key)
      END,
      'path', value
    )
  )
  FROM jsonb_each_text(foto_jaminan)
  WHERE value IS NOT NULL AND value != ''
)
WHERE foto_jaminan IS NOT NULL 
  AND jsonb_typeof(foto_jaminan) = 'object'
  AND NOT (foto_jaminan ? '0'); -- Skip if already array (check for numeric key)

-- Step 2: Set empty arrays for NULL values
UPDATE members
SET foto_jaminan = '[]'::jsonb
WHERE foto_jaminan IS NULL;

-- Step 3: Add constraint to ensure array structure and max 5 documents
ALTER TABLE members
ADD CONSTRAINT foto_jaminan_array_check 
CHECK (
  jsonb_typeof(foto_jaminan) = 'array' 
  AND jsonb_array_length(foto_jaminan) <= 5
);

-- Step 4: Add comment for documentation
COMMENT ON COLUMN members.foto_jaminan IS 'Array of member documents: [{"label": "KTP", "path": "user-id/member-id/doc-0.jpg"}]. Max 5 documents.';
