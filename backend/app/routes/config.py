from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

class SaveModelConfigRequest(BaseModel):
    provider: str
    model: str
    whisperModel: str
    apiKey: Optional[str] = None

class SaveTranscriptConfigRequest(BaseModel):
    provider: str
    model: str
    apiKey: Optional[str] = None

class GetApiKeyRequest(BaseModel):
    provider: str


@router.get("/get-model-config")
async def get_model_config():
    """Get the current model configuration"""
    from main import db
    model_config = await db.get_model_config()
    if model_config:
        api_key = await db.get_api_key(model_config["provider"])
        if api_key != None:
            model_config["apiKey"] = api_key
    return model_config

@router.post("/save-model-config")
async def save_model_config(request: SaveModelConfigRequest):
    """Save the model configuration"""
    from main import db
    await db.save_model_config(request.provider, request.model, request.whisperModel)
    if request.apiKey != None:
        await db.save_api_key(request.apiKey, request.provider)
    return {"status": "success", "message": "Model configuration saved successfully"}

@router.get("/get-transcript-config")
async def get_transcript_config():
    """Get the current transcript configuration"""
    from main import db
    transcript_config = await db.get_transcript_config()
    if transcript_config:
        transcript_api_key = await db.get_transcript_api_key(transcript_config["provider"])
        if transcript_api_key != None:
            transcript_config["apiKey"] = transcript_api_key
    return transcript_config

@router.post("/save-transcript-config")
async def save_transcript_config(request: SaveTranscriptConfigRequest):
    """Save the transcript configuration"""
    from main import db
    await db.save_transcript_config(request.provider, request.model)
    if request.apiKey != None:
        await db.save_transcript_api_key(request.apiKey, request.provider)
    return {"status": "success", "message": "Transcript configuration saved successfully"}

@router.post("/get-api-key")
async def get_api_key(request: GetApiKeyRequest):
    from main import db
    try:
        return await db.get_api_key(request.provider)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/get-transcript-api-key")
async def get_transcript_api_key(request: GetApiKeyRequest):
    from main import db
    try:
        return await db.get_transcript_api_key(request.provider)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
