-- Add communication_feedback column to summary_processes table
-- This column stores JSON data with communication evaluation scores and feedback
ALTER TABLE summary_processes ADD COLUMN communication_feedback TEXT;
