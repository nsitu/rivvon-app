-- Migration: Google Auth + Google Drive Storage Support
-- Run with: wrangler d1 execute rivvon-textures --file=./db/migrations/001_google_auth_drive.sql --remote

-- ============================================
-- Step 1: Add Google Auth fields to users table
-- ============================================

-- Add google_id column (will be primary identifier for Google auth users)
-- Note: SQLite doesn't support ADD COLUMN UNIQUE, so we add column then create index
ALTER TABLE users ADD COLUMN google_id TEXT;

-- Create unique index on google_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Add drive_folder_id to cache the user's "Slyce Textures" folder ID
ALTER TABLE users ADD COLUMN drive_folder_id TEXT;

-- Note: refresh_token is NOT stored in database
-- It's stored in an HTTP-only cookie for security

-- ============================================
-- Step 2: Add storage provider fields to texture_sets
-- ============================================

-- Storage provider: 'r2' (legacy) or 'google-drive' (new default)
ALTER TABLE texture_sets ADD COLUMN storage_provider TEXT DEFAULT 'r2';

-- Google Drive folder ID for this texture set
ALTER TABLE texture_sets ADD COLUMN drive_folder_id TEXT;

-- ============================================
-- Step 3: Add Drive fields to texture_tiles
-- ============================================

-- Google Drive file ID (alternative to r2_key)
ALTER TABLE texture_tiles ADD COLUMN drive_file_id TEXT;

-- Pre-computed public URL for fast retrieval
-- R2: https://cdn.rivvon.ca/{r2_key}
-- Drive: https://drive.google.com/uc?id={drive_file_id}&export=download
ALTER TABLE texture_tiles ADD COLUMN public_url TEXT;

-- ============================================
-- Step 4: Set existing data to use R2
-- ============================================

-- Mark all existing texture sets as R2 storage
UPDATE texture_sets 
SET storage_provider = 'r2' 
WHERE storage_provider IS NULL OR storage_provider = '';

-- Populate public_url for existing R2 textures
-- Note: Update 'cdn.rivvon.ca' to your actual R2 public domain
UPDATE texture_tiles
SET public_url = 'https://cdn.rivvon.ca/' || r2_key
WHERE r2_key IS NOT NULL AND (public_url IS NULL OR public_url = '');

-- ============================================
-- Step 5: Create index for google_id lookups
-- ============================================

CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
