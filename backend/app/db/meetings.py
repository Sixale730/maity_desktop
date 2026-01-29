import logging
import sqlite3
from datetime import datetime

logger = logging.getLogger(__name__)


class MeetingsMixin:
    async def save_meeting(self, meeting_id: str, title: str, folder_path: str = None):
        """Save or update a meeting"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                # Check if meeting exists
                cursor.execute("SELECT id FROM meetings WHERE id = ? OR title = ?", (meeting_id, title))
                existing_meeting = cursor.fetchone()

                if not existing_meeting:
                    # Create new meeting with local timestamp and folder path
                    cursor.execute("""
                        INSERT INTO meetings (id, title, created_at, updated_at, folder_path)
                        VALUES (?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'), ?)
                    """, (meeting_id, title, folder_path))
                    logger.info(f"Saved meeting {meeting_id} with folder_path: {folder_path}")
                else:
                    # If we get here and meeting exists, throw error since we don't want duplicates
                    raise Exception(f"Meeting with ID {meeting_id} already exists")
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error saving meeting: {str(e)}")
            raise

    async def get_meeting(self, meeting_id: str):
        """Get a meeting by ID with all its transcripts"""
        try:
            async with self._get_connection() as conn:
                # Get meeting details
                cursor = await conn.execute("""
                    SELECT id, title, created_at, updated_at
                    FROM meetings
                    WHERE id = ?
                """, (meeting_id,))
                meeting = await cursor.fetchone()

                if not meeting:
                    return None

                # Get all transcripts for this meeting with NEW timestamp fields
                cursor = await conn.execute("""
                    SELECT transcript, timestamp, audio_start_time, audio_end_time, duration
                    FROM transcripts
                    WHERE meeting_id = ?
                """, (meeting_id,))
                transcripts = await cursor.fetchall()

                return {
                    'id': meeting[0],
                    'title': meeting[1],
                    'created_at': meeting[2],
                    'updated_at': meeting[3],
                    'transcripts': [{
                        'id': meeting_id,
                        'text': transcript[0],
                        'timestamp': transcript[1],
                        # NEW: Recording-relative timestamps for playback sync
                        'audio_start_time': transcript[2],
                        'audio_end_time': transcript[3],
                        'duration': transcript[4]
                    } for transcript in transcripts]
                }
        except Exception as e:
            logger.error(f"Error getting meeting: {str(e)}")
            raise

    async def get_all_meetings(self):
        """Get all meetings with basic information"""
        async with self._get_connection() as conn:
            cursor = await conn.execute("""
                SELECT id, title, created_at
                FROM meetings
                ORDER BY created_at DESC
            """)
            rows = await cursor.fetchall()
            return [{
                'id': row[0],
                'title': row[1],
                'created_at': row[2]
            } for row in rows]

    async def update_meeting_title(self, meeting_id: str, new_title: str):
        """Update a meeting's title"""
        now = datetime.utcnow().isoformat()
        async with self._get_connection() as conn:
            await conn.execute("""
                UPDATE meetings
                SET title = ?, updated_at = ?
                WHERE id = ?
            """, (new_title, now, meeting_id))
            await conn.commit()

    async def update_meeting_name(self, meeting_id: str, meeting_name: str):
        """Update meeting name in both meetings and transcript_chunks tables"""
        now = datetime.utcnow().isoformat()
        async with self._get_connection() as conn:
            # Update meetings table
            await conn.execute("""
                UPDATE meetings
                SET title = ?, updated_at = ?
                WHERE id = ?
            """, (meeting_name, now, meeting_id))

            # Update transcript_chunks table
            await conn.execute("""
                UPDATE transcript_chunks
                SET meeting_name = ?
                WHERE meeting_id = ?
            """, (meeting_name, meeting_id))

            await conn.commit()

    async def delete_meeting(self, meeting_id: str):
        """Delete a meeting and all its associated data"""
        if not meeting_id or not meeting_id.strip():
            raise ValueError("meeting_id cannot be empty")

        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")

                try:
                    # Check if meeting exists before deletion
                    cursor = await conn.execute("SELECT id FROM meetings WHERE id = ?", (meeting_id,))
                    meeting = await cursor.fetchone()

                    if not meeting:
                        logger.warning(f"Meeting {meeting_id} not found for deletion")
                        await conn.rollback()
                        return False

                    # Delete in proper order to respect foreign key constraints
                    # Delete from transcript_chunks
                    await conn.execute("DELETE FROM transcript_chunks WHERE meeting_id = ?", (meeting_id,))

                    # Delete from summary_processes
                    await conn.execute("DELETE FROM summary_processes WHERE meeting_id = ?", (meeting_id,))

                    # Delete from transcripts
                    await conn.execute("DELETE FROM transcripts WHERE meeting_id = ?", (meeting_id,))

                    # Delete from meetings
                    cursor = await conn.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))

                    if cursor.rowcount == 0:
                        logger.error(f"Failed to delete meeting {meeting_id} - no rows affected")
                        await conn.rollback()
                        return False

                    await conn.commit()
                    logger.info(f"Successfully deleted meeting {meeting_id} and all associated data")
                    return True

                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to delete meeting {meeting_id}: {str(e)}", exc_info=True)
                    return False

        except Exception as e:
            logger.error(f"Database connection error in delete_meeting: {str(e)}", exc_info=True)
            return False
