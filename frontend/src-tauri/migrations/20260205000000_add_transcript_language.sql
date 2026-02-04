-- Add language column to transcript_settings table for Deepgram language selection
-- Default to 'es-419' (Latin American Spanish) as the primary user base speaks Spanish

ALTER TABLE transcript_settings ADD COLUMN language TEXT DEFAULT 'es-419';
