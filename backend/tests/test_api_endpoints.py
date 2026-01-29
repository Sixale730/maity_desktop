"""Tests for the FastAPI REST endpoints."""

import pytest


class TestApiEndpoints:
    """Integration tests that exercise API routes through an httpx
    AsyncClient connected to the FastAPI application (provided by the
    ``test_client`` fixture).
    """

    @pytest.mark.asyncio
    async def test_api_get_meetings_empty(self, test_client):
        """GET /get-meetings on a fresh database should return an empty list."""
        response = await test_client.get("/get-meetings")
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_api_save_and_get_meeting(self, test_client):
        """POST /save-transcript followed by GET /get-meetings should list
        the newly created meeting."""
        payload = {
            "meeting_title": "API Test Meeting",
            "transcripts": [
                {
                    "id": "t-001",
                    "text": "Hello from the API test.",
                    "timestamp": "2025-01-01T12:00:00",
                }
            ],
        }

        save_response = await test_client.post("/save-transcript", json=payload)
        assert save_response.status_code == 200
        save_data = save_response.json()
        assert save_data["status"] == "success"

        meetings_response = await test_client.get("/get-meetings")
        assert meetings_response.status_code == 200
        meetings = meetings_response.json()
        assert len(meetings) >= 1
        assert any(m["title"] == "API Test Meeting" for m in meetings)

    @pytest.mark.asyncio
    async def test_api_get_summary_not_found(self, test_client):
        """GET /get-summary/<nonexistent-id> should return a 404 response."""
        response = await test_client.get("/get-summary/nonexistent-id")
        assert response.status_code == 404
        data = response.json()
        assert data["status"] == "error"
