import json
import logging
from datetime import datetime
from typing import Optional, Dict

logger = logging.getLogger(__name__)


class SummariesMixin:
    async def create_process(self, meeting_id: str) -> str:
        """Create a new process entry or update existing one and return its ID"""
        now = datetime.utcnow().isoformat()

        try:
            async with self._get_connection() as conn:
                # Begin transaction
                await conn.execute("BEGIN TRANSACTION")

                try:
                    # First try to update existing process
                    await conn.execute(
                        """
                        UPDATE summary_processes
                        SET status = ?, updated_at = ?, start_time = ?, error = NULL, result = NULL
                        WHERE meeting_id = ?
                        """,
                        ("PENDING", now, now, meeting_id)
                    )

                    # If no rows were updated, insert a new one
                    if conn.total_changes == 0:
                        await conn.execute(
                            "INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, start_time) VALUES (?, ?, ?, ?, ?)",
                            (meeting_id, "PENDING", now, now, now)
                        )

                    await conn.commit()
                    logger.info(f"Successfully created/updated process for meeting_id: {meeting_id}")

                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to create process for meeting_id {meeting_id}: {str(e)}", exc_info=True)
                    raise

        except Exception as e:
            logger.error(f"Database connection error in create_process: {str(e)}", exc_info=True)
            raise

        return meeting_id

    async def update_process(self, meeting_id: str, status: str, result: Optional[Dict] = None, error: Optional[str] = None,
                           chunk_count: Optional[int] = None, processing_time: Optional[float] = None,
                           metadata: Optional[Dict] = None):
        """Update a process status and result"""
        now = datetime.utcnow().isoformat()

        try:
            async with self._get_connection() as conn:
                # Begin transaction
                await conn.execute("BEGIN TRANSACTION")

                try:
                    update_fields = ["status = ?", "updated_at = ?"]
                    params = [status, now]

                    if result:
                        # Validate result can be JSON serialized
                        try:
                            result_json = json.dumps(result)
                            update_fields.append("result = ?")
                            params.append(result_json)
                        except (TypeError, ValueError) as e:
                            logger.error(f"Failed to serialize result for meeting_id {meeting_id}: {str(e)}")
                            raise ValueError("Result data cannot be JSON serialized")

                    if error:
                        # Sanitize error message to prevent log injection
                        sanitized_error = str(error).replace('\n', ' ').replace('\r', '')[:1000]
                        update_fields.append("error = ?")
                        params.append(sanitized_error)

                    if chunk_count is not None:
                        update_fields.append("chunk_count = ?")
                        params.append(chunk_count)

                    if processing_time is not None:
                        update_fields.append("processing_time = ?")
                        params.append(processing_time)

                    if metadata:
                        # Validate metadata can be JSON serialized
                        try:
                            metadata_json = json.dumps(metadata)
                            update_fields.append("metadata = ?")
                            params.append(metadata_json)
                        except (TypeError, ValueError) as e:
                            logger.error(f"Failed to serialize metadata for meeting_id {meeting_id}: {str(e)}")
                            # Don't fail the whole operation for metadata serialization issues

                    if status.upper() in ['COMPLETED', 'FAILED']:
                        update_fields.append("end_time = ?")
                        params.append(now)

                    params.append(meeting_id)
                    query = f"UPDATE summary_processes SET {', '.join(update_fields)} WHERE meeting_id = ?"

                    cursor = await conn.execute(query, params)
                    if cursor.rowcount == 0:
                        logger.warning(f"No process found to update for meeting_id: {meeting_id}")

                    await conn.commit()
                    logger.debug(f"Successfully updated process status to {status} for meeting_id: {meeting_id}")

                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to update process for meeting_id {meeting_id}: {str(e)}", exc_info=True)
                    raise

        except Exception as e:
            logger.error(f"Database connection error in update_process: {str(e)}", exc_info=True)
            raise

    async def update_meeting_summary(self, meeting_id: str, summary: dict):
        """Update a meeting's summary"""
        now = datetime.utcnow().isoformat()
        try:
            async with self._get_connection() as conn:
                # Check if the meeting exists
                cursor = await conn.execute("SELECT id FROM meetings WHERE id = ?", (meeting_id,))
                meeting = await cursor.fetchone()

                if not meeting:
                    raise ValueError(f"Meeting with ID {meeting_id} not found")

                # Update the summary in the summary_processes table
                await conn.execute("""
                    UPDATE summary_processes
                    SET result = ?, updated_at = ?
                    WHERE meeting_id = ?
                """, (json.dumps(summary), now, meeting_id))

                # Update the meeting's updated_at timestamp
                await conn.execute("""
                    UPDATE meetings
                    SET updated_at = ?
                    WHERE id = ?
                """, (now, meeting_id))

                await conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error updating meeting summary: {str(e)}")
            raise
