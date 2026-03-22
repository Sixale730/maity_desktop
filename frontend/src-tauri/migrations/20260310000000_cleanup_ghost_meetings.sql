-- One-time cleanup: delete ghost meetings (no transcripts) left by the old eager-creation flow.
-- After this migration, meetings are only created atomically with their transcripts,
-- so no new ghosts can appear.
DELETE FROM meetings WHERE NOT EXISTS (
    SELECT 1 FROM transcripts t WHERE t.meeting_id = meetings.id
);
