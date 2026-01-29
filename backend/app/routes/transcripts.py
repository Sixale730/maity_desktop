from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List
import logging
import time

logger = logging.getLogger(__name__)

router = APIRouter()

class Transcript(BaseModel):
    id: str
    text: str
    timestamp: str
    audio_start_time: Optional[float] = None
    audio_end_time: Optional[float] = None
    duration: Optional[float] = None

class SaveTranscriptRequest(BaseModel):
    meeting_title: str
    transcripts: List[Transcript]
    folder_path: Optional[str] = None

class SearchRequest(BaseModel):
    query: str


@router.post("/save-transcript")
async def save_transcript(request: SaveTranscriptRequest):
    """Save transcript segments for a meeting without processing"""
    from main import db
    try:
        logger.info(f"Received save-transcript request for meeting: {request.meeting_title}")
        logger.info(f"Number of transcripts to save: {len(request.transcripts)}")

        if request.transcripts:
            first = request.transcripts[0]
            logger.debug(f"First transcript: audio_start_time={first.audio_start_time}, audio_end_time={first.audio_end_time}, duration={first.duration}")

        meeting_id = f"meeting-{int(time.time() * 1000)}"
        await db.save_meeting(meeting_id, request.meeting_title, folder_path=request.folder_path)

        for transcript in request.transcripts:
            await db.save_meeting_transcript(
                meeting_id=meeting_id,
                transcript=transcript.text,
                timestamp=transcript.timestamp,
                summary="",
                action_items="",
                key_points="",
                audio_start_time=transcript.audio_start_time,
                audio_end_time=transcript.audio_end_time,
                duration=transcript.duration
            )

        logger.info("Transcripts saved successfully")
        return {"status": "success", "message": "Transcript saved successfully", "meeting_id": meeting_id}
    except Exception as e:
        logger.error(f"Error saving transcript: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search-transcripts")
async def search_transcripts(request: SearchRequest):
    """Search through meeting transcripts for the given query"""
    from main import db
    try:
        results = await db.search_transcripts(request.query)
        return JSONResponse(content=results)
    except Exception as e:
        logger.error(f"Error searching transcripts: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
