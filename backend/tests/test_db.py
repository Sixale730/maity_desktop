"""Tests for the DatabaseManager CRUD operations."""

import pytest
from datetime import datetime


class TestDatabaseOperations:
    """Tests that exercise the core DatabaseManager methods against an
    isolated, temporary SQLite database (provided by the ``db`` fixture).
    """

    @pytest.mark.asyncio
    async def test_db_create_and_retrieve_meeting(self, db):
        """Creating a meeting and retrieving it should return matching data."""
        meeting_id = "test-meeting-001"
        title = "Weekly Standup"

        await db.save_meeting(meeting_id, title)
        meeting = await db.get_meeting(meeting_id)

        assert meeting is not None
        assert meeting["id"] == meeting_id
        assert meeting["title"] == title

    @pytest.mark.asyncio
    async def test_db_save_and_retrieve_transcripts(self, db):
        """Saving a transcript for a meeting and then fetching the meeting
        should include the transcript in the returned data."""
        meeting_id = "test-meeting-002"
        title = "Design Review"
        transcript_text = "We discussed the new UI layout."
        timestamp = datetime.utcnow().isoformat()

        await db.save_meeting(meeting_id, title)
        await db.save_meeting_transcript(
            meeting_id=meeting_id,
            transcript=transcript_text,
            timestamp=timestamp,
            summary="",
            action_items="",
            key_points="",
        )

        meeting = await db.get_meeting(meeting_id)

        assert meeting is not None
        assert len(meeting["transcripts"]) == 1
        assert meeting["transcripts"][0]["text"] == transcript_text

    @pytest.mark.asyncio
    async def test_db_delete_meeting_cascades(self, db):
        """Deleting a meeting should also remove its associated transcripts
        and return None on subsequent retrieval."""
        meeting_id = "test-meeting-003"
        title = "Sprint Retro"
        timestamp = datetime.utcnow().isoformat()

        await db.save_meeting(meeting_id, title)
        await db.save_meeting_transcript(
            meeting_id=meeting_id,
            transcript="Retrospective notes.",
            timestamp=timestamp,
            summary="",
            action_items="",
            key_points="",
        )

        result = await db.delete_meeting(meeting_id)
        assert result is True

        meeting = await db.get_meeting(meeting_id)
        assert meeting is None

    @pytest.mark.asyncio
    async def test_db_model_config_save_and_retrieve(self, db):
        """Saving and retrieving model configuration should return matching
        provider, model, and whisperModel fields."""
        provider = "ollama"
        model = "llama3"
        whisper_model = "large-v3"

        await db.save_model_config(provider, model, whisper_model)
        config = await db.get_model_config()

        assert config is not None
        assert config["provider"] == provider
        assert config["model"] == model
        assert config["whisperModel"] == whisper_model

    @pytest.mark.asyncio
    async def test_db_api_key_save_and_retrieve(self, db):
        """Saving an API key for a provider and retrieving it should return
        the same value."""
        api_key = "sk-test-key-abc123"
        provider = "openai"

        # save_api_key requires a settings row to exist; save_model_config
        # creates one with id='1'.
        await db.save_model_config("openai", "gpt-4o", "large-v3")
        await db.save_api_key(api_key, provider)

        retrieved_key = await db.get_api_key(provider)
        assert retrieved_key == api_key
