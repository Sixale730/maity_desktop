from .meetings import router as meetings_router
from .transcripts import router as transcripts_router
from .summaries import router as summaries_router
from .config import router as config_router

__all__ = ['meetings_router', 'transcripts_router', 'summaries_router', 'config_router']
