import os
import sys
import tempfile
import pytest
import httpx

# Add the backend app directory to the Python path so that imports like
# "from db import DatabaseManager" resolve correctly (the app modules use
# bare imports relative to backend/app/).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))

from db import DatabaseManager


@pytest.fixture
def tmp_db_path(tmp_path):
    """Create a temporary SQLite database path for each test."""
    return str(tmp_path / "test_meeting_minutes.db")


@pytest.fixture
def db(tmp_db_path):
    """Create a DatabaseManager instance backed by a temporary database."""
    return DatabaseManager(db_path=tmp_db_path)


@pytest.fixture
async def test_client(tmp_db_path):
    """Create an httpx AsyncClient wired to the FastAPI app with an isolated database.

    The DATABASE_PATH environment variable is set *before* importing the app
    module so that every DatabaseManager created during the import uses the
    temporary database instead of the default production path.
    """
    # Set the env var so DatabaseManager() defaults to the temp path
    os.environ["DATABASE_PATH"] = tmp_db_path

    # Import the app module fresh — the routes do ``from main import db``
    # at call-time, so we monkey-patch the module-level ``db`` instance.
    import importlib

    # Reload main so it picks up the new DATABASE_PATH
    import main as main_module
    importlib.reload(main_module)

    app = main_module.app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        yield client

    # Clean up the environment variable
    os.environ.pop("DATABASE_PATH", None)
