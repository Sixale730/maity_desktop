import logging
import sqlite3
from datetime import datetime

logger = logging.getLogger(__name__)


class TranscriptsMixin:
    async def save_meeting_transcript(self, meeting_id: str, transcript: str, timestamp: str,
                                     summary: str = "", action_items: str = "", key_points: str = "",
                                     audio_start_time: float = None, audio_end_time: float = None, duration: float = None):
        """Save a transcript for a meeting with optional recording-relative timestamps"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                # Save transcript with NEW timestamp fields for playback sync
                cursor.execute("""
                    INSERT INTO transcripts (
                        meeting_id, transcript, timestamp, summary, action_items, key_points,
                        audio_start_time, audio_end_time, duration
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (meeting_id, transcript, timestamp, summary, action_items, key_points,
                      audio_start_time, audio_end_time, duration))

                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error saving transcript: {str(e)}")
            raise

    async def save_transcript(self, meeting_id: str, transcript_text: str, model: str, model_name: str,
                            chunk_size: int, overlap: int):
        """Save transcript data"""
        # Input validation
        if not meeting_id or not meeting_id.strip():
            raise ValueError("meeting_id cannot be empty")
        if not transcript_text or not transcript_text.strip():
            raise ValueError("transcript_text cannot be empty")
        if chunk_size <= 0 or overlap < 0:
            raise ValueError("Invalid chunk_size or overlap values")
        if len(transcript_text) > 10_000_000:  # 10MB limit
            raise ValueError("Transcript text too large (>10MB)")

        now = datetime.utcnow().isoformat()

        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")

                try:
                    # First try to update existing transcript
                    await conn.execute("""
                        UPDATE transcript_chunks
                        SET transcript_text = ?, model = ?, model_name = ?, chunk_size = ?, overlap = ?, created_at = ?
                        WHERE meeting_id = ?
                    """, (transcript_text, model, model_name, chunk_size, overlap, now, meeting_id))

                    # If no rows were updated, insert a new one
                    if conn.total_changes == 0:
                        await conn.execute("""
                            INSERT INTO transcript_chunks (meeting_id, transcript_text, model, model_name, chunk_size, overlap, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (meeting_id, transcript_text, model, model_name, chunk_size, overlap, now))

                    await conn.commit()
                    logger.info(f"Successfully saved transcript for meeting_id: {meeting_id} (size: {len(transcript_text)} chars)")

                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save transcript for meeting_id {meeting_id}: {str(e)}", exc_info=True)
                    raise

        except Exception as e:
            logger.error(f"Database connection error in save_transcript: {str(e)}", exc_info=True)
            raise

    async def get_transcript_data(self, meeting_id: str):
        """Get transcript data for a meeting"""
        async with self._get_connection() as conn:
            async with conn.execute("""
                SELECT t.*, p.status, p.result, p.error
                FROM transcript_chunks t
                JOIN summary_processes p ON t.meeting_id = p.meeting_id
                WHERE t.meeting_id = ?
            """, (meeting_id,)) as cursor:
                row = await cursor.fetchone()
                if row:
                    return dict(zip([col[0] for col in cursor.description], row))
                return None

    async def search_transcripts(self, query: str):
        """Search through meeting transcripts for the given query"""
        if not query or query.strip() == "":
            return []

        # Convert query to lowercase for case-insensitive search
        search_query = f"%{query.lower()}%"

        try:
            async with self._get_connection() as conn:
                # Search in transcripts table
                cursor = await conn.execute("""
                    SELECT m.id, m.title, t.transcript, t.timestamp
                    FROM meetings m
                    JOIN transcripts t ON m.id = t.meeting_id
                    WHERE LOWER(t.transcript) LIKE ?
                    ORDER BY m.created_at DESC
                """, (search_query,))

                rows = await cursor.fetchall()

                # Also search in transcript_chunks for full transcripts
                cursor2 = await conn.execute("""
                    SELECT m.id, m.title, tc.transcript_text
                    FROM meetings m
                    JOIN transcript_chunks tc ON m.id = tc.meeting_id
                    WHERE LOWER(tc.transcript_text) LIKE ?
                    AND m.id NOT IN (SELECT DISTINCT meeting_id FROM transcripts WHERE LOWER(transcript) LIKE ?)
                    ORDER BY m.created_at DESC
                """, (search_query, search_query))

                chunk_rows = await cursor2.fetchall()

                # Format the results
                results = []

                # Process transcript matches
                for row in rows:
                    meeting_id, title, transcript, timestamp = row

                    # Find the matching context (snippet around the match)
                    transcript_lower = transcript.lower()
                    match_index = transcript_lower.find(query.lower())

                    # Extract context around the match (100 chars before and after)
                    start_index = max(0, match_index - 100)
                    end_index = min(len(transcript), match_index + len(query) + 100)
                    context = transcript[start_index:end_index]

                    # Add ellipsis if we truncated the text
                    if start_index > 0:
                        context = "..." + context
                    if end_index < len(transcript):
                        context += "..."

                    results.append({
                        'id': meeting_id,
                        'title': title,
                        'matchContext': context,
                        'timestamp': timestamp
                    })

                # Process transcript_chunks matches
                for row in chunk_rows:
                    meeting_id, title, transcript_text = row

                    # Find the matching context (snippet around the match)
                    transcript_lower = transcript_text.lower()
                    match_index = transcript_lower.find(query.lower())

                    # Extract context around the match (100 chars before and after)
                    start_index = max(0, match_index - 100)
                    end_index = min(len(transcript_text), match_index + len(query) + 100)
                    context = transcript_text[start_index:end_index]

                    # Add ellipsis if we truncated the text
                    if start_index > 0:
                        context = "..." + context
                    if end_index < len(transcript_text):
                        context += "..."

                    results.append({
                        'id': meeting_id,
                        'title': title,
                        'matchContext': context,
                        'timestamp': datetime.utcnow().isoformat()  # Use current time as fallback
                    })

                return results

        except Exception as e:
            logger.error(f"Error searching transcripts: {str(e)}")
            raise
