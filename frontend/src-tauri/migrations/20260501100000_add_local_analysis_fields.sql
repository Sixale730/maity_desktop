-- Local analysis fields for 3-phase async generation with Gemma sidecar.
--
-- Phase A: quick summary (titulo + descripcion narrativa) — 5-15s
-- Phase B: full v5.1 analysis (CommunicationFeedbackV4 shape) — 60-180s
-- Phase C: meeting minutes (MeetingMinutesData shape) — 60-120s
--
-- Each phase has its own status and data column so partial progress is
-- preserved if the user closes the app mid-flow. Deterministic data
-- (muletillas, ratios, preguntas, participacion) is computed in Rust
-- without an LLM and stored separately so it can be shown immediately.

ALTER TABLE meetings ADD COLUMN analysis_quick_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE meetings ADD COLUMN analysis_quick_data TEXT;
ALTER TABLE meetings ADD COLUMN analysis_quick_error TEXT;

ALTER TABLE meetings ADD COLUMN analysis_full_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE meetings ADD COLUMN analysis_full_data TEXT;
ALTER TABLE meetings ADD COLUMN analysis_full_error TEXT;

ALTER TABLE meetings ADD COLUMN minutes_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE meetings ADD COLUMN minutes_data TEXT;
ALTER TABLE meetings ADD COLUMN minutes_error TEXT;

ALTER TABLE meetings ADD COLUMN deterministic_data TEXT;
ALTER TABLE meetings ADD COLUMN analysis_source TEXT NOT NULL DEFAULT 'cloud';
