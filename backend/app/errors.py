from fastapi import Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """Base application error"""
    def __init__(self, message: str, status_code: int = 500, code: str = "INTERNAL_ERROR"):
        self.message = message
        self.status_code = status_code
        self.code = code
        super().__init__(self.message)


class NotFoundError(AppError):
    """Resource not found (404)"""
    def __init__(self, message: str = "Resource not found"):
        super().__init__(message, status_code=404, code="NOT_FOUND")


class ValidationError(AppError):
    """Input validation error (422)"""
    def __init__(self, message: str = "Validation error"):
        super().__init__(message, status_code=422, code="VALIDATION_ERROR")


class DatabaseError(AppError):
    """Database operation error (500)"""
    def __init__(self, message: str = "Database error"):
        super().__init__(message, status_code=500, code="DATABASE_ERROR")


class ProcessingError(AppError):
    """Processing pipeline error (500)"""
    def __init__(self, message: str = "Processing error"):
        super().__init__(message, status_code=500, code="PROCESSING_ERROR")


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """Global error handler for AppError exceptions"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "status": "error",
            "error": exc.message,
            "code": exc.code
        }
    )
