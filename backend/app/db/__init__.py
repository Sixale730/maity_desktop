from .connection import DatabaseBase
from .meetings import MeetingsMixin
from .transcripts import TranscriptsMixin
from .summaries import SummariesMixin
from .config import ConfigMixin
from .schema import SchemaValidator


class DatabaseManager(MeetingsMixin, TranscriptsMixin, SummariesMixin, ConfigMixin, DatabaseBase):
    """Database manager that composes all database operation mixins.

    This class provides backward-compatible access to all database operations
    previously contained in the monolithic db.py file.

    Mixins:
        MeetingsMixin: Meeting CRUD operations (save, get, update, delete)
        TranscriptsMixin: Transcript operations (save, get, search)
        SummariesMixin: Summary process operations (create, update)
        ConfigMixin: Configuration operations (model config, API keys, transcript config)

    Base:
        DatabaseBase: Database connection management, initialization, and schema setup
    """
    pass


__all__ = ['DatabaseManager', 'SchemaValidator']
